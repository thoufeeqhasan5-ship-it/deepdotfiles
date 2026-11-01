# Local, free, unlimited backup voice (Piper TTS)
FROM python:3.11-slim
RUN pip install --no-cache-dir "piper-tts==1.3.0"
RUN mkdir -p /voices && python3 -c "import urllib.request as u; b='https://huggingface.co/rhasspy/piper-voices/resolve/main/en/'; [u.urlretrieve(b+p+s, '/voices/'+p.split('/')[-1]+s) for p in ['en_US/ryan/high/en_US-ryan-high','en_GB/alan/medium/en_GB-alan-medium'] for s in ['.onnx','.onnx.json']]"
COPY server.py /app/server.py
EXPOSE 5000
CMD ["python3", "/app/server.py"]
