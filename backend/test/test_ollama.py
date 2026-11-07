import json
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from unittest.mock import patch

from django.test import SimpleTestCase

from backend.ollama import OLLAMA_GPU_LAYERS, OLLAMA_MODEL, OllamaCancelled, OllamaError, OllamaOutputLimit, generate


class Reply(BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body)
        self.status = status


def complete(text='OK', **extra):
    return Reply(json.dumps({'response': text, 'done': True, **extra}, ensure_ascii=False).encode('utf-8') + b'\n')


class OllamaClientTests(SimpleTestCase):
    @patch('backend.ollama.HTTPConnection')
    def test_sends_selected_context_size_separately_from_the_output_limit(self, transport):
        transport.return_value.getresponse.return_value = complete()
        generate('Anna szuka klucza.', max_tokens=512, num_ctx=2048)
        options = json.loads(transport.return_value.request.call_args.kwargs['body'])['options']
        self.assertEqual(options['num_ctx'], 2048)
        self.assertEqual(options['num_predict'], 512)

    @patch('backend.ollama.HTTPConnection')
    def test_invalid_context_size_is_rejected_before_http(self, transport):
        for num_ctx in (0, -1, True, 2048.5):
            with self.subTest(num_ctx=num_ctx), self.assertRaises(ValueError):
                generate('Anna szuka klucza.', num_ctx=num_ctx)
        transport.assert_not_called()

    @patch('backend.ollama.HTTPConnection')
    def test_streams_chat_responses_with_roles_and_a_small_batch(self, transport):
        messages = [{'role': 'system', 'content': 'Oceń scenę.'}, {'role': 'user', 'content': 'Scena.'}]
        chunks = [
            {'message': {'content': '{"score":'}, 'done': False},
            {'message': {'content': '8}'}, 'done': True},
        ]
        transport.return_value.getresponse.return_value = Reply(
            b''.join(json.dumps(chunk).encode() + b'\n' for chunk in chunks),
        )

        self.assertEqual(generate('Scena.', messages=messages, num_batch=64), '{"score":8}')
        request = transport.return_value.request.call_args
        self.assertEqual(request.args, ('POST', '/api/chat'))
        payload = json.loads(request.kwargs['body'])
        self.assertEqual(payload['messages'], messages)
        self.assertEqual(payload['options']['num_batch'], 64)

    @patch('backend.ollama.HTTPConnection')
    def test_posts_utf8_prompt_to_fixed_model_and_buffers_stream_on_gpu(self, transport):
        transport.return_value.getresponse.return_value = Reply(
            '{"response":"Połączenie ","done":false}\n{"response":"działa.","done":true}\n'.encode('utf-8'),
        )
        self.assertEqual(generate('Napisz krótką odpowiedź.'), 'Połączenie działa.')
        transport.assert_called_once_with('127.0.0.1', 11434, timeout=120)
        request = transport.return_value.request.call_args
        self.assertEqual(request.args, ('POST', '/api/generate'))
        payload = json.loads(request.kwargs['body'].decode('utf-8'))
        self.assertEqual(payload['model'], OLLAMA_MODEL)
        self.assertEqual(payload['prompt'], 'Napisz krótką odpowiedź.')
        self.assertIs(payload['stream'], True)
        self.assertEqual(payload['options'], {'num_predict': 128, 'temperature': 0.7, 'num_gpu': OLLAMA_GPU_LAYERS, 'num_batch': 128})
        self.assertEqual(request.kwargs['headers']['Content-Type'], 'application/json')
        transport.return_value.close.assert_called_once()

    @patch('backend.ollama.HTTPConnection')
    def test_accepts_custom_address_timeout_and_parameters(self, transport):
        transport.return_value.getresponse.return_value = complete()
        generate('Test', base_url='http://127.0.0.1:11435/', timeout=10, temperature=0.3, max_tokens=512)
        transport.assert_called_once_with('127.0.0.1', 11435, timeout=10)
        payload = json.loads(transport.return_value.request.call_args.kwargs['body'])
        self.assertEqual(payload['options'], {'num_predict': 512, 'temperature': 0.3, 'num_gpu': 99, 'num_batch': 128})
        self.assertEqual(payload['model'], OLLAMA_MODEL)

    @patch('backend.ollama.HTTPConnection')
    def test_sends_output_schema_to_ollama_for_enforced_json_generation(self, transport):
        schema = {'type': 'object', 'properties': {'blocks': {'type': 'array'}}}
        answer = '{"blocks":[{"type":"action","text":"Anna otwiera drzwi."}]}'
        transport.return_value.getresponse.return_value = complete(answer, done_reason='stop')
        self.assertEqual(generate('Test', output_schema=schema), answer)
        self.assertEqual(json.loads(transport.return_value.request.call_args.kwargs['body'])['format'], schema)

    @patch('backend.ollama.HTTPConnection')
    def test_token_limit_is_not_reported_as_complete_structured_scene(self, transport):
        partial = '{"blocks":[{"type":"action","text":"Anna'
        transport.return_value.getresponse.return_value = complete(partial, done_reason='length')
        with self.assertRaises(OllamaOutputLimit) as caught:
            generate('Test', output_schema={'type': 'object'})
        self.assertEqual(caught.exception.partial_text, partial)
        self.assertNotIn(partial, str(caught.exception))

    @patch('backend.ollama.HTTPConnection')
    def test_rejects_invalid_prompts_without_http_request(self, transport):
        for prompt in ('', '   ', None, 123):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                generate(prompt)
        transport.assert_not_called()

    @patch('backend.ollama.HTTPConnection')
    def test_connection_failure_and_timeout_are_translated(self, transport):
        for failure, status in ((ConnectionRefusedError('refused'), 503), (TimeoutError('timeout'), 504)):
            with self.subTest(status=status):
                transport.return_value.request.side_effect = failure
                with self.assertRaises(OllamaError) as caught:
                    generate('Test')
                self.assertEqual(caught.exception.status_code, status)

    @patch('backend.ollama.HTTPConnection')
    def test_http_errors_explain_missing_model_without_retry_or_substitution(self, transport):
        for status in (404, 500):
            with self.subTest(status=status):
                transport.return_value.getresponse.return_value = Reply(b'{}', status)
                with self.assertRaises(OllamaError) as caught:
                    generate('Test')
                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn(f'ollama pull {OLLAMA_MODEL}' if status == 404 else 'HTTP 500', str(caught.exception))
        self.assertEqual(transport.return_value.request.call_count, 2)

    @patch('backend.ollama.HTTPConnection')
    def test_invalid_incomplete_empty_and_error_streams_are_rejected(self, transport):
        for body in (b'not json\n', b'\xff\n', b'[]\n', b'{"response":"Partial","done":false}\n',
                     b'{"done":true}\n', b'{"done":true,"response":" "}\n',
                     b'{"done":true,"response":123}\n', b'{"error":"runner failed"}\n'):
            with self.subTest(body=body):
                transport.return_value.getresponse.return_value = Reply(body)
                with self.assertRaises(OllamaError) as caught:
                    generate('Test')
                self.assertEqual(caught.exception.status_code, 502)

    def test_cancellation_closes_real_socket_before_headers_and_after_partial_tokens(self):
        for send_partial in (False, True):
            with self.subTest(send_partial=send_partial):
                ready, cancel, disconnected = Event(), Event(), Event()
                outcomes = []

                class Handler(BaseHTTPRequestHandler):
                    def do_POST(self):
                        self.rfile.read(int(self.headers['Content-Length']))
                        if send_partial:
                            self.send_response(200)
                            self.end_headers()
                            self.wfile.write(b'{"response":"Partial","done":false}\n')
                            self.wfile.flush()
                        ready.set()
                        self.connection.settimeout(3)
                        if self.connection.recv(1) == b'':
                            disconnected.set()

                    def log_message(self, *args):
                        pass

                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                serving = Thread(target=server.serve_forever, daemon=True)
                serving.start()

                def call_model():
                    try:
                        outcomes.append(generate('Test', base_url=f'http://127.0.0.1:{server.server_port}',
                                                 is_cancelled=cancel.is_set, timeout=3))
                    except Exception as error:
                        outcomes.append(error)

                worker = Thread(target=call_model, daemon=True)
                worker.start()
                try:
                    self.assertTrue(ready.wait(2))
                    cancel.set()
                    worker.join(timeout=2)
                    self.assertFalse(worker.is_alive())
                    self.assertEqual(len(outcomes), 1)
                    self.assertIsInstance(outcomes[0], OllamaCancelled)
                    self.assertTrue(disconnected.wait(2))
                finally:
                    cancel.set()
                    server.shutdown()
                    server.server_close()


class RemovedLlmPingTests(SimpleTestCase):
    @patch('backend.ollama.generate')
    def test_temporary_probe_is_removed(self, generate_text):
        self.assertEqual(self.client.get('/api/llm/ping').status_code, 404)
        generate_text.assert_not_called()
