#!/usr/bin/env bash
# Voice Coder — Python 하모나이저 백엔드 실행
set -e
cd "$(dirname "$0")"

echo "📦 의존성 확인/설치..."
python3 -m pip install -q -r requirements.txt

echo ""
echo "🎤 Voice Coder 백엔드 시작"
echo "🎧 헤드폰을 착용하세요 (스피커 사용 시 하울링 발생)"
echo "🌐 브라우저에서 http://localhost:8000 접속"
echo ""
exec python3 -m uvicorn server:app --host 127.0.0.1 --port 8000
