// visual.js — Canvas 오버레이 (v2): 바운딩 박스 + 랜드마크 점/선 + 마젠타 라벨 + 얼굴/윙크 🌟
import { HAND_CONNECTIONS } from "./gesture.js";

const MAGENTA = "#ff2d95";
const MAGENTA_HI = "#ff7ac0";

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
  }
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
  }
  clear() { this.g.clearRect(0, 0, this.W, this.H); }

  _mx(x) { return (1 - x) * this.W; } // 거울 반전 X
  _my(y) { return y * this.H; }

  drawHands(items, level) {
    const g = this.g;
    for (const it of items) {
      const lm = it.landmarks;
      // 연결선
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = 1.4;
      g.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo(this._mx(lm[a].x), this._my(lm[a].y));
        g.lineTo(this._mx(lm[b].x), this._my(lm[b].y));
      }
      g.stroke();
      // 점
      g.fillStyle = MAGENTA;
      for (const p of lm) {
        g.beginPath();
        g.arc(this._mx(p.x), this._my(p.y), 2.6, 0, Math.PI * 2);
        g.fill();
      }
      // 박스
      this._box(it.box, level, true);
      // 라벨 (칩 없음, 마젠타)
      this._label(it.box, it.label);
    }
  }

  drawFace(item) {
    if (!item) return;
    this._box(item.box, 0.3, false);
    this._label(item.box, item.label);
  }

  _box(b, level, glow) {
    const g = this.g;
    const x = this._mx(b.maxX), y = this._my(b.minY);
    const w = (b.maxX - b.minX) * this.W, h = (b.maxY - b.minY) * this.H;
    g.save();
    g.strokeStyle = MAGENTA;
    g.shadowColor = MAGENTA;
    g.shadowBlur = glow ? 8 + level * 30 : 6;
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    g.restore();
  }

  _label(b, text) {
    const g = this.g;
    const x = this._mx(b.maxX), y = this._my(b.minY);
    g.save();
    g.font = "600 14px ui-monospace, Menlo, monospace";
    g.fillStyle = MAGENTA_HI;
    g.shadowColor = "rgba(0,0,0,0.9)";
    g.shadowBlur = 4;
    g.fillText(text, x + 2, y - 7);
    g.restore();
  }

  // 윙크 별 (뺨 좌표, normalized)
  drawStars(points) {
    const g = this.g;
    g.save();
    g.font = "26px serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of points) {
      if (!p) continue;
      g.fillText("🌟", this._mx(p.x), this._my(p.y));
    }
    g.restore();
  }

  flash(strength = 1, color = "57,255,20") {
    const g = this.g, W = this.W, H = this.H;
    g.save();
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(${color},${0.22 * strength})`);
    grad.addColorStop(0.16, `rgba(${color},0)`);
    grad.addColorStop(0.84, `rgba(${color},0)`);
    grad.addColorStop(1, `rgba(${color},${0.22 * strength})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}
