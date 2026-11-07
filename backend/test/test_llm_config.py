import json
import os
from pathlib import Path
import subprocess
import sys

from django.test import SimpleTestCase

from backend.llm_config import OllamaConfigError, read_ollama_config


class OllamaConfigTests(SimpleTestCase):
    def test_defaults_preserve_the_existing_configuration(self):
        config = read_ollama_config({})
        self.assertEqual(config.base_url, 'http://127.0.0.1:11434')
        self.assertEqual(config.gpu_layers, 99)
        self.assertEqual((config.batch_size, config.agent_batch_size), (128, 64))
        self.assertEqual((config.timeout, config.scene_timeout), (120, 300))
        self.assertEqual(config.context_windows, (2048, 4096))
        self.assertEqual(config.context_margin, 128)

    def test_custom_hardware_configuration_and_normalized_windows(self):
        config = read_ollama_config({
            'OLLAMA_BASE_URL': 'http://localhost:11435/', 'OLLAMA_GPU_LAYERS': ' 12 ',
            'OLLAMA_BATCH_SIZE': '96', 'OLLAMA_AGENT_BATCH_SIZE': '32',
            'OLLAMA_TIMEOUT': '180', 'OLLAMA_SCENE_TIMEOUT': '600',
            'OLLAMA_CONTEXT_WINDOWS': '8192, 2048,4096,2048', 'OLLAMA_CONTEXT_MARGIN': '256',
        })
        self.assertEqual(config.base_url, 'http://localhost:11435')
        self.assertEqual(config.gpu_layers, 12)
        self.assertEqual((config.batch_size, config.agent_batch_size), (96, 32))
        self.assertEqual((config.timeout, config.scene_timeout), (180, 600))
        self.assertEqual(config.context_windows, (2048, 4096, 8192))
        self.assertEqual(config.context_margin, 256)

    def test_cpu_and_automatic_gpu_selection_are_distinct(self):
        self.assertEqual(read_ollama_config({'OLLAMA_GPU_LAYERS': '0'}).gpu_layers, 0)
        self.assertIsNone(read_ollama_config({'OLLAMA_GPU_LAYERS': ' AUTO '}).gpu_layers)

    def test_invalid_values_name_the_setting_instead_of_silently_using_defaults(self):
        for name, value in (
            ('OLLAMA_GPU_LAYERS', '-1'), ('OLLAMA_GPU_LAYERS', 'gpu'),
            ('OLLAMA_BATCH_SIZE', '0'), ('OLLAMA_AGENT_BATCH_SIZE', '1.5'),
            ('OLLAMA_TIMEOUT', '0'), ('OLLAMA_SCENE_TIMEOUT', '-10'),
            ('OLLAMA_CONTEXT_WINDOWS', ''), ('OLLAMA_CONTEXT_WINDOWS', '2048,'),
            ('OLLAMA_CONTEXT_WINDOWS', '-1,4096'), ('OLLAMA_CONTEXT_WINDOWS', '4096,65536'),
            ('OLLAMA_CONTEXT_MARGIN', '-1'), ('OLLAMA_CONTEXT_MARGIN', '4096'),
            ('OLLAMA_BASE_URL', ''), ('OLLAMA_BASE_URL', 'ftp://localhost:11434'),
            ('OLLAMA_BASE_URL', 'http://localhost:not-a-port'),
        ):
            with self.subTest(name=name, value=value), self.assertRaisesRegex(OllamaConfigError, name):
                read_ollama_config({name: value})

    def test_smaller_single_window_and_zero_margin_are_explicit_choices(self):
        config = read_ollama_config({'OLLAMA_CONTEXT_WINDOWS': '2048', 'OLLAMA_CONTEXT_MARGIN': '0'})
        self.assertEqual(config.context_windows, (2048,))
        self.assertEqual(config.context_margin, 0)


class OllamaStartupConfigurationTests(SimpleTestCase):
    def test_startup_environment_controls_context_gpu_batch_address_and_timeouts(self):
        # Fresh interpreters verify startup loading and real request construction,
        # without reloading shared application modules or contacting Ollama.
        program = '''
import json
from io import BytesIO
from unittest.mock import patch
from langchain_core.messages import HumanMessage
from backend.agents._model import create_local_chat_model
from backend.agents.scenarist import SCENE_WRITE_TIMEOUT
from backend.llm_config import OLLAMA_CONFIG
from backend.ollama import generate

class Reply(BytesIO):
    status = 200

def response():
    return Reply(b'{"message":{"content":"OK"},"response":"OK","done":true}\\n')

with patch('backend.ollama.HTTPConnection') as transport:
    transport.return_value.getresponse.side_effect = [response(), response()]
    answer = create_local_chat_model(max_tokens=512).invoke([HumanMessage('Anna znajduje bilet.')])
    generate('Anna znajduje bilet.')
    bodies = [json.loads(call.kwargs['body']) for call in transport.return_value.request.call_args_list]
    print(json.dumps({
        'agent_options': bodies[0]['options'], 'direct_options': bodies[1]['options'],
        'address': list(transport.call_args_list[0].args),
        'timeout': transport.call_args_list[0].kwargs['timeout'],
        'scene_timeout': SCENE_WRITE_TIMEOUT, 'windows': OLLAMA_CONFIG.context_windows,
        'margin': OLLAMA_CONFIG.context_margin, 'model': bodies[0]['model'],
        'answer': answer.content,
    }))
'''
        environment = os.environ | {
            'OLLAMA_BASE_URL': 'http://127.0.0.1:11435',
            'OLLAMA_BATCH_SIZE': '96', 'OLLAMA_AGENT_BATCH_SIZE': '32',
            'OLLAMA_TIMEOUT': '180', 'OLLAMA_SCENE_TIMEOUT': '600',
            'OLLAMA_CONTEXT_WINDOWS': '1024,2048', 'OLLAMA_CONTEXT_MARGIN': '64',
            'PYTHONIOENCODING': 'utf-8',
        }
        for gpu_layers in ('auto', '0', '12'):
            with self.subTest(gpu_layers=gpu_layers):
                process = subprocess.run(
                    [sys.executable, '-c', program],
                    cwd=Path(__file__).resolve().parents[2],
                    env=environment | {'OLLAMA_GPU_LAYERS': gpu_layers},
                    capture_output=True, text=True, encoding='utf-8', timeout=30,
                )
                self.assertEqual(process.returncode, 0, process.stderr)
                result = json.loads(process.stdout)
                self.assertEqual(result['agent_options']['num_ctx'], 1024)
                self.assertEqual(result['agent_options']['num_batch'], 32)
                self.assertEqual(result['agent_options']['num_predict'], 512)
                self.assertEqual(result['direct_options']['num_batch'], 96)
                for options in (result['agent_options'], result['direct_options']):
                    if gpu_layers == 'auto':
                        self.assertNotIn('num_gpu', options)
                    else:
                        self.assertEqual(options['num_gpu'], int(gpu_layers))
                self.assertEqual(result['address'], ['127.0.0.1', 11435])
                self.assertEqual((result['timeout'], result['scene_timeout']), (180, 600))
                self.assertEqual(result['windows'], [1024, 2048])
                self.assertEqual(result['margin'], 64)
                self.assertEqual(result['model'], 'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M')
                self.assertEqual(result['answer'], 'OK')
