# 🎤 Voice Coder — 제스처 보코더 뮤직 웹앱

손 제스처·윙크·입 모양으로 **보코더(보컬 하모니)**를 연주하는 브라우저 웹앱.
인스타그램에서 화제가 된 "코딩으로 연주하는 뮤지션 Julip"의 시스템을 웹 기술로 재현한 클론입니다.

> 카메라로 손을 펴면 목소리가 화음으로 퍼지고, 주먹을 쥐면 멈춥니다.
> 윙크로 옥타브를 바꾸고, 입을 벌리면 필터가 열립니다. **모두 브라우저 안에서, 서버 없이.**

## ✨ 기능

| 동작 | 효과 |
|------|------|
| ✋ 손 펴기 (`open_palm`) | 보코더 화음 ON |
| ✊ 주먹 (`closed_fist`) | 화음 OFF |
| ✌️ 브이 (`victory`) | 코드 전환 (Cmaj7 → Dm7 → …) |
| 👌 OK | 보코더 모드 토글 (가짜 ↔ 진짜 채널 보코더) |
| 😉 윙크 | 옥타브 ±1 |
| 😮 입 벌리기 | 로우패스 필터 열림 (와우 효과) |
| 🖐 보조손 높이 | 공간감(딜레이) 조절 |

## 🛠 기술 스택

- **트래킹**: [MediaPipe Tasks-Vision](https://ai.google.dev/edge/mediapipe) — HandLandmarker + FaceLandmarker(blendshapes)
- **오디오**: Web Audio API (네이티브, 의존성 없음)
  - *가짜 보코더*: 마이크 envelope → 코드 신스 게인 변조 (저지연·안정)
  - *진짜 보코더*: 16밴드 채널 보코더 (밴드패스 뱅크 + envelope follower)
- **비주얼**: Canvas 2D (오디오 리액티브 네온 바운딩 박스)
- **빌드**: 없음. Vanilla JS + ESM, 정적 호스팅

## 🚀 실행

카메라/마이크는 **HTTPS 또는 localhost**에서만 동작합니다.

```bash
python3 -m http.server 8123
# http://localhost:8123 접속
```

🎧 **헤드폰 권장** — 스피커 사용 시 진짜 보코더 모드에서 하울링이 생길 수 있습니다.

## 📁 구조

```
.
├── index.html
├── style.css
├── js/
│   ├── main.js     # 부트스트랩 / 루프 / 제스처→오디오 매핑
│   ├── tracking.js # MediaPipe Hand+Face 초기화
│   ├── gesture.js  # 손가락/윙크/입 판별 휴리스틱
│   ├── audio.js    # Web Audio 보코더 엔진 (가짜/진짜)
│   ├── visual.js   # Canvas 오버레이
│   └── lyrics.js   # 타임스탬프 가사
└── docs/
    ├── SPEC.md     # 설계 문서
    └── 01_analysis # 원본 영상 분석 (Gemini 3.1 Pro)
```

## 📝 참고

- 가사는 데모용 자작 텍스트이며 원곡 가사를 사용하지 않습니다.
- 손 제스처 판별 휴리스틱은 [joonlab/cyberpunk-hand-particles](https://github.com/joonlab/cyberpunk-hand-particles)의 접근을 거리 기반으로 개선해 재구성했습니다.
