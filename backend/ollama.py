"""Minimal synchronous client for the local Bielik model served by Ollama."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
OLLAMA_MODEL = 'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M'
OLLAMA_TIMEOUT = 120  # Initial loading of a local 11B model may take a while.


class OllamaError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def generate(prompt: str, *, base_url: str = OLLAMA_BASE_URL, timeout: float = OLLAMA_TIMEOUT) -> str:
    """Send a prompt to the fixed Bielik model and return its completed text."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Prompt musi być niepustym tekstem.')
    payload = {
        'model': OLLAMA_MODEL,
        'prompt': prompt,
        'stream': False,
        'options': {'num_predict': 128},
    }
    request = Request(
        base_url.rstrip('/') + '/api/generate',
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode('utf-8'))
    except HTTPError as error:
        if error.code == 404:
            message = (
                f'Model {OLLAMA_MODEL} jest niedostępny w Ollamie. '
                f'Pobierz go poleceniem: ollama pull {OLLAMA_MODEL}'
            )
        else:
            message = f'Ollama zwróciła błąd HTTP {error.code}. Sprawdź logi Ollamy.'
        error.close()
        raise OllamaError(message) from error
    except TimeoutError as error:
        raise OllamaError('Przekroczono czas oczekiwania na odpowiedź Ollamy.', status_code=504) from error
    except URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise OllamaError('Przekroczono czas oczekiwania na odpowiedź Ollamy.', status_code=504) from error
        raise OllamaError(
            f'Nie można połączyć się z Ollamą pod adresem {base_url}. Uruchom Ollamę.',
            status_code=503,
        ) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise OllamaError('Ollama zwróciła nieprawidłową odpowiedź JSON.') from error

    if not isinstance(data, dict) or data.get('done') is not True:
        raise OllamaError('Ollama nie zwróciła zakończonej odpowiedzi modelu.')
    text = data.get('response')
    if not isinstance(text, str) or not text.strip():
        raise OllamaError('Ollama nie zwróciła tekstu odpowiedzi modelu.')
    return text
