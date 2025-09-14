FROM python:3.11-slim

# minimal build tools for eventlet wheels if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

# use python3 explicitly
CMD ["python3", "server.py"]
