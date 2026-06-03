// pianoroll.js — DAW 스타일 미니 피아노롤 (트리거된 MIDI 노트가 좌로 흐름)

const LO = 45;   // 표시 MIDI 하한
const HI = 84;   // 상한
const PX_PER_SEC = 46;
const WINDOW_SEC = 7;

export class PianoRoll {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.notes = [];      // {midi, start, end}
    this.active = new Map(); // midi -> note (진행중)
    this.t0 = performance.now();
  }
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }
  _now() { return (performance.now() - this.t0) / 1000; }

  noteOn(midi) {
    const n = { midi, start: this._now(), end: null };
    this.notes.push(n);
    this.active.set(midi, n);
  }
  noteOff(midi) {
    const n = this.active.get(midi);
    if (n) { n.end = this._now(); this.active.delete(midi); }
  }
  // 화음 전체 교체 (이전 진행음 종료 후 새 노트 시작)
  setChord(midiArr) {
    for (const m of [...this.active.keys()]) this.noteOff(m);
    for (const m of midiArr) this.noteOn(m);
  }
  allOff() { for (const m of [...this.active.keys()]) this.noteOff(m); }

  render() {
    const g = this.g, W = this.W, H = this.H;
    const now = this._now();
    g.clearRect(0, 0, W, H);

    // 배경
    g.fillStyle = "#160a12";
    g.fillRect(0, 0, W, H);

    const yOf = (m) => H - ((m - LO) / (HI - LO)) * H;

    // 가로 격자 (옥타브 C 라인 강조)
    g.lineWidth = 1;
    for (let m = LO; m <= HI; m++) {
      const y = yOf(m);
      if (m % 12 === 0) { g.strokeStyle = "rgba(255,255,255,0.10)"; }
      else if ([1,3,6,8,10].includes(m % 12)) { g.strokeStyle = "rgba(255,255,255,0.02)"; }
      else continue;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    // 세로 격자 (1초 단위)
    g.strokeStyle = "rgba(255,255,255,0.05)";
    for (let s = 0; s <= WINDOW_SEC; s++) {
      const x = W - s * PX_PER_SEC;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    // 플레이헤드
    g.strokeStyle = "rgba(57,255,20,0.5)";
    g.beginPath(); g.moveTo(W - 2, 0); g.lineTo(W - 2, H); g.stroke();

    // 노트 블록
    const noteH = Math.max(3, H / (HI - LO) - 1);
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      const end = n.end ?? now;
      const xEnd = W - (now - end) * PX_PER_SEC;
      const xStart = W - (now - n.start) * PX_PER_SEC;
      if (xEnd < 0) { this.notes.splice(i, 1); continue; }
      const w = Math.max(3, xEnd - xStart);
      const y = yOf(n.midi) - noteH / 2;
      const live = n.end === null;
      g.fillStyle = live ? "#ff4db8" : "#c9358f";
      g.shadowColor = "#ff2d95";
      g.shadowBlur = live ? 8 : 0;
      g.fillRect(xStart, y, w, noteH);
      g.shadowBlur = 0;
    }
  }
}
