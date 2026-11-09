"""Serve the built React entry point; WhiteNoise serves its static assets."""

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import render
from django.template import TemplateDoesNotExist
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' https: http:; font-src 'self'; connect-src 'self'; "
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


def static_headers(headers, path, url):
    """Keep a direct request for the collected index as protected as the home page."""
    headers['X-Content-Type-Options'] = 'nosniff'
    headers['X-Frame-Options'] = 'DENY'
    headers['Referrer-Policy'] = 'same-origin'
    if path.endswith('.html'):
        headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY
        headers['Cache-Control'] = 'no-store'


@require_safe
@never_cache
def index(request):
    try:
        response = render(request, 'index.html')
    except TemplateDoesNotExist:
        message = 'Interfejs jest chwilowo niedostępny.'
        if settings.DEBUG:
            message += ' Uruchom npm run build w folderze frontend.'
        response = HttpResponse(message, status=503, content_type='text/plain; charset=utf-8')
    response['Content-Security-Policy'] = CONTENT_SECURITY_POLICY
    return response
