import json
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from django.test import SimpleTestCase, override_settings

from backend.ollama import OLLAMA_MODEL, OllamaError, generate


class OllamaClientTests(SimpleTestCase):
    @patch('backend.ollama.urlopen')
    def test_posts_utf8_prompt_to_fixed_model_and_returns_completed_text(self, opener):
        opener.return_value.__enter__.return_value.read.return_value = json.dumps({
            'response': 'Połączenie działa.', 'done': True,
        }, ensure_ascii=False).encode('utf-8')
        self.assertEqual(generate('Napisz krótką odpowiedź.'), 'Połączenie działa.')
        request = opener.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:11434/api/generate')
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.get_header('Content-type'), 'application/json')
        payload = json.loads(request.data.decode('utf-8'))
        self.assertEqual(payload['model'], OLLAMA_MODEL)
        self.assertEqual(payload['prompt'], 'Napisz krótką odpowiedź.')
        self.assertIs(payload['stream'], False)
        self.assertEqual(payload['options']['num_predict'], 128)
        self.assertEqual(opener.call_args.kwargs['timeout'], 120)

    @patch('backend.ollama.urlopen')
    def test_accepts_custom_server_address_and_timeout_but_keeps_model_fixed(self, opener):
        opener.return_value.__enter__.return_value.read.return_value = b'{"response":"OK","done":true}'
        generate('Test', base_url='http://127.0.0.1:11435/', timeout=10)
        self.assertEqual(opener.call_args.args[0].full_url, 'http://127.0.0.1:11435/api/generate')
        self.assertEqual(opener.call_args.kwargs['timeout'], 10)
        self.assertEqual(json.loads(opener.call_args.args[0].data)['model'], OLLAMA_MODEL)

    @patch('backend.ollama.urlopen')
    def test_rejects_empty_or_non_text_prompts_without_http_request(self, opener):
        for prompt in ('', '   ', None, 123):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                generate(prompt)
        opener.assert_not_called()

    @patch('backend.ollama.urlopen', side_effect=URLError(ConnectionRefusedError('refused')))
    def test_unreachable_ollama_is_service_unavailable(self, opener):
        with self.assertRaises(OllamaError) as caught:
            generate('Test')
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn('Uruchom Ollamę', str(caught.exception))

    @patch('backend.ollama.urlopen')
    def test_direct_and_wrapped_timeouts_are_gateway_timeouts(self, opener):
        for failure in (TimeoutError('timed out'), URLError(TimeoutError('timed out'))):
            with self.subTest(error=type(failure).__name__):
                opener.side_effect = failure
                with self.assertRaises(OllamaError) as caught:
                    generate('Test')
                self.assertEqual(caught.exception.status_code, 504)

    @patch('backend.ollama.urlopen')
    def test_missing_model_explains_installation_without_retry_or_substitution(self, opener):
        opener.side_effect = HTTPError('http://127.0.0.1:11434/api/generate', 404, 'Not found', {}, BytesIO(b'{}'))
        with self.assertRaises(OllamaError) as caught:
            generate('Test')
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn(f'ollama pull {OLLAMA_MODEL}', str(caught.exception))
        opener.assert_called_once()

    @patch('backend.ollama.urlopen')
    def test_upstream_http_error_is_translated(self, opener):
        opener.side_effect = HTTPError('http://127.0.0.1:11434/api/generate', 500, 'Error', {}, BytesIO(b'{}'))
        with self.assertRaises(OllamaError) as caught:
            generate('Test')
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn('HTTP 500', str(caught.exception))

    @patch('backend.ollama.urlopen')
    def test_invalid_incomplete_or_empty_responses_are_not_reported_as_success(self, opener):
        for body in (b'not json', b'\xff', b'[]', b'{"done":false,"response":"Partial"}',
                     b'{"done":true}', b'{"done":true,"response":" "}', b'{"done":true,"response":123}'):
            with self.subTest(body=body):
                opener.return_value.__enter__.return_value.read.return_value = body
                with self.assertRaises(OllamaError) as caught:
                    generate('Test')
                self.assertEqual(caught.exception.status_code, 502)


@override_settings(DEBUG=True)
class LlmPingTests(SimpleTestCase):
    @patch('backend.ollama.generate', return_value='Tak, połączenie działa.')
    def test_development_probe_returns_real_client_result_without_login(self, generate_text):
        response = self.client.get('/api/llm/ping')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'model': OLLAMA_MODEL, 'response': 'Tak, połączenie działa.'})
        self.assertEqual(response['Cache-Control'], 'no-store')
        generate_text.assert_called_once()
        self.assertIn('Bielik', generate_text.call_args.args[0])

    @patch('backend.ollama.generate')
    def test_probe_exposes_clear_upstream_failure_statuses(self, generate_text):
        for status in (502, 503, 504):
            with self.subTest(status=status):
                generate_text.side_effect = OllamaError('Test upstream failure', status_code=status)
                response = self.client.get('/api/llm/ping')
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json(), {'detail': 'Test upstream failure'})
                self.assertEqual(response['Cache-Control'], 'no-store')

    @override_settings(DEBUG=False)
    @patch('backend.ollama.generate')
    def test_probe_is_disabled_outside_development(self, generate_text):
        response = self.client.get('/api/llm/ping')
        self.assertEqual(response.status_code, 404)
        generate_text.assert_not_called()
