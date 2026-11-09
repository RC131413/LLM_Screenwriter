"""Bound API input and apply shared limits before parsing or executing endpoints."""

import json
import logging

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.http import JsonResponse
from ninja.utils import check_csrf

from .input_validation import validate_data_tree
from .exceptions import RateLimitExceeded, SecurityStoreUnavailable
from .rate_limits import client_ip, request_limit


logger = logging.getLogger(__name__)


class TrustedProxyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.get_host()  # Enforce ALLOWED_HOSTS even for plain JSON GET responses.
        if request.META.get('REMOTE_ADDR') not in settings.TRUSTED_PROXY_IPS:
            request.META.pop('HTTP_X_FORWARDED_PROTO', None)
            request.META.pop('HTTP_X_FORWARDED_FOR', None)
        return self.get_response(request)


def error_response(detail, status):
    response = JsonResponse({'detail': detail}, status=status)
    response['Cache-Control'] = 'no-store'
    return response


class ApiSecurityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == '/admin/login/' and request.method == 'POST':
            try:
                request_limit(request, 'admin-login', limit=10, seconds=60, identity=client_ip(request))
            except RateLimitExceeded as error:
                response = error_response(str(error), 429)
                response['Retry-After'] = str(error.wait)
                return response
            except SecurityStoreUnavailable:
                return error_response('Usługa jest chwilowo niedostępna.', 503)
        if request.path == '/api' or request.path.startswith('/api/'):
            if len(request.META.get('QUERY_STRING', '')) > 8192:
                return error_response('Adres zapytania jest zbyt długi.', 414)
            try:
                length = int(request.META.get('CONTENT_LENGTH') or 0)
                if length < 0 or length > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
                    return error_response('Żądanie przekracza dopuszczalny rozmiar.', 413)
            except ValueError:
                return error_response('Nieprawidłowa długość żądania.', 400)
            try:
                authenticated = request.user.is_authenticated
                request_limit(request, 'api', limit=1200 if authenticated else 120, seconds=60)
                if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
                    request_limit(request, 'writes', limit=300, seconds=60)
                    body = request.body  # Cache before CSRF can consume a form stream.
                    if check_csrf(request):
                        return error_response('Nie udało się zweryfikować tokenu CSRF.', 403)
                    if body:
                        if request.content_type != 'application/json':
                            return error_response('API przyjmuje dane w formacie application/json.', 415)
                        try:
                            parsed = json.loads(body)
                        except (ValueError, UnicodeDecodeError, RecursionError):
                            return error_response('Nieprawidłowe dane JSON.', 400)
                        if not isinstance(parsed, dict):
                            return error_response('Dane żądania muszą być obiektem JSON.', 422)
                        try:
                            validate_data_tree(parsed)
                        except ValueError as error:
                            return error_response(str(error), 422)
                    # Run these outside endpoint transactions: rejected passwords or
                    # registrations must not roll back their own throttle counters.
                    if request.path == '/api/auth/login':
                        request_limit(request, 'login-ip', limit=10, seconds=60, identity=client_ip(request))
                    elif request.path == '/api/auth/register':
                        request_limit(request, 'register', limit=5, seconds=3600, identity=client_ip(request))
                    elif request.path == '/api/users/me/password':
                        request_limit(request, 'password', limit=5, seconds=900)
            except RequestDataTooBig:
                return error_response('Żądanie przekracza dopuszczalny rozmiar.', 413)
            except RateLimitExceeded as error:
                response = error_response(str(error), 429)
                response['Retry-After'] = str(error.wait)
                return response
            except SecurityStoreUnavailable:
                logger.warning('API security store is unavailable.')
                return error_response('Usługa jest chwilowo niedostępna.', 503)
            response = self.get_response(request)
            response['Cache-Control'] = 'no-store'
            response['X-Content-Type-Options'] = 'nosniff'
            response['Referrer-Policy'] = 'same-origin'
            if not (settings.DEBUG and request.path.rstrip('/') == '/api/docs'):
                response['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            return response
        return self.get_response(request)
