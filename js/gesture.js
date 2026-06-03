// gesture.js — 손/얼굴 랜드마크를 의미있는 제스처/이벤트로 해석
// 참고: joonlab/cyberpunk-hand-particles 의 detectGesture 휴리스틱을
// 거리 기반(회전에 강건)으로 개선하여 재구성.

const TIPS = [4, 8, 12, 16, 20]; // 엄지, 검지, 중지, 약지, 새끼
const PIPS = [3, 6, 10, 14, 18]; // 각 손가락 PIP(엄지는 IP)
const WRIST = 0;

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// 검지~새끼: tip이 wrist에서 pip보다 멀면 펴진 것 (손 방향 무관)
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.05;
}

// 엄지: 끝(4)이 검지 MCP(5)에서 멀어지면 펴진 것
function thumbExtended(lm) {
  return dist2d(lm[4], lm[5]) > dist2d(lm[2], lm[5]) * 1.4;
}

/**
 * 손 랜드마크(21점, normalized) → 제스처 라벨
 * @returns {{label:string, fingers:boolean[], pinch:number}}
 */
export function detectHandGesture(lm) {
  const fingers = [thumbExtended(lm)];
  for (let i = 1; i < 5; i++) fingers.push(fingerExtended(lm, TIPS[i], PIPS[i]));

  const [, index, middle, ring, pinky] = fingers;
  const upCount = fingers.filter(Boolean).length;

  // 엄지-검지 끝 거리 (핀치/OK 판별용, 손 크기로 정규화)
  const handSpan = dist2d(lm[0], lm[9]) || 1;
  const pinchDist = dist2d(lm[4], lm[8]) / handSpan;

  let label = "unknown";

  if (pinchDist < 0.35 && middle && ring && pinky) {
    label = "ok";
  } else if (pinchDist < 0.3 && !middle && !ring && !pinky) {
    label = "pinch";
  } else if (index && middle && !ring && !pinky) {
    label = "victory";
  } else if (index && !middle && !ring && !pinky) {
    label = "point";
  } else if (upCount >= 4) {
    label = "open_palm";
  } else if (upCount <= 1) {
    label = "closed_fist";
  } else {
    label = "open_palm"; // 애매하면 열림으로(소리 끊김 방지)
  }

  return { label, fingers, pinch: pinchDist };
}

// 손 랜드마크 → 화면 바운딩 박스(normalized 0~1) + 중심/높이
export function handBox(lm) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.03;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad);
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    heightN: 1 - (minY + maxY) / 2, // 위로 올릴수록 1에 가까움
  };
}

// ---- 얼굴 blendshape 해석 ----
// FaceLandmarker outputFaceBlendshapes 의 categories 배열 → {이름: 점수}
export function blendMap(faceResult) {
  const out = {};
  const cats = faceResult?.faceBlendshapes?.[0]?.categories;
  if (!cats) return out;
  for (const c of cats) out[c.categoryName] = c.score;
  return out;
}

// 윙크/깜빡임/입벌림 상태 판별 (디바운스는 호출측에서)
export function faceState(blends) {
  const L = blends.eyeBlinkLeft ?? 0;
  const R = blends.eyeBlinkRight ?? 0;
  const jaw = blends.jawOpen ?? 0;
  const WINK = 0.5, OPEN = 0.25;
  const winkLeft = L > WINK && R < OPEN;
  const winkRight = R > WINK && L < OPEN;
  const bothBlink = L > WINK && R > WINK;
  return { winkLeft, winkRight, bothBlink, jawOpen: jaw, eyeL: L, eyeR: R };
}
