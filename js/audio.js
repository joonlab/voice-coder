// audio.js — Web Audio 보코더 엔진 (가짜/진짜 토글)
// 가짜 보코더: 마이크 envelope -> 코드 신스 게인 변조
// 진짜 보코더: 채널 보코더 (밴드패스 뱅크 + envelope follower), AudioWorklet 불필요

const A4 = 440;
const midiToFreq = (m) => A4 * Math.pow(2, (m - 69) / 12);

// C major 다이어토닉 7th 코드 진행
const CHORDS = [
  { name: "Cmaj7", notes: [60, 64, 67, 71] },
  { name: "Dm7",   notes: [62, 65, 69, 72] },
  { name: "Em7",   notes: [64, 67, 71, 74] },
  { name: "Fmaj7", notes: [65, 69, 72, 76] },
  { name: "G7",    notes: [67, 71, 74, 77] },
  { name: "Am7",   notes: [69, 72, 76, 79] },
];

const NUM_BANDS = 16;
const BAND_LO = 120;
const BAND_HI = 7000;

function absCurve() {
  const n = 256;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.abs(x);
  }
  return c;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.mode = "fake";        // 'fake' | 'real'
    this.chordOn = false;
    this.chordIndex = 0;
    this.octaveShift = 0;
    this._env = 0;             // 입력 레벨(비주얼 공유)
    this.oscs = [];
  }

  async init(micStream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // --- 입력(마이크) ---
    this.mic = ctx.createMediaStreamSource(micStream);

    // 가짜 보코더용 envelope 분석
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this._buf = new Float32Array(this.analyser.fftSize);
    this.mic.connect(this.analyser);

    // --- carrier(코드 신스) 버스 ---
    this.carrierBus = ctx.createGain();
    this.carrierBus.gain.value = 0.22; // osc 합산 헤드룸
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiToFreq(CHORDS[0].notes[i]);
      o.connect(this.carrierBus);
      o.start();
      this.oscs.push(o);
    }

    // --- 모드 믹서 / 마스터 체인 ---
    this.fakeVCA = ctx.createGain(); this.fakeVCA.gain.value = 0;
    this.realVCA = ctx.createGain(); this.realVCA.gain.value = 0;
    this.modeMix = ctx.createGain();

    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.value = 6000;
    this.masterFilter.Q.value = 0.7;

    // 딜레이(공간감, 왼손)
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.28;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.35;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.0;
    this.delay.connect(this.fb); this.fb.connect(this.delay);

    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();

    // 라우팅: fake/real VCA -> modeMix -> filter -> (dry + delay/wet) -> comp -> master -> out
    this.fakeVCA.connect(this.modeMix);
    this.realVCA.connect(this.modeMix);
    this.modeMix.connect(this.masterFilter);
    this.masterFilter.connect(this.dry);
    this.masterFilter.connect(this.delay);
    this.dry.connect(comp);
    this.delay.connect(this.wet); this.wet.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // 가짜 보코더 경로: carrierBus -> fakeVCA
    this.carrierBus.connect(this.fakeVCA);

    // 진짜 보코더(채널 보코더) 그래프 구성
    this._buildVocoder();

    this.setMode("fake");
    this.setChord(0);
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

      // modulator(mic) 밴드패스
      const bpM = ctx.createBiquadFilter();
      bpM.type = "bandpass"; bpM.frequency.value = f; bpM.Q.value = Q;
      // rectify -> envelope lowpass -> 증폭
      const rect = ctx.createWaveShaper(); rect.curve = shaper;
      const env = ctx.createBiquadFilter();
      env.type = "lowpass"; env.frequency.value = 18;
      const envAmp = ctx.createGain(); envAmp.gain.value = 14;

      // carrier 밴드패스 -> VCA(게인은 envelope이 제어)
      const bpC = ctx.createBiquadFilter();
      bpC.type = "bandpass"; bpC.frequency.value = f; bpC.Q.value = Q;
      const vca = ctx.createGain(); vca.gain.value = 0;

      this.mic.connect(bpM); bpM.connect(rect); rect.connect(env);
      env.connect(envAmp); envAmp.connect(vca.gain); // envelope -> AudioParam

      this.carrierBus.connect(bpC); bpC.connect(vca); vca.connect(this.vocSum);

      this.bands.push({ bpM, rect, env, envAmp, bpC, vca, f });
    }
    this.vocSum.connect(this.realVCA);
  }

  // ---- 제어 API ----
  setMode(mode) {
    this.mode = mode;
    const t = this.ctx.currentTime;
    if (mode === "real") {
      this.fakeVCA.gain.setTargetAtTime(0, t, 0.02);
      // realVCA는 chordOn에서 제어
      this._applyChordGain();
    } else {
      this.realVCA.gain.setTargetAtTime(0, t, 0.02);
      this._applyChordGain();
    }
  }

  setChord(i) {
    this.chordIndex = ((i % CHORDS.length) + CHORDS.length) % CHORDS.length;
    const notes = CHORDS[this.chordIndex].notes;
    const t = this.ctx.currentTime;
    const mult = Math.pow(2, this.octaveShift);
    for (let k = 0; k < this.oscs.length; k++) {
      this.oscs[k].frequency.setTargetAtTime(midiToFreq(notes[k]) * mult, t, 0.03);
    }
    return CHORDS[this.chordIndex].name;
  }

  nextChord() { return this.setChord(this.chordIndex + 1); }

  setOctaveShift(n) {
    if (n === this.octaveShift) return;
    this.octaveShift = Math.max(-1, Math.min(1, n));
    this.setChord(this.chordIndex);
  }

  setChordOn(on) {
    if (on === this.chordOn) return;
    this.chordOn = on;
    this._applyChordGain();
  }

  _applyChordGain() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.mode === "real") {
      this.realVCA.gain.setTargetAtTime(this.chordOn ? 1 : 0, t, 0.03);
    } else {
      // fake는 envelope로 매 프레임 갱신, 여기선 즉시 0 처리만
      if (!this.chordOn) this.fakeVCA.gain.setTargetAtTime(0, t, 0.03);
    }
  }

  // jawOpen(0~1) -> 마스터 로우패스 컷오프
  setJaw(v) {
    if (!this.ctx) return;
    const f = 700 + Math.min(1, Math.max(0, v)) * 7000;
    this.masterFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }

  // 왼손 높이(0~1) -> 딜레이 wet
  setSpace(v) {
    if (!this.ctx) return;
    const w = Math.min(0.7, Math.max(0, v) * 0.7);
    this.wet.gain.setTargetAtTime(w, this.ctx.currentTime, 0.1);
  }

  // 매 프레임: 가짜 보코더 envelope 적용 + 입력 레벨 측정
  update() {
    if (!this.ready) return 0;
    this.analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(sum / this._buf.length);
    this._env += (rms - this._env) * 0.3; // 평활
    const level = Math.min(1, this._env * 6);

    if (this.mode === "fake") {
      const target = this.chordOn ? Math.min(1, 0.15 + level * 1.6) : 0;
      this.fakeVCA.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    }
    return level; // 비주얼 리액티브용
  }

  get chordName() { return CHORDS[this.chordIndex].name; }
  async resume() { if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume(); }
}
