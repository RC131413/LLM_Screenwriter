from copy import deepcopy
import json
from unittest.mock import patch

from django.test import SimpleTestCase
from langchain_core.messages import HumanMessage, SystemMessage

from backend.agents._model import CancellableChatOllama, create_local_chat_model
from backend.agents.context_budget import CONTEXT_MARGIN, ContextWindowPolicy, count_input_tokens, prepare_context
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL, OllamaError


def messages(content):
    return [{'role': 'system', 'content': 'Pomóż napisać scenę.'}, {'role': 'user', 'content': content}]


class ContextBudgetTests(SimpleTestCase):
    def test_short_input_fits_small_window_without_changing_the_prompt(self):
        source = messages('Anna znajduje klucz.')
        original = deepcopy(source)
        prepared = prepare_context(source, max_tokens=512)

        self.assertEqual(prepared.num_ctx, 2048)
        self.assertEqual(prepared.messages, original)
        self.assertEqual(source, original)
        self.assertEqual(prepared.max_tokens, 512)
        self.assertEqual(prepared.adjustments, ())

    def test_same_input_with_larger_output_limit_uses_larger_window(self):
        source = messages('Anna znajduje klucz.')
        prepared = prepare_context(source, max_tokens=2048)

        self.assertEqual(prepared.num_ctx, 4096)
        self.assertEqual(prepared.max_tokens, 2048)
        self.assertLessEqual(prepared.input_tokens + prepared.max_tokens + CONTEXT_MARGIN, prepared.num_ctx)

    def test_capacity_boundary_includes_the_entire_response_and_margin(self):
        source = messages('Anna znajduje klucz.')
        output_budget = 2048 - count_input_tokens(source) - CONTEXT_MARGIN

        self.assertEqual(prepare_context(source, max_tokens=output_budget).num_ctx, 2048)
        self.assertEqual(prepare_context(source, max_tokens=output_budget + 1).num_ctx, 4096)

    def test_overflow_can_remove_technical_data_without_cutting_story_fields(self):
        payload = {
            'user_prompt': 'Anna wraca po klucz.',
            'context': {
                'project': {'id': 1, 'synopsis': 'Anna odkrywa prawdę.'},
                'act': {'id': 2, 'summary': 'Powrót do domu.'},
                'scene': {
                    'id': 3, 'content_text': 'Anna nie ma klucza.',
                    'ai_metadata': {'scene_goal': 'Odnaleźć klucz.', 'notes': 'Olek nic nie wie.'},
                    'editor_metadata': {
                        'blocks': [{'id': 'block-1', 'type': 'action', 'text': 'Anna nie ma klucza.'}],
                        'applied_variant_ids': list(range(3000)),
                    },
                },
                'characters': [{'id': 4, 'name': 'Anna', 'fears': 'Ogień',
                                'backstory': 'Pożar domu.', 'voice_profile': {'id': 'voice-a', 'style': 'Rzeczowy'}}],
            },
        }
        original = deepcopy(payload)
        prepared = prepare_context(messages(json.dumps(payload, ensure_ascii=False)), max_tokens=1024)
        sent = json.loads(prepared.messages[1]['content'])

        self.assertEqual(payload, original)
        self.assertEqual(sent['user_prompt'], payload['user_prompt'])
        self.assertEqual(sent['context']['project']['synopsis'], payload['context']['project']['synopsis'])
        scene = sent['context']['scene']
        self.assertEqual(scene['content_text'], payload['context']['scene']['content_text'])
        self.assertEqual(scene['ai_metadata'], payload['context']['scene']['ai_metadata'])
        self.assertEqual(scene['editor_metadata']['blocks'], [{'type': 'action', 'text': 'Anna nie ma klucza.'}])
        self.assertEqual(sent['context']['characters'], [
            {key: value for key, value in payload['context']['characters'][0].items() if key != 'id'},
        ])
        self.assertIn('applied_variant_ids', prepared.adjustments)
        self.assertNotIn('applied_variant_ids', scene['editor_metadata'])

    def test_existing_history_summary_can_replace_its_raw_text(self):
        previous = {'scene_number': 2, 'content_text': 'Anna szuka klucza. ' * 1500,
                    'summary': 'Anna zostawiła klucz w biurze. Olek o tym nie wie.'}
        source = messages(json.dumps({'context': {'previous_scenes': [previous]}}, ensure_ascii=False))
        original = deepcopy(source)
        prepared = prepare_context(source, max_tokens=1024)

        sent = json.loads(prepared.messages[1]['content'])['context']['previous_scenes'][0]
        self.assertEqual(sent, {'scene_number': 2, 'summary': previous['summary']})
        self.assertIn('existing_scene_summaries', prepared.adjustments)
        self.assertEqual(source, original)

    def test_blank_summary_does_not_authorize_removing_history(self):
        source = messages(json.dumps({'context': {'previous_scenes': [
            {'scene_number': 2, 'content_text': 'Anna szuka klucza. ' * 1500, 'summary': '   '},
        ]}}))
        with self.assertRaises(OllamaError) as caught:
            prepare_context(source, max_tokens=1024)
        self.assertEqual(caught.exception.status_code, 422)

    def test_large_author_instruction_scene_or_character_is_never_silently_cut(self):
        large = 'Anna szuka klucza i nie wie, gdzie jest Olek. ' * 1500
        for payload in (
            {'user_prompt': large},
            {'context': {'scene': {'content_text': large}}},
            {'context': {'characters': [{'name': 'Anna', 'backstory': large}]}},
        ):
            with self.subTest(field=next(iter(payload))):
                source = messages(json.dumps(payload, ensure_ascii=False))
                original = deepcopy(source)
                with self.assertRaises(OllamaError) as caught:
                    prepare_context(source, max_tokens=1024)
                self.assertEqual(caught.exception.status_code, 422)
                self.assertIn('nie zostały automatycznie ucięte', str(caught.exception))
                self.assertEqual(source, original)

    def test_system_instructions_also_count_towards_the_limit(self):
        source = messages('Kontynuuj.')
        source[0]['content'] = 'Sprawdź zgodność postaci. ' * 1500
        with self.assertRaises(OllamaError):
            prepare_context(source, max_tokens=512)


