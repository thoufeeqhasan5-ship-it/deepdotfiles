# Narrator service: Edge neural voices, Gemini TTS, Kokoro or Chatterbox (+ word timings from faster-whisper).
# Speaks the same API as Kokoro (/dev/captioned_speech) and falls back to Kokoro on any problem.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "torch==2.6.0" "torchaudio==2.6.0" --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir numpy cython && pip install --no-cache-dir chatterbox-tts faster-whisper edge-tts
COPY server.py /app/server.py
ENV HF_HOME=/models PYTHONUNBUFFERED=1
EXPOSE 8880
CMD ["python3", "/app/server.py"]
