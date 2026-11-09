"""One modest worker with spare threads for progress, cancellation and other requests."""

import os

bind = '0.0.0.0:8000'
worker_class = 'gthread'
workers = int(os.environ.get('GUNICORN_WORKERS', '1'))
threads = int(os.environ.get('GUNICORN_THREADS', '4'))
timeout = int(os.environ.get('GUNICORN_TIMEOUT', '930'))
accesslog = '-'
errorlog = '-'
# TrustedProxyMiddleware handles explicitly configured proxies. Do not infer HTTPS
# from arbitrary forwarded headers on the directly exposed local container.
forwarded_allow_ips = ''