class LocalModelBudgetTests(SimpleTestCase):
    @patch('backend.ollama.generate', return_value='OK')
    def test_one_run_can_grow_but_does_not_shrink_its_window_between_agents(self, generate):
        policy = ContextWindowPolicy(max_tokens=1024)
        first_agent = CancellableChatOllama(model=OLLAMA_MODEL, num_predict=512, context_selector=policy.apply)
        second_agent = CancellableChatOllama(model=OLLAMA_MODEL, num_predict=1024, context_selector=policy.apply)

        first_agent.invoke([HumanMessage('Anna znajduje klucz.')])
        second_agent.invoke([HumanMessage('Anna znajduje klucz. ' * 250)])
        first_agent.invoke([HumanMessage('Anna wychodzi.')])

        self.assertEqual([call.kwargs['num_ctx'] for call in generate.call_args_list], [2048, 4096, 4096])
        fresh_run = ContextWindowPolicy(max_tokens=1024)
        self.assertEqual(fresh_run.window, 2048)

    def test_writer_output_limit_sets_a_safe_initial_floor(self):
        policy = ContextWindowPolicy(max_tokens=2048)
        self.assertEqual(policy.apply(prepare_context(messages('Kontynuuj.'), max_tokens=512)).num_ctx, 4096)
        with self.assertRaises(OllamaError):
            ContextWindowPolicy(max_tokens=4096)

    @patch('backend.ollama.generate', return_value='OK')
    def test_window_is_recalculated_for_each_call_without_changing_output_settings(self, generate):
        observed = []
        model = CancellableChatOllama(
            model=OLLAMA_MODEL, num_predict=512, temperature=0.4, context_observer=observed.append,
        )
        first = model.invoke([SystemMessage('Zaplanuj scenę.'), HumanMessage('Anna szuka klucza.')])
        second = model.invoke([SystemMessage('Zaplanuj scenę.'), HumanMessage('Anna szuka klucza. ' * 400)])

        self.assertEqual(generate.call_count, 2)
        self.assertEqual([call.kwargs['num_ctx'] for call in generate.call_args_list], [2048, 4096])
        self.assertTrue(all(call.kwargs['max_tokens'] == 512 for call in generate.call_args_list))
        self.assertTrue(all(call.kwargs['temperature'] == 0.4 for call in generate.call_args_list))
        self.assertTrue(all(call.kwargs['base_url'] == OLLAMA_BASE_URL for call in generate.call_args_list))
        self.assertEqual(first.response_metadata['context_budget'], observed[0])
        self.assertEqual(second.response_metadata['context_budget'], observed[1])

    @patch('backend.ollama.generate')
    def test_oversized_request_fails_before_any_inference(self, generate):
        model = CancellableChatOllama(model=OLLAMA_MODEL, num_predict=2048)
        with self.assertRaises(OllamaError) as caught:
            model.invoke([HumanMessage('Anna szuka klucza. ' * 1500)])
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(model.num_predict, 2048)
        generate.assert_not_called()

    def test_default_agent_factory_uses_the_same_budgeted_transport(self):
        model = create_local_chat_model(timeout=50, max_tokens=512)
        self.assertIsInstance(model, CancellableChatOllama)
        self.assertEqual(model.num_predict, 512)
        self.assertEqual(model.request_timeout, 50)
