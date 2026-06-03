// main.js — 부트스트랩 / 메인 루프 / 제스처·얼굴 → 오디오 매핑
import { createTracker } from "./tracking.js";
import { detectHandGesture, handBox, blendMap, faceState } from "./gesture.js";
import { AudioEngine } from "./audio.js";
import { Visualizer } from "./visual.js";
import { LyricsPlayer } from "./lyrics.js";

const $ = (id) => document.getElementById(id);
const els = {
  video: $("video"),
  overlay: $("overlay"),
  lyrics: $("lyrics"),
  topcopy: $("topcopy"),
  startScreen: $("start-screen"),
  startBtn: $("start-btn"),
  status: $("status"),
  modePill: $("mode-pill"),
  chordPill: $("chord-pill"),
  octPill: $("oct-pill"),
  hint: $("hint"),
};

const state = {
  running: false,
  handItems: [],
  chordOn: false,
  level: 0,
  prevPrimary: "none",
  lastWink: 0,
  lastBlink: 0,
  flash: 0,
};

let tracker, audio, viz, lyrics;

function setStatus(msg, color) {
  els.status.textContent = msg;
  if (color) els.status.style.color = color;
}

async function start() {
  els.startBtn.disabled = true;
  els.startBtn.textContent = "초기화 중…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    els.video.srcObject = stream;
    await els.video.play();

    viz = new Visualizer(els.overlay);
    syncSize();
    window.addEventListener("resize", syncSize);

    audio = new AudioEngine();
    await audio.init(stream);

    lyrics = new LyricsPlayer(els.lyrics);
    lyrics.start();

    tracker = await createTracker({
      withFace: true,
      onProgress: (m) => { els.startBtn.textContent = m; },
    });

    els.startScreen.classList.add("hidden");
    setStatus("온라인", "#39ff14");
    state.running = true;
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    els.startBtn.disabled = false;
    els.startBtn.textContent = "다시 시도";
    setStatus("오류: " + (err?.message || err), "#ff4444");
    alert("카메라/마이크 권한이 필요합니다.\n" + (err?.message || err));
  }
}

function syncSize() {
  const r = els.video.getBoundingClientRect();
  if (r.width && r.height) viz.resize(r.width, r.height);
}

// MediaPipe handedness('Left'/'Right')는 비반전 기준 → 화면(거울)은 사용자 시점으로 표기
const userHand = (label) => (label === "Left" ? "right" : "left");

function processHands(handsResult) {
  const items = [];
  if (handsResult?.landmarks?.length) {
    for (let i = 0; i < handsResult.landmarks.length; i++) {
      const lm = handsResult.landmarks[i];
      const g = detectHandGesture(lm);
      const box = handBox(lm);
      const handed = handsResult.handednesses?.[i]?.[0]?.categoryName || "";
      items.push({ box, label: g.label, handed: userHand(handed), raw: g });
    }
  }
  state.handItems = items;
  if (!items.length) {
    // 손 사라지면 화음 끊기
    setChordOn(false);
    audio.setSpace(0);
    state.prevPrimary = "none";
    return;
  }

  // primary = 첫 손(코드 제어), secondary = 두번째(공간감)
  const primary = items[0];
  const lbl = primary.label;

  if (lbl === "open_palm") setChordOn(true);
  else if (lbl === "closed_fist") setChordOn(false);

  if (lbl === "victory" && state.prevPrimary !== "victory") {
    const name = audio.nextChord();
    pulseHint(`코드 → ${name}`);
  }
  if (lbl === "ok" && state.prevPrimary !== "ok") {
    const m = audio.mode === "fake" ? "real" : "fake";
    audio.setMode(m);
    updateModePill();
    pulseHint(`보코더: ${m === "real" ? "진짜(채널)" : "가짜(envelope)"}`);
  }
  state.prevPrimary = lbl;

  if (items.length > 1) {
    audio.setSpace(items[1].box.heightN);
  } else {
    audio.setSpace(0);
  }
}

function processFace(faceResult, now) {
  if (!faceResult) return;
  const blends = blendMap(faceResult);
  const fs = faceState(blends);

  audio.setJaw(fs.jawOpen);

  // 양눈 깜빡(엣지, cooldown) → 필터 스윕 + 플래시
  if (fs.bothBlink && now - state.lastBlink > 600) {
    state.lastBlink = now;
    sweepFilter();
    state.flash = 1;
  }
  // 윙크(한쪽, cooldown) → 옥타브 토글 + 플래시
  if (now - state.lastWink > 450) {
    if (fs.winkRight) {
      state.lastWink = now;
      audio.setOctaveShift(audio.octaveShift === 1 ? 0 : 1);
      updateOctPill(); state.flash = 1; pulseHint("윙크 → 옥타브 ↑");
    } else if (fs.winkLeft) {
      state.lastWink = now;
      audio.setOctaveShift(audio.octaveShift === -1 ? 0 : -1);
      updateOctPill(); state.flash = 1; pulseHint("윙크 → 옥타브 ↓");
    }
  }
}

function sweepFilter() {
  if (!audio?.ctx) return;
  const f = audio.masterFilter.frequency;
  const t = audio.ctx.currentTime;
  f.cancelScheduledValues(t);
  f.setValueAtTime(700, t);
  f.linearRampToValueAtTime(8000, t + 0.35);
  f.linearRampToValueAtTime(6000, t + 0.9);
}

function setChordOn(on) {
  state.chordOn = on;
  audio.setChordOn(on);
}

function updateModePill() {
  els.modePill.textContent = audio.mode === "real" ? "보코더: 진짜" : "보코더: 가짜";
  els.modePill.classList.toggle("real", audio.mode === "real");
}
function updateOctPill() {
  const o = audio.octaveShift;
  els.octPill.textContent = `옥타브 ${o > 0 ? "+1" : o < 0 ? "-1" : "0"}`;
}
let hintTimer = null;
function pulseHint(msg) {
  els.hint.textContent = msg;
  els.hint.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => els.hint.classList.remove("show"), 1200);
}

function loop() {
  if (!state.running) return;
  const now = performance.now();

  if (els.video.readyState >= 2) {
    const res = tracker.detect(els.video, now);
    if (res) {
      processHands(res.hands);
      processFace(res.face, now);
    }
  }

  state.level = audio.update();

  viz.clear();
  viz.drawHands(state.handItems, state.level, state.chordOn);
  if (state.flash > 0.01) {
    viz.flash(state.flash);
    state.flash *= 0.85;
  }

  lyrics.update();
  els.chordPill.textContent = audio.chordName + (state.chordOn ? " ●" : " ○");

  requestAnimationFrame(loop);
}

els.startBtn.addEventListener("click", start);
