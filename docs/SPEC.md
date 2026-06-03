# Julip 클론 — 제스처 보코더 뮤직 웹앱 (Spec)

> 원본: 인스타그램 "코딩으로 연주하는 뮤지션 Julip" (Meta SWE & 뮤지션)
> 얼굴 인식·손 제스처·윙크로 보코더/하드튜닝을 제어하는 시스템.
> 작성일: 2026-06-03

---

## 1. 원본 영상 분석 요약 (Gemini 3.1 Pro 분석 기반)

분석 원본: `01_analysis/20260603_181623_qa_3.1-pro.md`

| 항목 | 관찰 결과 |
|------|-----------|
| 레이아웃 | 세로(9:16) 풀스크린 웹캠 + 상단 한글 카피 + 하단 영어 가사 자막 |
| 트래킹 오버레이 | 오른손 주변 **분홍 네온 바운딩 박스** + 좌상단 라벨(`open_palm`/`closed_fist`) |
| 랜드마크 | 점/선 메시는 표시 안 함 (박스만) |
| 제스처 제어 | **손 펴기 → 화음 ON / 주먹 → OFF(또는 코드 전환)**. 위치가 아니라 *상태*가 트리거 |
| 얼굴/윙크 | 이 30초 클립엔 실제 트리거 없음 (소개문 컨셉상 존재) → **클론에서 확장 구현** |
| 오디오 | 아카펠라 + 보코더/하모나이저(목소리 carrier) + 옅은 오토튠. 백킹 트랙 없음 |
| 무드 | Lo-fi 베드룸팝 + 너디 해킹 감성. 화려한 파티클/글리치 없음, 1px 네온 라인 |

---

## 2. 확정 결정사항 (사용자 승인 2026-06-03)

1. **오디오 엔진**: 가짜 보코더(기본) + 진짜 보코더(AudioWorklet) **토글 전환** 둘 다 구현
2. **제어 범위**: 손 제스처 + **얼굴/윙크 확장** (MediaPipe Hands + FaceLandmarker)
3. **기술 스택**: **Vanilla JS 단일 HTML** (ESM importmap, CDN, 빌드 없음)
4. **배포**: GitHub repo 생성 → **Vercel 프로젝트 연동** → commit&push 시 자동 배포

---

