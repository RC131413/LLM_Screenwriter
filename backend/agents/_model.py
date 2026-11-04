"""Local model configuration shared by the screenplay agents."""

from collections.abc import Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_ollama import ChatOllama
from pydantic import Field

from backend import ollama
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


class CancellableChatOllama(ChatOllama):
    """Use LangChain's structured output with the existing interruptible transport."""

    is_cancelled: Callable[[], bool] = Field(exclude=True, repr=False)
    request_timeout: float = OLLAMA_TIMEOUT

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        roles = {SystemMessage: 'system', HumanMessage: 'user'}
        payload = [{'role': roles[type(message)], 'content': message.text} for message in messages]
        answer = ollama.generate(
            payload[-1]['content'], messages=payload, base_url=self.base_url,
            timeout=self.request_timeout, temperature=self.temperature, max_tokens=self.num_predict,
            output_schema=kwargs['format'], is_cancelled=self.is_cancelled, num_batch=64,
        )
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=answer))])
