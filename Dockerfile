FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY server ./server
COPY docs ./docs
RUN mkdir -p /data && useradd --uid 10001 --no-create-home agenda && chown agenda:agenda /data
USER agenda
ENV DATA_DIRECTORY=/data
EXPOSE 8080
CMD ["gunicorn", "--preload", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "180", "server.wsgi:app"]
