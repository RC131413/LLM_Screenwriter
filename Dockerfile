FROM node:24-bookworm-slim AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY manage.py .
COPY backend/ backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist/

# collectstatic does not connect to the database; these are build-only placeholders.
RUN DJANGO_SECRET_KEY=collectstatic-build-placeholder DJANGO_DEBUG=True \
    POSTGRES_DB=build POSTGRES_USER=build POSTGRES_PASSWORD=build \
    python manage.py collectstatic --noinput

USER 10001:10001

EXPOSE 8000

CMD ["gunicorn", "backend.wsgi:application", "--config", "backend/gunicorn.conf.py"]
