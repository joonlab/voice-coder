// main.js (v2) — 손가락 제스처→MIDI 화음 / 눈썹→Face Mode / 윙크→🌟 / 터미널 로그·피아노롤
import { createTracker } from "./tracking.js";
import {
  detectHandGesture, handBox, faceBox, blendMap, faceState, cheekPoint,
} from "./gesture.js";
import { WsAudio } from "./ws-audio.js";
import { GESTURE_CHORDS } from "./gesture-chords.js";
import { Visualizer } from "./visual.js";
import { MidiLog } from "./midilog.js";
import { PianoRoll } from "./pianoroll.js";

const $ = (id) => document.getElementById(id);
const els = {
  video: $("video"), overlay: $("overlay"), roll: $("roll"),
  logBody: $("log-body"), startScreen: $("start-screen"), startBtn: $("start-btn"),
  modeTag: $("mode-tag"), gestureTag: $("gesture-tag"),
};

const state = {
  running: false, mode: "hand",
  handItems: [], faceItem: null, lastFaceLm: null,
  level: 0,
  lastSeen: "", seenCount: 0, confirmedGesture: "",
  lastEyebrow: 0, browArmed: false, lastWinkR: 0, lastWinkL: 0,
  winkUntil: { right: 0, left: 0 },
  flash: 0, flashColor: "57,255,20",
};

let tracker, audio, viz, log, roll;

async function start() {
  els.startBtn.disabled = true;
  els.startBtn.textContent = "초기화 중…";
  try {
    // 카메라만 요청 (마이크는 Python 백엔드가 직접 사용)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    els.video.srcObject = stream;
    await els.video.play();

    viz = new Visualizer(els.overlay);
    roll = new PianoRoll(els.roll);
    syncSize();
    window.addEventListener("resize", syncSize);

    audio = new WsAudio();
    await audio.init();

    log = new MidiLog(els.logBody);
    if (audio.connected && audio.backendRunning !== false) {
      log.info("midicam started — hand mode (python harmonizer)");
    } else if (audio.connected && audio.backendRunning === false) {
      log.info("WARN: 오디오 장치 미감지 — 헤드폰 연결 후 서버 재시작");
    } else {
      log.info("WARN: python 백엔드 미연결 — run.sh 로 서버를 실행하세요");
    }

    tracker = await createTracker({
      withFace: true, onProgress: (m) => { els.startBtn.textContent = m; },
    });

    els.startScreen.classList.add("hidden");
    state.running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    els.startBtn.disabled = false;
    els.startBtn.textContent = "다시 시도";
    alert("카메라/마이크 권한이 필요합니다.\n" + (err?.message || err));
  }
}

function syncSize() {
  const r = els.video.getBoundingClientRect();
  if (r.width && r.height) viz.resize(r.width, r.height);
  const rr = els.roll.getBoundingClientRect();
  if (rr.width && rr.height) roll.resize(rr.width, rr.height);
}

const userHand = (label) => (label === "Left" ? "right" : "left");

function triggerGesture(label) {
  if (state.mode !== "hand") return;
  if (label === "closed_fist") {
    if (audio.chordOn) { roll.allOff(); audio.setChordOn(false); }
    return;
  }
  const c = GESTURE_CHORDS[label];
  if (!c) return;
  const prev = audio.currentVoicing.slice();
  // 이전 노트 off 로그
  log.noteOff(prevRoot(prev));
  const info = audio.applyGesture(label);
  audio.setChordOn(true);
  roll.setChord(c.voicing);
  log.noteOn(info.midi);
  log.gesture(label);
}
function prevRoot(voicing) { return voicing?.[2] ?? 60; }

