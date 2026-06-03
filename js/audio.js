// audio.js — Web Audio 보코더 엔진 (v2)
// Hand Mode: 제스처별 MIDI 화음(하모나이저), 가짜/진짜 보코더 토글
// Face Mode: 서브옥타브(-1) + 디스토션 = 빌런/로봇 톤

const A4 = 440;
const midiToFreq = (m) => A4 * Math.pow(2, (m - 69) / 12);

// 제스처 → 루트 MIDI 노트 + 화음 보이싱 (낮음/중간/높음을 보이싱으로 표현)
export const GESTURE_CHORDS = {
  index_up:         { midi: 60, name: "C",  voicing: [48, 55, 60, 64] }, // 낮고 어두움
  three_fingers_up: { midi: 62, name: "Dm", voicing: [50, 57, 62, 65] }, // 중간
  peace_sign:       { midi: 64, name: "Em", voicing: [52, 59, 64, 67] }, // 중상
  pinky_up:         { midi: 67, name: "G",  voicing: [55, 62, 67, 71] },
  open_palm:        { midi: 69, name: "Am", voicing: [69, 72, 76, 79] }, // 높은 코러스
};

const NUM_BANDS = 16;
const BAND_LO = 120;
const BAND_HI = 7000;

function absCurve() {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.abs(x); }
  return c;
}
function distortionCurve(amount) {
  const n = 1024, c = new Float32Array(n), k = amount, deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return c;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vocoderType = "fake";   // 'fake' | 'real'
    this.audioMode = "hand";     // 'hand' | 'face'
    this.chordOn = false;
    this.octaveShift = 0;
    this.currentVoicing = GESTURE_CHORDS.open_palm.voicing;
    this._env = 0;
    this.oscs = [];
  }

  async init(micStream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.mic = ctx.createMediaStreamSource(micStream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this._buf = new Float32Array(this.analyser.fftSize);
    this.mic.connect(this.analyser);

    // carrier 신스 (4성부)
    this.carrierBus = ctx.createGain();
    this.carrierBus.gain.value = 0.22;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiToFreq(this.currentVoicing[i]);
      o.connect(this.carrierBus);
      o.start();
      this.oscs.push(o);
    }

    // VCA들
    this.fakeVCA = ctx.createGain(); this.fakeVCA.gain.value = 0;
    this.realVCA = ctx.createGain(); this.realVCA.gain.value = 0;
    this.faceVCA = ctx.createGain(); this.faceVCA.gain.value = 0;
    this.modeMix = ctx.createGain();

    // 마스터 필터/딜레이/마스터
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.value = 6000;
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.28;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.35;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();

    this.fakeVCA.connect(this.modeMix);
    this.realVCA.connect(this.modeMix);
    this.faceVCA.connect(this.modeMix);
    this.modeMix.connect(this.masterFilter);
    this.masterFilter.connect(this.dry);
    this.masterFilter.connect(this.delay);
    this.dry.connect(comp);
    this.delay.connect(this.wet); this.wet.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // 가짜 보코더 경로
    this.carrierBus.connect(this.fakeVCA);

    // Face Mode(빌런) 경로: carrier -> distortion -> lowpass -> faceVCA
    this.faceShaper = ctx.createWaveShaper();
    this.faceShaper.curve = distortionCurve(40);
    this.faceFilter = ctx.createBiquadFilter();
    this.faceFilter.type = "lowpass";
    this.faceFilter.frequency.value = 1100;
    this.carrierBus.connect(this.faceShaper);
    this.faceShaper.connect(this.faceFilter);
    this.faceFilter.connect(this.faceVCA);

    // 진짜 채널 보코더
    this._buildVocoder();

    this.setVoicing(this.currentVoicing);
    this.setAudioMode("hand");
    this.ready = true;
    if (ctx.state === "suspended") await ctx.resume();
  }

  _buildVocoder() {
    const ctx = this.ctx;
    const shaper = absCurve();
    this.vocSum = ctx.createGain();
    this.vocSum.gain.value = 1.4;
    this.bands = [];
    for (let i = 0; i < NUM_BANDS; i++) {
      const f = BAND_LO * Math.pow(BAND_HI / BAND_LO, i / (NUM_BANDS - 1));
      const Q = 6;
      const bpM = ctx.createBiquadFilter(); bpM.type = "bandpass"; bpM.frequency.value = f; bpM.Q.value = Q;
      const rect = ctx.createWaveShaper(); rect.curve = shaper;
      const env = ctx.createBiquadFilter(); env.type = "lowpass"; env.frequency.value = 18;
      const envAmp = ctx.createGain(); envAmp.gain.value = 14;
      const bpC = ctx.createBiquadFilter(); bpC.type = "bandpass"; bpC.frequency.value = f; bpC.Q.value = Q;
      const vca = ctx.createGain(); vca.gain.value = 0;
      this.mic.connect(bpM); bpM.connect(rect); rect.connect(env);
      env.connect(envAmp); envAmp.connect(vca.gain);
      this.carrierBus.connect(bpC); bpC.connect(vca); vca.connect(this.vocSum);
      this.bands.push({ vca });
    }
    this.vocSum.connect(this.realVCA);
  }

  // ---- 제어 API ----
  setVoicing(notes) {
    this.currentVoicing = notes;
    const t = this.ctx.currentTime;
    const mult = Math.pow(2, this.octaveShift);
    for (let k = 0; k < this.oscs.length; k++) {
      this.oscs[k].frequency.setTargetAtTime(midiToFreq(notes[k]) * mult, t, 0.03);
    }
  }

  // 제스처 라벨 → 화음 적용. 반환: {midi, name} (로그용) 또는 null
  applyGesture(label) {
    const c = GESTURE_CHORDS[label];
    if (!c) return null;
    this.setVoicing(c.voicing);
    return { midi: c.midi, name: c.name };
  }

  setVocoderType(type) {
    this.vocoderType = type;
    if (this.audioMode === "hand") this._applyGains();
  }

  setAudioMode(mode) {
    this.audioMode = mode;
    const t = this.ctx.currentTime;
    if (mode === "face") {
      this.octaveShift = -1;
      this.setVoicing(this.currentVoicing);
      this.fakeVCA.gain.setTargetAtTime(0, t, 0.03);
      this.realVCA.gain.setTargetAtTime(0, t, 0.03);
      this.masterFilter.frequency.setTargetAtTime(2200, t, 0.05);
    } else {
      this.octaveShift = 0;
      this.setVoicing(this.currentVoicing);
      this.faceVCA.gain.setTargetAtTime(0, t, 0.03);
      this.masterFilter.frequency.setTargetAtTime(6000, t, 0.05);
      this._applyGains();
    }
  }

  setChordOn(on) {
    this.chordOn = on;
    if (this.audioMode === "hand") this._applyGains();
  }

  _applyGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.vocoderType === "real") {
      this.realVCA.gain.setTargetAtTime(this.chordOn ? 1 : 0, t, 0.03);
      this.fakeVCA.gain.setTargetAtTime(0, t, 0.03);
    } else {
      if (!this.chordOn) this.fakeVCA.gain.setTargetAtTime(0, t, 0.03);
      this.realVCA.gain.setTargetAtTime(0, t, 0.03);
    }
  }

  setJaw(v) {
    if (!this.ctx || this.audioMode === "face") return;
    const f = 700 + Math.min(1, Math.max(0, v)) * 7000;
    this.masterFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }
  setSpace(v) {
    if (!this.ctx) return;
    const w = Math.min(0.7, Math.max(0, v) * 0.7);
    this.wet.gain.setTargetAtTime(w, this.ctx.currentTime, 0.1);
  }

  update() {
    if (!this.ready) return 0;
    this.analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(sum / this._buf.length);
    this._env += (rms - this._env) * 0.3;
    const level = Math.min(1, this._env * 6);
    const t = this.ctx.currentTime;

    if (this.audioMode === "face") {
      // 빌런 톤: 목소리 있을 때만 (envelope)
      this.faceVCA.gain.setTargetAtTime(Math.min(1, level * 1.8), t, 0.03);
    } else if (this.vocoderType === "fake") {
      const target = this.chordOn ? Math.min(1, 0.15 + level * 1.6) : 0;
      this.fakeVCA.gain.setTargetAtTime(target, t, 0.03);
    }
    return level;
  }

  async resume() { if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume(); }
}
