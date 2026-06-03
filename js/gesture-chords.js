// gesture-chords.js — 제스처 → 화음 데이터 (피아노롤/로그 표시용, 프론트·백 의미 일치)
// 실제 소리는 Python 백엔드(pedalboard 하모나이저)가 생성. 여기 voicing은 시각 표시용.
export const GESTURE_CHORDS = {
  index_up:         { midi: 60, name: "C",  voicing: [48, 55, 60, 64] }, // 낮고 어두움
  three_fingers_up: { midi: 62, name: "Dm", voicing: [50, 57, 62, 65] }, // 중간
  peace_sign:       { midi: 64, name: "Em", voicing: [52, 59, 64, 67] }, // 중상
  pinky_up:         { midi: 67, name: "G",  voicing: [55, 62, 67, 71] },
  open_palm:        { midi: 69, name: "Am", voicing: [69, 72, 76, 79] }, // 높은 코러스
};
