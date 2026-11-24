FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
COPY campusai_ai ./campusai_ai
RUN pip install --no-cache-dir . 
ENV FASTEMBED_CACHE=/app/.cache/fastembed EMBEDDING_CACHE=/app/.cache/fastembed
# bake the embedding model into the image (no runtime download)
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/app/.cache/fastembed')"
EXPOSE 8000
CMD ["uvicorn", "campusai_ai.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