function processHands(hands) {
  if (state.mode !== "hand") { state.handItems = []; return; }
  const items = [];
  if (hands?.landmarks?.length) {
    for (let i = 0; i < hands.landmarks.length; i++) {
      const lm = hands.landmarks[i];
      const g = detectHandGesture(lm);
      items.push({ landmarks: lm, box: handBox(lm), label: g.label,
        handed: userHand(hands.handednesses?.[i]?.[0]?.categoryName || "") });
    }
  }
  state.handItems = items;

  if (!items.length) {
    if (audio.chordOn) { roll.allOff(); audio.setChordOn(false); }
    state.lastSeen = ""; state.seenCount = 0; state.confirmedGesture = "";
    els.gestureTag.textContent = "—";
    return;
  }

  const label = items[0].label;
  els.gestureTag.textContent = label;
  // 디바운스: 같은 라벨 3프레임 유지 시 확정
  if (label === state.lastSeen) state.seenCount++;
  else { state.lastSeen = label; state.seenCount = 1; }
  if (state.seenCount === 3 && label !== state.confirmedGesture) {
    state.confirmedGesture = label;
    triggerGesture(label);
  }
}

function processFace(face, now) {
  const fl = face?.faceLandmarks?.[0];
  state.lastFaceLm = fl || state.lastFaceLm;
  const blends = blendMap(face);
  const fs = faceState(blends);

  // 눈썹 올림 → 모드 토글 (rising-edge: 내렸다가 올릴 때만 1회)
  if (fs.brow < 0.28) state.browArmed = true;
  if (state.browArmed && fs.brow > 0.62 && now - state.lastEyebrow > 1200) {
    state.browArmed = false;
    state.lastEyebrow = now;
    toggleMode();
  }

  if (state.mode === "face") {
    if (fl) state.faceItem = { box: faceBox(fl), label: "face_mode" };
    // 윙크 → 로그 + 별
    if (fs.winkRight && now - state.lastWinkR > 500) {
      state.lastWinkR = now; state.winkUntil.right = now + 1300;
      log.faceGesture("right_wink"); state.flash = 1; state.flashColor = "255,210,60";
    }
    if (fs.winkLeft && now - state.lastWinkL > 500) {
      state.lastWinkL = now; state.winkUntil.left = now + 1300;
      log.faceGesture("left_wink"); state.flash = 1; state.flashColor = "255,210,60";
    }
    if (fl) state.faceItem.label = fs.winkRight ? "right_wink" : fs.winkLeft ? "left_wink" : "face_mode";
  } else {
    audio.setJaw(fs.jawOpen);
  }
}

function toggleMode() {
  if (state.mode === "hand") {
    state.mode = "face";
    roll.allOff(); audio.setChordOn(false);
    audio.setAudioMode("face");
    log.faceGesture("eyebrow_raise");
    log.info("Switched to face mode");
    els.modeTag.textContent = "FACE";
    state.flash = 1; state.flashColor = "255,45,149";
  } else {
    state.mode = "hand";
    state.faceItem = null;
    audio.setAudioMode("hand");
    log.info("Switched to hand mode");
    els.modeTag.textContent = "HAND";
    state.confirmedGesture = "";
    state.flash = 1; state.flashColor = "57,255,20";
  }
}

function loop() {
  if (!state.running) return;
  const now = performance.now();
  if (els.video.readyState >= 2) {
    const res = tracker.detect(els.video, now);
    if (res) { processHands(res.hands); processFace(res.face, now); }
  }
  state.level = audio.update();

  viz.clear();
  if (state.mode === "hand") {
    viz.drawHands(state.handItems, state.level);
  } else {
    viz.drawFace(state.faceItem);
    const stars = [];
    if (now < state.winkUntil.right) stars.push(cheekPoint(state.lastFaceLm, "right"));
    if (now < state.winkUntil.left) stars.push(cheekPoint(state.lastFaceLm, "left"));
    viz.drawStars(stars);
  }
  if (state.flash > 0.01) { viz.flash(state.flash, state.flashColor); state.flash *= 0.86; }

  roll.render();
  requestAnimationFrame(loop);
}

els.startBtn.addEventListener("click", start);
