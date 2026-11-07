"""Local model configuration shared by the screenplay agents."""

from collections.abc import Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_ollama import ChatOllama
from pydantic import Field

from backend import ollama
from backend.llm_config import OLLAMA_CONFIG
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT

from .context_budget import PreparedContext, prepare_context


def create_local_chat_model(*, timeout: float = OLLAMA_TIMEOUT, max_tokens: int = 1024) -> ChatOllama:
    return CancellableChatOllama(
        model=OLLAMA_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0,
        num_predict=max_tokens,
        request_timeout=timeout,
    )


class CancellableChatOllama(ChatOllama):
    """Use LangChain's structured output with the existing interruptible transport."""

    is_cancelled: Callable[[], bool] | None = Field(default=None, exclude=True, repr=False)
    context_observer: Callable[[dict], None] | None = Field(default=None, exclude=True, repr=False)
    context_selector: Callable[[PreparedContext], PreparedContext] | None = Field(default=None, exclude=True, repr=False)
    request_timeout: float = OLLAMA_TIMEOUT

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        roles = {SystemMessage: 'system', HumanMessage: 'user'}
        payload = [{'role': roles[type(message)], 'content': message.text} for message in messages]
        prepared = prepare_context(payload, max_tokens=self.num_predict if self.num_predict is not None else 1024)
        if self.context_selector is not None:
            prepared = self.context_selector(prepared)
        metadata = prepared.metadata()
        if self.context_observer is not None:
            self.context_observer(metadata)
        payload = prepared.messages
        answer = ollama.generate(
            payload[-1]['content'], messages=payload, base_url=self.base_url or OLLAMA_BASE_URL,
            timeout=self.request_timeout, temperature=self.temperature, max_tokens=prepared.max_tokens,
            output_schema=kwargs.get('format', self.format) or None, is_cancelled=self.is_cancelled,
            num_batch=OLLAMA_CONFIG.agent_batch_size, num_ctx=prepared.num_ctx,
        )
        return ChatResult(generations=[ChatGeneration(message=AIMessage(
            content=answer, response_metadata={'context_budget': metadata},
        ))])
