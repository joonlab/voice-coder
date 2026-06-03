// lyrics.js — 타임스탬프 기반 가사 동기화
// 데모용 자작 가사(원곡 가사 미사용). 사용자가 직접 흥얼거리며 보코더를 테스트하는 가이드.

export const LYRICS = [
  { t: 0.0,  text: "coding with my voice tonight" },
  { t: 3.5,  text: "open palm, the chord ignites" },
  { t: 7.0,  text: "close my fist, the silence calls" },
  { t: 10.5, text: "wink an eye, the octave falls" },
  { t: 14.0, text: "every gesture turns to sound" },
  { t: 18.0, text: "robot harmonies all around" },
  { t: 22.0, text: "open up and let it ring" },
  { t: 26.0, text: "this is how the engineers sing" },
];

export class LyricsPlayer {
  constructor(el) {
    this.el = el;
    this.startTime = 0;
    this.running = false;
    this.idx = -1;
  }
  start() {
    this.startTime = performance.now();
    this.running = true;
    this.idx = -1;
  }
  stop() {
    this.running = false;
    if (this.el) this.el.textContent = "";
  }
  update() {
    if (!this.running) return;
    const elapsed = (performance.now() - this.startTime) / 1000;
    // 루프(마지막 가사 + 4초 후 처음으로)
    const total = LYRICS[LYRICS.length - 1].t + 4;
    const tt = elapsed % total;
    let cur = -1;
    for (let i = 0; i < LYRICS.length; i++) {
      if (tt >= LYRICS[i].t) cur = i;
    }
    if (cur !== this.idx) {
      this.idx = cur;
      if (this.el) this.el.textContent = cur >= 0 ? LYRICS[cur].text : "";
    }
  }
}
