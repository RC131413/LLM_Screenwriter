"""Local model configuration shared by the screenplay agents."""

from langchain_ollama import ChatOllama

from backend.ollama import OLLAMA_BASE_URL, OLLAMA_BATCH_SIZE, OLLAMA_GPU_LAYERS, OLLAMA_MODEL, OLLAMA_TIMEOUT


def create_local_chat_model(*, timeout: float = OLLAMA_TIMEOUT) -> ChatOllama:
    return ChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0,
        num_gpu=OLLAMA_GPU_LAYERS,
        num_batch=OLLAMA_BATCH_SIZE,
        client_kwargs={'timeout': timeout, 'trust_env': False},
    )