## 3. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                        Browser (HTTPS)                    │
│                                                           │
│  getUserMedia(video+audio)                                │
│        │                                                  │
│        ├──> <video> ──> MediaPipe Tasks-Vision            │
│        │                 ├─ HandLandmarker (제스처)       │
│        │                 └─ FaceLandmarker (윙크/입)      │
│        │                        │                         │
│        │                        ▼                         │
│        │                 GestureMapper                    │
│        │                 (랜드마크 → 이벤트/파라미터)     │
│        │                        │                         │
│        │           ┌────────────┴───────────┐            │
│        │           ▼                         ▼            │
│        │     VisualLayer              AudioEngine          │
│        │     (Canvas 오버레이)        ├─ FakeVocoder      │
│        │     - 바운딩 박스            │  (env→synth gain) │
│        │     - 라벨/가사              └─ RealVocoder      │
│        │     - 오디오 리액티브           (AudioWorklet)   │
│        │           │                         │            │
│        └──────> <canvas>            Web Audio destination  │
└─────────────────────────────────────────────────────────┘
```

### 모듈 (단일 HTML 내 `<script type="module">` 섹션 또는 분리 .js)
- `tracking.js` — MediaPipe Hands + Face 초기화, onResults 콜백
- `gesture.js` — 손가락 펴짐/접힘 휴리스틱(레포 `detectGesture` 재사용), 윙크/입 판별
- `audio.js` — AudioEngine: FakeVocoder / RealVocoder(AudioWorklet) + 코드/스케일
- `visual.js` — Canvas 렌더링(박스, 라벨, 가사, 오디오 리액티브 글로우)
- `lyrics.js` — 타임스탬프 가사 데이터 + 동기화
- `worklet/vocoder-processor.js` — AudioWorklet 진짜 보코더 DSP
- `main.js` — 부트스트랩, 상태(state), 루프

> Vanilla 단일 HTML 원칙이지만, 가독성을 위해 모듈 파일 분리(ESM `import`).
> AudioWorklet은 별도 파일이 **필수**(`audioWorklet.addModule`).

---

## 4. 인터랙션 → 효과 매핑

### 손 제스처 (오른손 = 주 연주손)
| 제스처 | 인식 라벨 | 효과 |
|--------|-----------|------|
| 손바닥 펴기 | `open_palm` | 보코더 화음 **ON** (현재 코드 재생) |
| 주먹 | `closed_fist` | 보코더 화음 **OFF** (음소거/서스테인 끊기) |
| 브이 | `victory` | 다음 코드로 전환 (코드 진행 순환) |
| OK | `ok` | 진짜/가짜 보코더 모드 토글 (또는 이펙트 프리셋) |
| 핀치(엄지+검지) | `pinch` | (손 위치 피치 옵션 시) 미세 피치/필터 |

### 왼손 (옵션, 보조)
| 제스처 | 효과 |
|--------|------|
| 손 높이(Y) | 마스터 리버브/딜레이 양 |

### 얼굴/윙크 (FaceLandmarker)
| 동작 | 판별 | 효과 |
|------|------|------|
| 윙크(한쪽 눈) | 한쪽 eye blendshape > 임계, 반대쪽 < 임계 | **옥타브 점프** 또는 에코 원샷 |
| 양눈 깜빡 | 양쪽 blink 동시 | 필터 스윕 트리거 |
| 입 벌림 | jawOpen blendshape | 로우패스 필터 컷오프 ↑ (와우 효과) |

> blendshape는 MediaPipe FaceLandmarker `outputFaceBlendshapes: true`로 획득
> (`eyeBlinkLeft`, `eyeBlinkRight`, `jawOpen` 등 52개 ARKit 호환 계수).

---

## 5. 오디오 엔진 설계

### 공통
- `AudioContext` 1개, `getUserMedia` 마이크 → `MediaStreamSource`
- 코드/스케일: C 메이저 다이어토닉 기본 (예: Cmaj7, Dm7, Em7, Fmaj7, G7, Am7)
- 제스처 화음 ON 시 현재 코드의 3~4개 음을 발음

### A. FakeVocoder (기본, 안정적)
- 마이크 → `AnalyserNode`(RMS/envelope 추출)
- 코드 음마다 `OscillatorNode`(saw) → `GainNode`
- envelope → 각 음 gain에 매핑 (말할 때 화음이 살아남)
- 톤 다듬기: `BiquadFilter`(lowpass), 약간의 `WaveShaper`
- 장점: 레이턴시 거의 0, 하울링 없음, 데모 품질 안정

### B. RealVocoder (토글, 인상적)
- 채널 보코더: 마이크(modulator) + 내부 신스(carrier)
- AudioWorklet `vocoder-processor.js`:
  - N개(예: 16) 밴드패스 필터 뱅크 (modulator/carrier 각각)
  - modulator 각 밴드 envelope → carrier 각 밴드 gain 곱
  - 합산 출력
- carrier = 코드 음 합성(saw 다중)
- 주의: 마이크 모니터링 시 **헤드폰 권장**(하울링 방지), 레이턴시 고지

### 토글
- `OK` 제스처 또는 UI 버튼으로 A↔B 전환
- 전환 시 현재 코드/게인 상태 유지

---

## 6. 비주얼 설계

- `<video>`는 거울 모드(`transform: scaleX(-1)`), `<canvas>` 오버레이 동일 반전
- **바운딩 박스**: 손 랜드마크 min/max로 사각형, 1.5px 네온(핑크 `#ff2d95`)
  - 화음 ON일 때 네온 그린(`#39ff14`)으로 변색 + 글로우 (오디오 리액티브)
- **라벨**: 박스 좌상단 `open_palm` 등 monospace 소문자
- **가사**: 하단 중앙, 흰색 sans-serif, 타임스탬프 기반 2줄 교체
- **상단 카피**: "개발자가 뮤지션이면 목소리도 코딩한다" (토글 가능)
- 오디오 리액티브: envelope로 박스 두께/글로우 반경 변조
- 전체 무드: 어두운 배경 + 네온 라인 (원본 lo-fi + 약간의 사이버 가미)

---

## 7. 기술 스택 / CDN

| 영역 | 라이브러리 | CDN |
|------|-----------|-----|
| 손/얼굴 트래킹 | **@mediapipe/tasks-vision** (HandLandmarker, FaceLandmarker) | jsdelivr |
| 오디오(가짜) | Web Audio API 네이티브 (+ 선택적 Tone.js) | - |
| 오디오(진짜) | AudioWorklet 네이티브 | - |
| 비주얼 | Canvas 2D 네이티브 | - |

