// ws-audio.js — Python 하모나이저 백엔드와 통신하는 오디오 클라이언트
// 기존 AudioEngine과 동일한 인터페이스(main.js 호환). 실제 소리는 Python이 마이크→화음→헤드폰.
import { GESTURE_CHORDS } from "./gesture-chords.js";

export class WsAudio {
  constructor() {
    this.in = 0;          // 마이크 입력 레벨(백엔드 전달, 시각 리액티브)
    this.out = 0;         // 출력 레벨
    this.ready = false;
    this.connected = false;
    this.backendRunning = false;
    this.backendError = null;
    this.chordOn = false;
    this.audioMode = "hand";
    this.vocoderType = "real";
    this.octaveShift = 0;
    this.currentVoicing = GESTURE_CHORDS.open_palm.voicing;
  }

  // stream 인자는 호환용(미사용) — 마이크는 Python이 직접 잡음
  async init() {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        this.ws = new WebSocket(`${proto}://${location.host}/ws`);
        this.ws.onopen = () => { this.ready = true; this.connected = true; done(); };
        this.ws.onerror = () => { this.ready = true; done(); };
        this.ws.onclose = () => { this.connected = false; };
        this.ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === "level") {
            this.in = m.in; this.out = m.out;
            this.backendRunning = m.running; this.backendError = m.error;
          }
        };
      } catch (_) { this.ready = true; done(); }
      setTimeout(done, 2500); // 연결 지연 대비 타임아웃
    });
  }

  _send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  applyGesture(label) {
    const c = GESTURE_CHORDS[label];
    if (!c) return null;
    this.currentVoicing = c.voicing;
    this._send({ type: "chord", gesture: label });
    return { midi: c.midi, name: c.name };
  }

  setChordOn(on) {
    this.chordOn = on;
    if (!on) this._send({ type: "chordOff" });
  }

  setAudioMode(mode) {
    this.audioMode = mode;
    this._send({ type: "mode", mode });
  }

  // 호환용 no-op / 패스스루
  setVoicing(v) { this.currentVoicing = v; }
  setVocoderType(t) { this.vocoderType = t; }
  setJaw() {}
  setSpace() {}
  nextChord() {}

  update() { return this.in; }        // 시각 리액티브(입력 레벨)
  getOutputLevel() { return this.out; }
  async resume() {}
}
