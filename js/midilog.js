// midilog.js — 실시간 MIDI 터미널 로그 UI (원본 midicam 재현)
// 타이틀바 "midicam — Python midicam_with_face_mode.py — 91×7" + 자동 스크롤 로그

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())},${p(d.getMilliseconds(), 3)}`;
}

export class MidiLog {
  constructor(bodyEl, { max = 9 } = {}) {
    this.body = bodyEl;
    this.max = max;
    this.lines = [];
  }

  _push(html) {
    this.lines.push(`<div class="log-line">${ts()} - <span class="lv">INFO</span> - ${html}</div>`);
    if (this.lines.length > this.max) this.lines.shift();
    this.body.innerHTML = this.lines.join("");
    this.body.scrollTop = this.body.scrollHeight;
  }

  noteOn(n)  { this._push(`MIDI Note On: <span class="num">${n}</span>`); }
  noteOff(n) { this._push(`MIDI Note Off: <span class="num">${n}</span>`); }
  gesture(label) { this._push(`Triggered MIDI for gesture: <span class="g">${label}</span>`); }
  faceGesture(label) { this._push(`Detected face gesture: <span class="g">${label}</span>`); }
  info(msg) { this._push(`<span class="sys">${msg}</span>`); }
}