> 참고 레포(`cyberpunk-hand-particles`)는 구버전 `@mediapipe/hands` 사용.
> 클론은 **신버전 tasks-vision**(Hand+Face 통합, blendshape 지원)으로 업그레이드.
> `detectGesture` 휴리스틱(손가락 펴짐/접힘)은 인덱스 매핑 그대로 재사용.

---

## 8. 구현 로드맵

- [ ] **M0 셋업**: 폴더/파일 골격, index.html, https 로컬서버 확인
- [ ] **M1 트래킹+비주얼**: 웹캠 → HandLandmarker → 바운딩 박스 + 제스처 라벨
- [ ] **M2 가짜 보코더**: 마이크 envelope → 코드 신스, 손 펴기/주먹으로 ON/OFF
- [ ] **M3 코드 전환/가사**: victory→코드 순환, 타임스탬프 가사 동기화
- [ ] **M4 얼굴/윙크**: FaceLandmarker blendshape → 윙크/입벌림 효과
- [ ] **M5 진짜 보코더**: AudioWorklet 채널 보코더 + 토글
- [ ] **M6 마감**: 오디오 리액티브 비주얼, 시작 화면(권한/헤드폰 안내), 반응형
- [ ] **M7 QA**: cmux browser E2E (카메라/마이크 권한, 콘솔 에러)
- [ ] **M8 배포**: GitHub repo + Vercel 연동, push 자동 배포

---

## 9. 리스크 / 주의사항

- **권한/HTTPS**: getUserMedia는 https 또는 localhost 필요. Vercel 배포로 해결
- **하울링**: 진짜 보코더 + 스피커 → 피드백. 시작 화면에서 헤드폰 안내
- **레이턴시**: 브라우저 DSP 한계 → 가짜 보코더를 기본값으로
- **거울 좌표**: video 반전과 canvas/제스처 좌표계 일치 주의(레포처럼 x 반전)
- **MediaPipe 로딩**: wasm/model 최초 로드 지연 → 로딩 인디케이터 필수
- **모바일**: 우선 데스크톱 크롬 타겟, 모바일은 best-effort

---

## 10. v2 고도화 (두 번째 영상 반영, 2026-06-03)

분석 원본: `01_analysis/20260603_184936_qa_3.1-pro.md`

두 번째 영상은 첫 영상과 **비주얼 정체성이 완전히 다름** — 깔끔한 무대가 아니라
**개발자 화면 녹화 데모**(웹캠 + DAW 피아노롤 + 실시간 MIDI 터미널 로그).
`midicam_with_face_mode.py`라는 실제 파이썬 스크립트가 돌아가는 화면.

### 변경/추가 사항
- **손가락 카운트 제스처** → 각자 다른 MIDI 노트/화음
  - `index_up`→C(60, 낮음), `peace_sign`→E(64), `three_fingers_up`→D(62), `open_palm`→A(69, 높은 코러스), `closed_fist`→OFF
- **눈썹 올리기(`eyebrow_raise`)** → **Hand ↔ Face 모드 토글**
- **Face Mode**: 서브옥타브(-1) + 디스토션 = 빌런/로봇 보코더 톤
- **윙크(`right_wink`/`left_wink`)** → 뺨 좌표에 🌟 이모지 렌더 + 로그
- **바운딩 박스 내부 랜드마크 점/연결선** 렌더 (첫 영상은 박스만)
- **라벨**: 배경칩 제거, 마젠타 텍스트
- **터미널 로그 UI**(`midilog.js`): 타이틀바 `midicam — Python midicam_with_face_mode.py — 91×7`,
  `HH:MM:SS,sss - INFO - MIDI Note On/Off / Triggered MIDI for gesture / Detected face gesture` 자동 스크롤
- **DAW 피아노롤**(`pianoroll.js`): 트리거된 MIDI 노트가 좌로 흐르는 미니 캔버스
- **곡 정보 박스**: 반투명 마룬(#4a121e) + 그리드 패턴 (제목은 저작권상 자작 placeholder)
- 가사 자막 제거(`lyrics.js` 미사용) — 원본 2영상에도 가사 없음

### 저작권 처리
- 원곡 제목/가사/캡션 문구는 재현하지 않음 → placeholder/자작 텍스트
- 기능 텍스트(open_palm, MIDI Note On 등), 로그, 🌟 이모지는 기능 요소라 재현
