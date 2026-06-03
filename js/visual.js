// visual.js — Canvas 오버레이 렌더링 (바운딩 박스, 제스처 라벨, 오디오 리액티브)
// 좌표: video는 CSS scaleX(-1) 거울. canvas는 비반전이므로 x를 (1-x)로 그려 거울 일치.

const PINK = "#ff2d95";
const GREEN = "#39ff14";

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }

  clear() {
    this.g.clearRect(0, 0, this.W, this.H);
  }

  /**
   * @param {Array<{box, label, handed}>} handItems
   * @param {number} level 0~1 오디오 입력 레벨
   * @param {boolean} chordOn
   */
  drawHands(handItems, level, chordOn) {
    const g = this.g, W = this.W, H = this.H;
    const color = chordOn ? GREEN : PINK;

    for (const it of handItems) {
      const b = it.box;
      const x = (1 - b.maxX) * W;          // 거울 반전
      const y = b.minY * H;
      const w = (b.maxX - b.minX) * W;
      const h = (b.maxY - b.minY) * H;

      g.save();
      g.strokeStyle = color;
      g.shadowColor = color;
      g.shadowBlur = chordOn ? 10 + level * 45 : 6;
      g.lineWidth = chordOn ? 2 + level * 4 : 1.6;
      g.strokeRect(x, y, w, h);

      // 코너 액센트
      const c = Math.min(w, h) * 0.18;
      g.lineWidth += 0.5;
      g.beginPath();
      g.moveTo(x, y + c); g.lineTo(x, y); g.lineTo(x + c, y);
      g.moveTo(x + w - c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + c);
      g.moveTo(x, y + h - c); g.lineTo(x, y + h); g.lineTo(x + c, y + h);
      g.moveTo(x + w - c, y + h); g.lineTo(x + w, y + h); g.lineTo(x + w, y + h - c);
      g.stroke();

      // 라벨 (박스 좌상단)
      g.shadowBlur = 0;
      g.font = "600 14px ui-monospace, Menlo, monospace";
      const text = it.label;
      const tw = g.measureText(text).width;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x, y - 22, tw + 12, 18);
      g.fillStyle = color;
      g.fillText(text, x + 6, y - 8);

      // handedness 태그 (우상단)
      if (it.handed) {
        g.font = "500 11px ui-monospace, Menlo, monospace";
        g.fillStyle = "rgba(255,255,255,0.6)";
        const ht = it.handed;
        g.fillText(ht, x + w - g.measureText(ht).width - 2, y - 8);
      }
      g.restore();
    }
  }

  // 윙크/이벤트 발생 시 가장자리 네온 플래시
  flash(strength = 1) {
    const g = this.g, W = this.W, H = this.H;
    g.save();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(57,255,20,${0.25 * strength})`);
    grad.addColorStop(0.15, "rgba(57,255,20,0)");
    grad.addColorStop(0.85, "rgba(57,255,20,0)");
    grad.addColorStop(1, `rgba(57,255,20,${0.25 * strength})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}
