// gesture.js — 손/얼굴 랜드마크를 의미있는 제스처/이벤트로 해석
// v2: 손가락 카운트 기반 다중 제스처 + 눈썹 올림(모드 전환) + 윙크
// 참고: joonlab/cyberpunk-hand-particles 의 detectGesture 휴리스틱을 거리 기반으로 개선.

const TIPS = [4, 8, 12, 16, 20]; // 엄지, 검지, 중지, 약지, 새끼
const PIPS = [3, 6, 10, 14, 18];
const WRIST = 0;

// MediaPipe Hand 연결선 (랜드마크 선 렌더링용)
export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function dist2d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.05;
}
function thumbExtended(lm) {
  return dist2d(lm[4], lm[5]) > dist2d(lm[2], lm[5]) * 1.4;
}

/**
 * 손 랜드마크(21점) → 제스처 라벨 (midicam 원본과 동일 명칭)
 * @returns {{label, fingers, pinch}}
 */
export function detectHandGesture(lm) {
  const fingers = [thumbExtended(lm)];
  for (let i = 1; i < 5; i++) fingers.push(fingerExtended(lm, TIPS[i], PIPS[i]));
  const [thumb, index, middle, ring, pinky] = fingers;

  const handSpan = dist2d(lm[0], lm[9]) || 1;
  const pinchDist = dist2d(lm[4], lm[8]) / handSpan;

  let label;
  if (pinchDist < 0.32 && middle && ring && pinky) {
    label = "ok_sign";
  } else if (!index && !middle && !ring && !pinky) {
    label = "closed_fist";
  } else if (index && !middle && !ring && !pinky) {
    label = "index_up";
  } else if (index && middle && !ring && !pinky) {
    label = "peace_sign";
  } else if (index && middle && ring && !pinky) {
    label = "three_fingers_up";
  } else if (index && middle && ring && pinky) {
    label = "open_palm";
  } else if (!index && !middle && !ring && pinky) {
    label = "pinky_up";
  } else {
    label = "open_palm";
  }
  return { label, fingers, thumb, pinch: pinchDist };
}

// 손 랜드마크 → 화면 바운딩 박스(normalized) + 중심/높이
export function handBox(lm) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.04;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad);
  return { minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    heightN: 1 - (minY + maxY) / 2 };
}

// 얼굴 랜드마크 → 바운딩 박스 (윙크 별 위치 계산에도 사용)
export function faceBox(lm) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.02;
  return {
    minX: Math.max(0, minX - pad), minY: Math.max(0, minY - pad * 2),
    maxX: Math.min(1, maxX + pad), maxY: Math.min(1, maxY + pad),
  };
}

// ---- 얼굴 blendshape 해석 ----
export function blendMap(faceResult) {
  const out = {};
  const cats = faceResult?.faceBlendshapes?.[0]?.categories;
  if (!cats) return out;
  for (const c of cats) out[c.categoryName] = c.score;
  return out;
}

export function faceState(blends) {
  const L = blends.eyeBlinkLeft ?? 0;
  const R = blends.eyeBlinkRight ?? 0;
  const jaw = blends.jawOpen ?? 0;
  const brow = ((blends.browInnerUp ?? 0) * 0.6
    + (blends.browOuterUpLeft ?? 0) * 0.5
    + (blends.browOuterUpRight ?? 0) * 0.5);
  const WINK = 0.5, OPEN = 0.28;
  // 주의: MediaPipe categoryName의 Left/Right는 피사체 기준 → 화면(거울)에선 반대
  const winkLeft = L > WINK && R < OPEN;   // 피사체 왼눈
  const winkRight = R > WINK && L < OPEN;   // 피사체 오른눈
  const bothBlink = L > WINK && R > WINK;
  const eyebrowRaise = brow > 0.45;
  return { winkLeft, winkRight, bothBlink, eyebrowRaise, jawOpen: jaw, brow, eyeL: L, eyeR: R };
}

// 윙크 별(🌟)을 그릴 뺨 좌표 (FaceLandmarker 468 랜드마크 인덱스)
// 오른쪽 뺨 ≈ 425, 왼쪽 뺨 ≈ 205 (피사체 기준)
export function cheekPoint(faceLm, side) {
  const idx = side === "right" ? 280 : 50; // 눈밑 뺨 근처
  const p = faceLm?.[idx];
  return p ? { x: p.x, y: p.y } : null;
}
