"""
audio_engine.py — 실시간 보컬 하모나이저 (오토튠 + 다이어토닉 화음)
- numpy 피치 검출(FFT 자기상관) → 스케일 스냅(오토튠) → 다이어토닉 3rd/5th 화음
- 제스처가 키(스케일)를 선택. 부른 음에 맞는 음악적 화음을 가변 PitchShift로 생성.
- Face Mode: 서브옥타브 + 디스토션(빌런 톤).
"""
import threading
import numpy as np
import sounddevice as sd
from pedalboard import Pedalboard, PitchShift, Distortion, LowpassFilter, Gain

SR = 44100
BLOCK = 1024  # ~23ms 저지연

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]

# 제스처 → (키 루트 pitch-class, 스케일, 옥타브 코러스 추가 여부)
GESTURE_KEYS = {
    "open_palm":        (0, MAJOR, False),  # C major
    "index_up":         (9, MINOR, False),  # A minor (어두움)
    "peace_sign":       (7, MAJOR, False),  # G major
    "three_fingers_up": (4, MINOR, False),  # E minor
    "pinky_up":         (5, MAJOR, False),  # F major
}
GESTURE_MIDI = {  # 피아노롤/로그 표시용 루트
    "open_palm": 72, "index_up": 69, "peace_sign": 67,
    "three_fingers_up": 64, "pinky_up": 65,
}


def hz_to_midi(f):
    return 69.0 + 12.0 * np.log2(f / 440.0) if f > 0 else 0.0


def detect_pitch(x, sr=SR, fmin=80.0, fmax=1000.0):
    """FFT 자기상관 + 포물선 보간 단음 피치 검출 → f0(Hz). 무음/실패 시 0."""
    x = x.astype(np.float64)
    x = x - x.mean()
    if np.sqrt(np.mean(x * x)) < 0.006:
        return 0.0
    n = len(x)
    f = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    tmin = max(1, int(sr / fmax))
    tmax = min(int(sr / fmin), n - 1)
    if tmax <= tmin:
        return 0.0
    seg = ac[tmin:tmax]
    p = int(np.argmax(seg)) + tmin
    if 1 <= p < n - 1:
        a, b, c = ac[p - 1], ac[p], ac[p + 1]
        den = a - 2 * b + c
        if den != 0:
            p = p + 0.5 * (a - c) / den
    f0 = sr / p
    return f0 if fmin <= f0 <= fmax else 0.0


def scale_notes(root, scale, lo=40, hi=88):
    return [m for m in range(lo, hi) if (m - root) % 12 in scale]


def snap(midi, notes):
    return min(notes, key=lambda n: abs(n - midi))


def diatonic_above(note, notes, steps):
    if note not in notes:
        note = snap(note, notes)
    i = notes.index(note)
    return notes[min(i + steps, len(notes) - 1)]


class HarmonizerEngine:
    def __init__(self, dry=0.85, wet=0.6):
        self.lock = threading.Lock()
        self.key = None              # (root, scale, octave) — None이면 화음 off
        self.mode = "hand"
        self.dry = dry               # 오토튠된 보컬
        self.wet = wet               # 화음 성부
        self.in_level = 0.0
        self.out_level = 0.0
        self.running = False
        self.stream = None
        self.error = None

        self._prev = np.zeros(BLOCK, dtype=np.float32)  # 피치검출용 직전 블록
        # 가변 PitchShift 4개(드라이/3rd/5th/옥타브) 재사용
        self._ps = [Pedalboard([PitchShift(semitones=0)]) for _ in range(4)]
        self.face_board = Pedalboard([
            PitchShift(semitones=-12), Distortion(drive_db=22),
            LowpassFilter(cutoff_frequency_hz=1400), Gain(gain_db=-3),
        ])

    def _shift(self, x, idx, semitones):
        self._ps[idx][0].semitones = float(np.clip(semitones, -24, 24))
        out = self._ps[idx](x, SR, reset=True)
        if len(out) == len(x):
            return out
        z = np.zeros(len(x), dtype=np.float32)
        n = min(len(out), len(x)); z[:n] = out[:n]
        return z

    # ---- 제어 ----
    def set_chord(self, gesture):
        k = GESTURE_KEYS.get(gesture)
        with self.lock:
            self.key = k
    def chord_off(self):
        with self.lock:
            self.key = None
    def set_mode(self, mode):
        with self.lock:
            self.mode = mode if mode in ("hand", "face") else "hand"

    # ---- 콜백 ----
    def _callback(self, indata, outdata, frames, time_info, status):
        x = indata[:, 0].astype(np.float32)
        self.in_level = float(np.sqrt(np.mean(x * x)) + 1e-9)
        with self.lock:
            key = self.key
            mode = self.mode

        if mode == "face":
            fb = self.face_board(x, SR, reset=True)
            y = np.zeros_like(x); n = min(len(fb), len(x)); y[:n] = fb[:n]
        elif key is None:
            y = x  # 드라이만 (화음 off)
        else:
            root, scale, octave = key
            buf = np.concatenate([self._prev, x])  # 2블록으로 피치검출 정확도↑
            f0 = detect_pitch(buf)
            if f0 <= 0:
                y = x * self.dry  # 무성/무음 구간: 보정 없이 드라이
            else:
                m = hz_to_midi(f0)
                notes = scale_notes(root, scale)
                sn = snap(round(m), notes)
                voices = [(sn, self.dry),                              # 오토튠 보컬
                          (diatonic_above(sn, notes, 2), self.wet),    # 3rd
                          (diatonic_above(sn, notes, 4), self.wet)]    # 5th
                if octave:
                    voices.append((sn + 12, self.wet * 0.7))           # 옥타브 코러스
                y = np.zeros_like(x)
                for i, (target, g) in enumerate(voices):
                    y = y + self._shift(x, i, target - m) * g
        self._prev = x.copy()

        y = np.tanh(y * 1.05)
        self.out_level = float(np.sqrt(np.mean(y * y)) + 1e-9)
        outdata[:, 0] = y

    def start(self):
        try:
            self.stream = sd.Stream(
                samplerate=SR, blocksize=BLOCK, channels=1,
                dtype="float32", latency="low", callback=self._callback)
            self.stream.start(); self.running = True
        except Exception as e:
            self.error = str(e); self.running = False

    def stop(self):
        self.running = False
        if self.stream:
            try: self.stream.stop(); self.stream.close()
            except Exception: pass
            self.stream = None
