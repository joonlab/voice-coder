# 🎤 Voice Coder — 제스처 보코더 뮤직 (Python 하모나이저 + 웹 프론트)

손가락 제스처·눈썹·윙크로 **목소리를 화음(보컬 하모니)으로 변조**하는 실시간 퍼포먼스 앱.
인스타그램 "코딩으로 연주하는 뮤지션 Julip"의 `midicam` 시스템을 재현했습니다.

> 카메라는 브라우저, **오디오는 Python 백엔드(pedalboard 하모나이저)**가 처리합니다.
> 노래하면서 손가락을 펴면 내 목소리가 화음으로 겹쳐서 울립니다.

## 🏗 구조 (백엔드/프론트 분리)

```
[브라우저 프론트]                         [Python 백엔드 (FastAPI)]
 카메라 getUserMedia                       sounddevice 마이크 입력
 MediaPipe 손/얼굴 트래킹                   pedalboard 하모나이저 (PitchShift ×N)
 제스처 판별 · 박스/랜드마크                 → 헤드폰 출력
 피아노롤 · 터미널 로그 UI                          ▲
        │                                          │
        └──── WebSocket /ws ───────────────────────┘
              프론트→백: {chord/mode}  ·  백→프론트: {오디오 레벨}
```

- **목소리→화음**: pedalboard `PitchShift`를 여러 개 띄워 입력 보컬을 3도·5도·옥타브로 시프트 → 실시간 보컬 하모니
- **Face Mode**: 서브옥타브(-12) + 디스토션 = 빌런/로봇 톤
- 브라우저 Web Audio의 음질·지연 한계를 Python DSP로 해결

## 🚀 실행

```bash
cd backend
./run.sh          # 의존성 설치 + 서버 기동 (http://localhost:8000)
```

그다음 브라우저에서 **http://localhost:8000** 접속 → 시작하기.

🎧 **헤드폰 필수** — 마이크 소리가 출력되므로 스피커 사용 시 하울링이 발생합니다.

### 의존성 (backend/requirements.txt)
`fastapi`, `uvicorn`, `sounddevice`, `pedalboard`, `numpy`

## 🎛 제스처 → 화음

| 제스처 | 효과 |
|--------|------|
| ☝️ 검지 (`index_up`) | C — 낮고 어두운 보이싱 |
| ✌️ 브이 (`peace_sign`) | Em — 마이너 |
| 🤟 세 손가락 | Dm — 중간 |
| ✋ 손바닥 (`open_palm`) | A — 높은 코러스(메이저+옥타브) |
| 🤙 새끼 | G — 5도+옥타브 |
| ✊ 주먹 | 화음 OFF (드라이 보컬만) |
| 🤨 눈썹 올리기 | Hand ↔ Face 모드 전환 |
| 😉 윙크 (Face) | 뺨에 🌟 |

## 📁 구조

```
app/
├── index.html, style.css
├── js/
│   ├── main.js          # 루프 / 제스처→오디오 매핑
│   ├── tracking.js      # MediaPipe Hand+Face
│   ├── gesture.js       # 제스처/윙크/눈썹 판별
│   ├── gesture-chords.js# 제스처→화음 데이터(공유)
│   ├── ws-audio.js      # WebSocket 오디오 클라이언트
│   ├── visual.js, pianoroll.js, midilog.js
│   └── audio.js         # (구) Web Audio 폴백 — 미사용
└── backend/
    ├── server.py        # FastAPI + WebSocket + 정적 서빙
    ├── audio_engine.py  # pedalboard 하모나이저 + sounddevice
    ├── requirements.txt
    └── run.sh
```

## 📝 참고
- 원곡 가사·제목은 재현하지 않으며 placeholder를 사용합니다.
- 실시간 오디오 특성상 **로컬 실행 전용**입니다(클라우드 배포 불가).
