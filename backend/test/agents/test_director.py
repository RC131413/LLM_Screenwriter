import json
from copy import deepcopy

import httpx
from django.test import SimpleTestCase
from langchain_core.exceptions import OutputParserException
from langchain_ollama import ChatOllama

from backend.agents.director import DirectorAgent, ScenePlan
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL


class DirectorAgentTests(SimpleTestCase):
    def setUp(self):
        self.requests = []
        self.reply = {'beats': ['Marta szuka biletu.']}
        transport = httpx.MockTransport(self.respond)
        self.director = DirectorAgent(ChatOllama(
            model=OLLAMA_MODEL, base_url=OLLAMA_BASE_URL,
            client_kwargs={'transport': transport},
        ))

    def respond(self, request):
        self.assertEqual((request.method, request.url.path), ('POST', '/api/chat'))
        self.requests.append(json.loads(request.content))
        chunk = {
            'model': OLLAMA_MODEL,
            'message': {'role': 'assistant', 'content': json.dumps(self.reply)},
            'done': True,
            'done_reason': 'stop',
        }
        return httpx.Response(200, text=json.dumps(chunk) + '\n')

    def test_sends_author_instruction_and_context_and_returns_ordered_beats(self):
        context = {
            'scene': {'ai_metadata': {'scene_goal': 'Marta odzyskuje bilet.'}},
            'characters': [{'name': 'Marta', 'profile': 'Musi zdążyć na pociąg.'}],
            'previous_scenes': [{'scene_number': 2, 'summary': 'Olek znajduje bilet Marty.'}],
            'continuity_facts': ['Marta nie wie, że Olek znalazł bilet.'],
        }
        original = deepcopy(context)
        prompt = 'Zaplanuj, jak Marta odzyska bilet.'
        self.reply['beats'] = [
            'Marta pyta Olka, czy znalazł bilet.',
            'Olek oddaje Marcie bilet.',
            'Marta rusza na peron.',
        ]

        result = self.director.plan_scene(user_prompt=prompt, context=context)

        self.assertEqual(result, self.reply['beats'])
        self.assertEqual(context, original)
        request, = self.requests
        self.assertEqual(request['format'], ScenePlan.model_json_schema())
        self.assertEqual([message['role'] for message in request['messages']], ['system', 'user'])
        self.assertEqual(json.loads(request['messages'][1]['content']), {
            'user_prompt': prompt, 'context': original,
        })

    def test_blank_instruction_is_rejected_without_calling_ollama(self):
        with self.assertRaisesRegex(ValueError, 'Podaj polecenie autora'):
            self.director.plan_scene(user_prompt=' \n\t ', context={'scene': {'title': 'Dworzec'}})

        self.assertEqual(self.requests, [])

    def test_reusing_director_keeps_project_contexts_separate(self):
        first = {'project': {'id': 1}, 'continuity_facts': ['Marta zgubiła bilet.']}
        second = {'project': {'id': 2}, 'continuity_facts': ['Jan zamknął garaż.']}
        first_plan = self.director.plan_scene(user_prompt='Poszukaj biletu.', context=first)
        self.reply['beats'] = ['Jan wraca po klucz.']
        second_plan = self.director.plan_scene(user_prompt='Otwórz garaż.', context=second)

        self.assertEqual(first_plan, ['Marta szuka biletu.'])
        self.assertEqual(second_plan, ['Jan wraca po klucz.'])
        self.assertEqual(
            [json.loads(request['messages'][1]['content']) for request in self.requests],
            [
                {'user_prompt': 'Poszukaj biletu.', 'context': first},
                {'user_prompt': 'Otwórz garaż.', 'context': second},
            ],
        )

    def test_rejects_dialogue_and_screenplay_markers_in_beats(self):
        for beat in (
            'MARTA: Gdzie jest bilet?',
            'Marta pyta „Gdzie jest bilet?”.',
            '— Gdzie jest bilet?',
            'MARTA\nGdzie jest bilet?',
            'WN. DWORZEC – NOC',
            '1. Marta wchodzi na peron.',
        ):
            with self.subTest(beat=beat):
                self.reply = {'beats': [beat]}
                with self.assertRaises(OutputParserException):
                    self.director.plan_scene(user_prompt='Kontynuuj.', context={})

    def test_rejects_invalid_plan_shape_and_limits(self):
        for reply in (
            {},
            {'beats': 'Marta rusza na peron.'},
            {'beats': []},
            {'beats': [' \t ']},
            {'beats': ['x' * 221]},
            {'beats': [f'Zdarzenie {number}.' for number in range(1, 10)]},
            {'beats': ['Marta rusza na peron.'], 'dialogue': 'Oddaj bilet.'},
        ):
            with self.subTest(reply=reply):
                self.reply = reply
                with self.assertRaises(OutputParserException):
                    self.director.plan_scene(user_prompt='Kontynuuj.', context={})

    def test_simple_scene_can_have_one_beat_with_empty_context(self):
        result = self.director.plan_scene(user_prompt='Zaplanuj poszukiwanie biletu.', context={})

        self.assertEqual(result, ['Marta szuka biletu.'])
