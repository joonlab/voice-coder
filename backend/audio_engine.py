"""
audio_engine.py — pedalboard 실시간 보컬 하모나이저 엔진
- 마이크 입력을 여러 PitchShift로 화음(하모니) 생성 → 헤드폰 출력
- 제스처가 화음(반음 인터벌)을 결정. Face Mode는 서브옥타브+디스토션(빌런 톤).
- sounddevice 콜백에서 reset=False로 프레임 연속 처리.
"""
import threading
import numpy as np
import sounddevice as sd
from pedalboard import Pedalboard, PitchShift, Distortion, LowpassFilter, Delay, Gain

SR = 44100
BLOCK = 1024  # ~23ms

# 제스처 → 화음 인터벌(반음). 0 = 드라이(원래 목소리). 음수 = 아래.
GESTURE_INTERVALS = {
    "open_palm":        [0, 4, 7, 12],   # 메이저 + 옥타브 코러스 (밝고 높음)
    "index_up":         [0, -5, -12],    # 낮고 어두운 (옥타브/4도 아래)
    "peace_sign":       [0, 3, 7],       # 마이너
    "three_fingers_up": [0, 4, 7],       # 메이저
    "pinky_up":         [0, 7, 12],      # 5도 + 옥타브
}

# 피아노롤/로그용 루트 MIDI (프론트와 의미 일치)
GESTURE_MIDI = {
    "open_palm": 69, "index_up": 60, "peace_sign": 64,
    "three_fingers_up": 62, "pinky_up": 67,
}


class HarmonizerEngine:
    def __init__(self, dry=0.75, wet=0.5):
        self.lock = threading.Lock()
        self.intervals = []          # 현재 화음 (빈 리스트 = 드라이만)
        self.mode = "hand"           # 'hand' | 'face'
        self.dry = dry
        self.wet = wet
        self.in_level = 0.0
        self.out_level = 0.0
        self.running = False
        self.stream = None
        self.error = None

        # 인터벌별 PitchShift 보드 캐시 (reset=False 연속 처리용)
        self._shifters = {}
        # Face Mode: 서브옥타브 + 디스토션 + 로우패스 (빌런/로봇 톤)
        self.face_board = Pedalboard([
            PitchShift(semitones=-12),
            Distortion(drive_db=22),
            LowpassFilter(cutoff_frequency_hz=1400),
            Gain(gain_db=-3),
        ])
        # 공간감 딜레이 (마스터)
        self.delay = Pedalboard([Delay(delay_seconds=0.26, feedback=0.32, mix=0.18)])

    def _shifter(self, st):
        if st not in self._shifters:
            self._shifters[st] = Pedalboard([PitchShift(semitones=st)])
        return self._shifters[st]

    def _shift(self, x, st):
        """PitchShift 적용 + 길이를 입력에 맞춤(룩어헤드 지연 가드)."""
        out = self._shifter(st)(x, SR, reset=False)
        if len(out) == len(x):
            return out
        z = np.zeros(len(x), dtype=np.float32)
        n = min(len(out), len(x))
        if n:
            z[:n] = out[:n]
        return z

    # ---- 제어 API (WebSocket에서 호출) ----
    def set_chord(self, gesture):
        with self.lock:
            self.intervals = list(GESTURE_INTERVALS.get(gesture, []))

    def chord_off(self):
        with self.lock:
            self.intervals = []

    def set_mode(self, mode):
        with self.lock:
            self.mode = mode if mode in ("hand", "face") else "hand"

    # ---- 오디오 콜백 ----
    def _callback(self, indata, outdata, frames, time_info, status):
        x = indata[:, 0].astype(np.float32)
        self.in_level = float(np.sqrt(np.mean(x * x)) + 1e-9)

        with self.lock:
            intervals = list(self.intervals)
            mode = self.mode

        if mode == "face":
            fb = self.face_board(x, SR, reset=False)
            y = np.zeros_like(x)
            n = min(len(fb), len(x))
            y[:n] = fb[:n]
        else:
            y = x * self.dry
            for st in intervals:
                if st == 0:
                    continue
                y = y + self._shift(x, st) * self.wet
            dl = self.delay(y, SR, reset=False)
            if len(dl) == len(y):
                y = dl

        # 소프트 클립 (과도 방지)
        y = np.tanh(y * 1.1)
        self.out_level = float(np.sqrt(np.mean(y * y)) + 1e-9)
        outdata[:, 0] = y

    def start(self):
        try:
            self.stream = sd.Stream(
                samplerate=SR, blocksize=BLOCK, channels=1,
                dtype="float32", latency="low", callback=self._callback,
            )
            self.stream.start()
            self.running = True
        except Exception as e:  # 오디오 장치 없음 등
            self.error = str(e)
            self.running = False

    def stop(self):
        self.running = False
        if self.stream:
            try:
                self.stream.stop(); self.stream.close()
            except Exception:
                pass
            self.stream = None
