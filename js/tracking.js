// tracking.js — MediaPipe Tasks-Vision (HandLandmarker + FaceLandmarker)
import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export async function createTracker({ withFace = true, onProgress } = {}) {
  onProgress?.("비전 런타임 로딩…");
  const vision = await FilesetResolver.forVisionTasks(WASM);

  onProgress?.("손 인식 모델 로딩…");
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  let faceLandmarker = null;
  if (withFace) {
    onProgress?.("얼굴 인식 모델 로딩…");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
  }

  let lastVideoTime = -1;

  return {
    /**
     * @returns {{hands:object|null, face:object|null}}
     */
    detect(video, timestampMs) {
      // 같은 프레임 중복 추론 방지
      if (video.currentTime === lastVideoTime) return null;
      lastVideoTime = video.currentTime;
      const hands = handLandmarker.detectForVideo(video, timestampMs);
      const face = faceLandmarker
        ? faceLandmarker.detectForVideo(video, timestampMs)
        : null;
      return { hands, face };
    },
    hasFace: !!faceLandmarker,
  };
}
