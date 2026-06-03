"""
server.py — FastAPI WebSocket 서버 + 정적 프론트 서빙
- 프론트(브라우저): 카메라/트래킹/시각 UI, 제스처 판별
- 백엔드(Python): 마이크 + pedalboard 하모나이저 → 헤드폰 출력
- WebSocket: 프론트→백(화음/모드 명령), 백→프론트(오디오 레벨)
실행: uvicorn server:app --host 127.0.0.1 --port 8000
"""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from audio_engine import HarmonizerEngine

engine = HarmonizerEngine()


@asynccontextmanager
async def lifespan(_app):
    engine.start()
    if engine.error:
        print(f"[audio] ⚠️  오디오 장치 시작 실패: {engine.error}")
        print("[audio]    헤드폰/마이크 연결 후 서버를 재시작하세요.")
    else:
        print("[audio] ✅ 하모나이저 엔진 시작 (마이크→화음→헤드폰)")
    yield
    engine.stop()


app = FastAPI(lifespan=lifespan)


@app.get("/api/status")
def status():
    return {"running": engine.running, "error": engine.error, "mode": engine.mode}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()

    async def sender():
        try:
            while True:
                await ws.send_json({
                    "type": "level",
                    "in": round(engine.in_level, 4),
                    "out": round(engine.out_level, 4),
                    "running": engine.running,
                    "error": engine.error,
                })
                await asyncio.sleep(0.05)
        except Exception:
            pass

    snd = asyncio.create_task(sender())
    try:
        while True:
            msg = await ws.receive_json()
            t = msg.get("type")
            if t == "chord":
                engine.set_chord(msg.get("gesture", ""))
            elif t == "chordOff":
                engine.chord_off()
            elif t == "mode":
                engine.set_mode(msg.get("mode", "hand"))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        snd.cancel()


# 정적 프론트(app/)는 맨 마지막에 마운트 (catch-all)
# 이 파일은 app/backend/server.py → parent.parent = app/
APP_DIR = Path(__file__).resolve().parent.parent
app.mount("/", StaticFiles(directory=str(APP_DIR), html=True), name="static")
