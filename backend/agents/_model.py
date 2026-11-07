"""Shared local model and interruptible transport for the screenplay agents."""

from collections.abc import Callable
import json

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_ollama import ChatOllama
from pydantic import Field

from backend import ollama
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT


MAX_STRUCTURED_ATTEMPTS = 2


def create_local_chat_model(*, timeout: float = OLLAMA_TIMEOUT, max_tokens: int = 1024) -> ChatOllama:
    return CancellableChatOllama(
        model=OLLAMA_MODEL, base_url=OLLAMA_BASE_URL, temperature=0,
        num_predict=max_tokens, request_timeout=timeout,
    )


def _scene_for_model(scene):
    editor = scene.pop('editor_metadata', {})
    blocks = editor.get('blocks', []) if isinstance(editor, dict) else []
    if not blocks or not all(isinstance(block, dict) and isinstance(block.get('text'), str) for block in blocks):
        return
    text = '\n\n'.join(block['text'] for block in blocks)
    original = scene.get('content_text', '')
    if not isinstance(original, str) or not original.strip():
        scene['content_text'] = text
    elif text.strip() and original != text:
        scene['editor_blocks'] = [{key: value for key, value in block.items() if key != 'id'} for block in blocks]


def model_prompt(content: str) -> str:
    """Omit UI/undo storage from a separate JSON copy, without cutting story text."""
    try:
        payload = json.loads(content)
    except (ValueError, TypeError):
        return content
    if not isinstance(payload, dict) or not isinstance(payload.get('context'), dict):
        return content
    context = payload['context']
    context.pop('llm_preferences', None)  # Already applied as model options.
    if isinstance(context.get('scene'), dict):
        _scene_for_model(context['scene'])
    for scene in context.get('previous_scenes', []):
        if isinstance(scene, dict):
            _scene_for_model(scene)
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


class CancellableChatOllama(ChatOllama):
    is_cancelled: Callable[[], bool] | None = Field(default=None, exclude=True, repr=False)
    context_observer: Callable[[dict], None] | None = Field(default=None, exclude=True, repr=False)
    request_timeout: float = OLLAMA_TIMEOUT

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        roles = {SystemMessage: 'system', HumanMessage: 'user'}
        payload = [{'role': roles[type(message)], 'content': model_prompt(message.text)
                    if isinstance(message, HumanMessage) else message.text} for message in messages]
        schema = kwargs.get('format', self.format) or None
        requested = self.num_predict if self.num_predict is not None else 1024
        attempts = MAX_STRUCTURED_ATTEMPTS if isinstance(schema, dict) else 1
        for attempt in range(attempts):
            if self.is_cancelled is not None and self.is_cancelled():
                raise ollama.OllamaCancelled()
            request = [dict(message) for message in payload]
            if attempt:
                instruction = 'Zwróć kompletny, zwarty JSON według schematu. Bez powtórzeń i wcięć; zakończ wszystkie zdania.'
                system = next((message for message in request if message['role'] == 'system'), None)
                if system is None:
                    request.insert(0, {'role': 'system', 'content': instruction})
                else:
                    system['content'] += '\n' + instruction
            metadata = {'num_ctx': ollama.OLLAMA_CONTEXT_SIZE, 'max_tokens': requested * (attempt + 1),
                        'requested_max_tokens': requested, 'attempt': attempt + 1}
            if self.context_observer is not None:
                self.context_observer(metadata)
            try:
                answer = ollama.generate(
                    request[-1]['content'], messages=request, base_url=self.base_url or OLLAMA_BASE_URL,
                    timeout=self.request_timeout, temperature=self.temperature, max_tokens=metadata['max_tokens'],
                    output_schema=schema, is_cancelled=self.is_cancelled,
                    num_batch=ollama.OLLAMA_AGENT_BATCH_SIZE, num_ctx=ollama.OLLAMA_CONTEXT_SIZE,
                )
                break
            except ollama.OllamaOutputLimit as error:
                try:
                    complete = json.loads(error.partial_text)
                except ValueError:
                    complete = None
                if isinstance(schema, dict) and isinstance(complete, dict) and all(
                    key in complete for key in schema.get('required', [])
                ):
                    answer = error.partial_text  # Normal Pydantic validation still follows.
                    break
                if attempt == attempts - 1:
                    raise ollama.OllamaError('Nie udało się dokończyć odpowiedzi modelu. Spróbuj ponownie.') from error
        return ChatResult(generations=[ChatGeneration(message=AIMessage(
            content=answer, response_metadata={'model_call': metadata},
        ))])
