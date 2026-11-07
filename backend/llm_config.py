"""Read the local LLM hardware configuration once at process startup."""

from collections.abc import Mapping
from dataclasses import dataclass
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


class OllamaConfigError(ValueError):
    """An invalid environment setting should stop startup with its variable name."""


@dataclass(frozen=True)
class OllamaConfig:
    base_url: str
    gpu_layers: int | None
    batch_size: int
    agent_batch_size: int
    timeout: int
    scene_timeout: int
    context_windows: tuple[int, ...]
    context_margin: int


def _integer(environment: Mapping[str, str], name: str, default: int, *, minimum: int = 1) -> int:
    try:
        value = int(environment.get(name, str(default)))
    except (TypeError, ValueError) as error:
        raise OllamaConfigError(f'{name}: wymagana jest liczba całkowita, minimum {minimum}.') from error
    if value < minimum:
        raise OllamaConfigError(f'{name}: wymagana jest liczba całkowita, minimum {minimum}.')
    return value


def read_ollama_config(environment: Mapping[str, str] | None = None) -> OllamaConfig:
    environment = os.environ if environment is None else environment
    base_url = environment.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').strip().rstrip('/')
    try:
        address = urlsplit(base_url)
        valid_url = address.scheme in {'http', 'https'} and address.hostname and not address.query and not address.fragment
        address.port  # Validate a port if present.
    except ValueError:
        valid_url = False
    if not valid_url:
        raise OllamaConfigError('OLLAMA_BASE_URL: podaj adres HTTP(S) serwera Ollama bez query i fragmentu.')

    gpu_value = environment.get('OLLAMA_GPU_LAYERS', '99').strip().lower()
    gpu_layers = None if gpu_value == 'auto' else _integer(environment, 'OLLAMA_GPU_LAYERS', 99, minimum=0)

    try:
        context_windows = tuple(sorted({
            int(value.strip()) for value in environment.get('OLLAMA_CONTEXT_WINDOWS', '2048,4096').split(',')
        }))
    except ValueError as error:
        raise OllamaConfigError('OLLAMA_CONTEXT_WINDOWS: podaj liczby całkowite oddzielone przecinkami.') from error
    # The fixed Bielik model reports a native 32768-token context. This is a model
    # limit, not a promise that any of these sizes will fit in a particular GPU.
    if not context_windows or context_windows[0] < 1 or context_windows[-1] > 32768:
        raise OllamaConfigError('OLLAMA_CONTEXT_WINDOWS: dozwolone są rozmiary od 1 do 32768 tokenów dla Bielika.')
    context_margin = _integer(environment, 'OLLAMA_CONTEXT_MARGIN', 128, minimum=0)
    if context_margin >= context_windows[-1]:
        raise OllamaConfigError('OLLAMA_CONTEXT_MARGIN musi być mniejszy niż największe okno OLLAMA_CONTEXT_WINDOWS.')

    return OllamaConfig(
        base_url=base_url, gpu_layers=gpu_layers,
        batch_size=_integer(environment, 'OLLAMA_BATCH_SIZE', 128),
        agent_batch_size=_integer(environment, 'OLLAMA_AGENT_BATCH_SIZE', 64),
        timeout=_integer(environment, 'OLLAMA_TIMEOUT', 120),
        scene_timeout=_integer(environment, 'OLLAMA_SCENE_TIMEOUT', 300),
        context_windows=context_windows, context_margin=context_margin,
    )


# Also support direct imports of agents outside manage.py. Environment variables
# supplied by the shell/container take precedence over the project's .env file.
load_dotenv(Path(__file__).resolve().parent.parent / '.env', override=False)
OLLAMA_CONFIG = read_ollama_config()
