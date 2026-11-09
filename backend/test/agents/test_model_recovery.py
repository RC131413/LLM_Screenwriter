from copy import deepcopy
import json
from unittest.mock import patch

from django.test import SimpleTestCase

from backend.agents._model import CancellableChatOllama, MAX_STRUCTURED_ATTEMPTS
from backend.agents.critic import CriticAgent
from backend.agents.scenarist import ScenaristAgent
from backend.ollama import OLLAMA_MODEL, OllamaCancelled, OllamaError, OllamaOutputLimit


ANSWER = {'blocks': [
    {'type': 'action', 'text': 'Anna odsuwa szafę i odnajduje list.'},
    {'type': 'speech', 'speaker': 'STARSZY MĘŻCZYZNA', 'parenthetical': None,
     'spoken_text': 'Zostaw go zamkniętego.'},
]}
PARTIAL = '{"blocks":[{"type":"action","text":"Anna odsuwa'


class ModelRecoveryTests(SimpleTestCase):
    def setUp(self):
        self.observed = []
        self.model = CancellableChatOllama(
            model=OLLAMA_MODEL, num_predict=2048, temperature=0.7, context_observer=self.observed.append,
        )
        self.context = {'scene': {'location_heading': 'WN. DOM', 'content_text': 'Anna zamyka drzwi.'},
                        'characters': [{'name': 'Anna'}, {'name': 'Starszy mężczyzna'}]}
        self.original = deepcopy(self.context)

    def write(self):
        return ScenaristAgent(self.model).write_scene_draft(
            user_prompt='Anna znajduje list.', context=self.context,
            beats=['Anna odnajduje list.', 'Starszy mężczyzna przestrzega ją przed otwarciem listu.'],
        )

    @patch('backend.ollama.generate', side_effect=[OllamaOutputLimit(PARTIAL), json.dumps(ANSWER)])
    def test_retries_cut_output_without_restricting_the_schema_and_keeps_all_input_requirements(self, generate):
        draft = self.write()
        first, retry = generate.call_args_list
        self.assertEqual(json.loads(first.args[0]), json.loads(retry.args[0]))
        self.assertIn('kompletny, zwarty JSON', retry.kwargs['messages'][0]['content'])
        self.assertEqual(retry.kwargs['output_schema'], first.kwargs['output_schema'])
        self.assertNotIn('maxItems', first.kwargs['output_schema']['properties']['blocks'])
        self.assertEqual([call.kwargs['max_tokens'] for call in (first, retry)], [2048, 4096])
        for call in (first, retry):
            self.assertEqual(call.kwargs['temperature'], 0.7)
            self.assertEqual(call.kwargs['num_ctx'], 4096)
            self.assertEqual(call.kwargs['output_schema']['$defs']['CastGeneratedSpeech']['properties']['speaker']['enum'],
                             ['ANNA', 'STARSZY MĘŻCZYZNA'])
        self.assertEqual(self.context, self.original)
        self.assertNotIn('Anna odsuwa\n', draft.text)
        self.assertEqual([block['type'] for block in draft.blocks], ['action', 'character', 'dialogue'])
        self.assertEqual([item['attempt'] for item in self.observed], [1, 2])
        self.assertEqual(self.model.num_predict, 2048)

    @patch('backend.ollama.generate', side_effect=OllamaOutputLimit(PARTIAL))
    def test_repeated_cut_output_stops_after_bounded_attempts_and_is_never_published(self, generate):
        with self.assertRaisesRegex(OllamaError, 'dokończyć odpowiedzi'):
            self.write()
        self.assertEqual(generate.call_count, MAX_STRUCTURED_ATTEMPTS)
        self.assertEqual(self.context, self.original)

    @patch('backend.ollama.generate', side_effect=OllamaError('Brak połączenia.', status_code=503))
    def test_connection_failure_is_not_retried_as_a_length_problem(self, generate):
        with self.assertRaisesRegex(OllamaError, 'Brak połączenia'):
            self.write()
        generate.assert_called_once()

    @patch('backend.ollama.generate')
    def test_cancelling_between_attempts_does_not_start_another_request(self, generate):
        cancelled = False
        self.model.is_cancelled = lambda: cancelled

        def cut(*args, **kwargs):
            nonlocal cancelled
            cancelled = True
            raise OllamaOutputLimit(PARTIAL)

        generate.side_effect = cut
        with self.assertRaises(OllamaCancelled):
            self.write()
        generate.assert_called_once()

    @patch('backend.ollama.generate', side_effect=OllamaOutputLimit(json.dumps(ANSWER) + '   '))
    def test_a_complete_document_followed_by_whitespace_is_validated_normally(self, generate):
        draft = self.write()
        self.assertIn('Anna odsuwa szafę i odnajduje list.', draft.text)
        generate.assert_called_once()

    @patch('backend.ollama.generate', side_effect=[
        OllamaOutputLimit('{"score":8,"feedback":"Scena'),
        json.dumps({'score': 8, 'feedback': 'Spójna scena.', 'findings': []}),
    ])
    def test_a_cut_critic_review_is_also_retried_and_its_categories_remain(self, generate):
        model = self.model.model_copy(update={'num_predict': 512, 'temperature': 0})
        review = CriticAgent(model).review_scene('Anna znajduje list.', user_prompt='Znajdź list.')
        self.assertEqual(review.score, 8)
        self.assertEqual(generate.call_count, 2)
        schema = generate.call_args.kwargs['output_schema']
        self.assertEqual(schema['$defs']['SceneFinding']['properties']['category']['enum'],
                         ['character', 'continuity', 'prompt_alignment', 'screenplay_format'])
        self.assertNotIn('maxLength', schema['properties']['feedback'])
