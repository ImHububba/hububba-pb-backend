FROM python:3.11-slim

# System deps for eventlet / sockets (tiny but safe set)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Railway provides $PORT; your server.py already accepts env/auto-finds open port
CMD ["python", "server.py"]
