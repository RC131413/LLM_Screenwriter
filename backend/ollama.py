"""Local Bielik client: GPU inference and interruptible, privately buffered streaming."""

from collections.abc import Callable
from http.client import HTTPConnection, HTTPException, HTTPSConnection
import json
from socket import SHUT_RDWR
from threading import Event, Thread
from urllib.parse import urlsplit


OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
OLLAMA_MODEL = 'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M'
OLLAMA_TIMEOUT = 120
OLLAMA_GPU_LAYERS = 99  # Bielik has 51 layers; request offloading all of them.
OLLAMA_BATCH_SIZE = 128  # Keep prompt-processing buffers small on the 8 GB development GPU.


class OllamaError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class OllamaCancelled(OllamaError):
    def __init__(self):
        super().__init__('Generowanie zostało anulowane.', status_code=409)


def generate(prompt: str, *, base_url: str = OLLAMA_BASE_URL, timeout: float = OLLAMA_TIMEOUT,
             temperature: float = 0.7, max_tokens: int = 128, output_schema: dict | None = None,
             is_cancelled: Callable[[], bool] | None = None,
             messages: list[dict[str, str]] | None = None, num_batch: int = OLLAMA_BATCH_SIZE,
             num_ctx: int | None = None) -> str:
    """Buffer tokens privately; closing the upstream socket cancels Ollama's request."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError('Prompt musi być niepustym tekstem.')
    if num_ctx is not None and (isinstance(num_ctx, bool) or not isinstance(num_ctx, int) or num_ctx < 1):
        raise ValueError('Rozmiar kontekstu musi być dodatnią liczbą tokenów.')
    address = urlsplit(base_url)
    if address.scheme not in {'http', 'https'} or not address.hostname:
        raise ValueError('Nieprawidłowy adres Ollamy.')
    connection_type = HTTPSConnection if address.scheme == 'https' else HTTPConnection
    connection = connection_type(address.hostname, address.port, timeout=timeout)
    payload = {
        'model': OLLAMA_MODEL, 'stream': True,
        'options': {'num_predict': max_tokens, 'temperature': temperature,
                    'num_gpu': OLLAMA_GPU_LAYERS, 'num_batch': num_batch},
    }
    if num_ctx is not None:
        payload['options']['num_ctx'] = num_ctx
    if messages is None:
        payload['prompt'] = prompt
    else:
        payload['messages'] = messages
    if output_schema is not None:
        payload['format'] = output_schema
    stopped, cancelled = Event(), Event()
    watch_errors = []
    active_socket = None

    def check_cancelled():
        if watch_errors:
            raise OllamaError('Nie można sprawdzić statusu generowania.', status_code=503) from watch_errors[0]
        if cancelled.is_set():
            raise OllamaCancelled()

    def watch_cancellation():
        while not stopped.is_set():
            try:
                if is_cancelled():
                    cancelled.set()
            except Exception as error:
                watch_errors.append(error)
                cancelled.set()
            if cancelled.is_set():
                upstream_socket = connection.sock or active_socket
                if upstream_socket is not None:
                    try:
                        upstream_socket.shutdown(SHUT_RDWR)
                    except OSError:
                        pass
                    return
            stopped.wait(0.2)

    watcher = Thread(target=watch_cancellation, daemon=True) if is_cancelled is not None else None
    if watcher is not None:
        watcher.start()
    try:
        check_cancelled()
        connection.request(
            'POST', address.path.rstrip('/') + ('/api/generate' if messages is None else '/api/chat'),
            body=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'Accept': 'application/x-ndjson'},
        )
        # HTTP/1.0/Connection: close detaches connection.sock after getresponse().
        active_socket = connection.sock
        with connection.getresponse() as response:
            check_cancelled()
            if response.status >= 400:
                if response.status == 404:
                    raise OllamaError(f'Model {OLLAMA_MODEL} jest niedostępny. Pobierz go: ollama pull {OLLAMA_MODEL}')
                raise OllamaError(f'Ollama zwróciła błąd HTTP {response.status}. Sprawdź logi Ollamy.')
            parts = []
            for line in response:
                check_cancelled()
                if not line.strip():
                    continue
                data = json.loads(line.decode('utf-8'))
                if not isinstance(data, dict) or data.get('error'):
                    raise OllamaError('Ollama zwróciła błąd podczas generowania.')
                message = data.get('message', {})
                fragment = data.get('response', '') if messages is None else (
                    message.get('content', '') if isinstance(message, dict) else None
                )
                if not isinstance(fragment, str):
                    raise OllamaError('Ollama zwróciła nieprawidłowy fragment odpowiedzi.')
                parts.append(fragment)
                if data.get('done') is True:
                    check_cancelled()
                    if output_schema is not None and data.get('done_reason') == 'length':
                        raise OllamaError('Model osiągnął limit tokenów przed ukończeniem sceny. Zwiększ limit w preferencjach AI.')
                    text = ''.join(parts)
                    if not text.strip():
                        raise OllamaError('Ollama nie zwróciła tekstu odpowiedzi modelu.')
                    return text
            check_cancelled()
            raise OllamaError('Ollama nie zwróciła zakończonej odpowiedzi modelu.')
    except TimeoutError as error:
        check_cancelled()
        raise OllamaError('Przekroczono czas oczekiwania na odpowiedź Ollamy.', status_code=504) from error
    except (HTTPException, OSError) as error:
        check_cancelled()
        raise OllamaError(f'Nie można połączyć się z Ollamą pod adresem {base_url}. Uruchom Ollamę.', status_code=503) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise OllamaError('Ollama zwróciła nieprawidłową odpowiedź JSON.') from error
    finally:
        stopped.set()
        if watcher is not None:
            watcher.join(timeout=1)
        connection.close()
