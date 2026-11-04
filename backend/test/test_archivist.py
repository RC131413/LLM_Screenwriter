import json
from copy import deepcopy

import httpx
from django.test import SimpleTestCase
from langchain_core.exceptions import OutputParserException
from langchain_ollama import ChatOllama

from backend.agents.archivist import ArchivedContext, ArchivistAgent
from backend.ollama import OLLAMA_BASE_URL, OLLAMA_MODEL


class ArchivistAgentTests(SimpleTestCase):
    def setUp(self):
        self.requests = []
        self.reply = {
            'characters': [], 'previous_scenes': [], 'continuity_facts': [], 'open_threads': [],
        }
        transport = httpx.MockTransport(self.respond)
        self.archivist = ArchivistAgent(ChatOllama(
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

    def test_empty_context_returns_empty_archive_without_calling_ollama(self):
        result = self.archivist.prepare_context(user_prompt='Kontynuuj.', context={})

        self.assertIsInstance(result, ArchivedContext)
        self.assertEqual(result.model_dump(), self.reply)
        self.assertEqual(self.requests, [])

    def test_sends_supplied_context_and_parses_all_archive_fields(self):
        context = {
            'project': {'title': 'Ostatni pociąg'},
            'act': {'summary': 'W finale Marta spali bilet.'},
            'scene': {'scene_number': 9, 'ai_metadata': {'scene_goal': 'Odnaleźć bilet.'}},
            'characters': [{'name': 'Marta', 'goals': 'Wyjechać z miasta.', 'fears': 'Woda'}],
            'previous_scenes': [
                {'scene_number': 5, 'content_text': 'Marta gubi bilet.'},
                {'scene_number': 2, 'summary': 'Olek znajduje bilet. Marta tego nie widzi.'},
            ],
        }
        original_context = deepcopy(context)
        prompt = 'Marta próbuje zdążyć na pociąg.'
        self.reply = {
            'characters': [{'name': 'MARTA', 'profile': 'Chce wyjechać z miasta i boi się wody.'}],
            'previous_scenes': [
                {'scene_number': 5, 'summary': 'Marta gubi bilet.'},
                {'scene_number': 2, 'summary': 'Olek znajduje bilet.'},
            ],
            'continuity_facts': ['Marta nie wie, że Olek ma bilet.'],
            'open_threads': ['Marta nadal szuka biletu.'],
        }

        result = self.archivist.prepare_context(user_prompt=prompt, context=context)

        self.assertIsInstance(result, ArchivedContext)
        self.assertEqual(result.model_dump(), self.reply)
        self.assertEqual(context, original_context)
        request, = self.requests
        self.assertEqual(request['format'], ArchivedContext.model_json_schema())
        self.assertEqual([message['role'] for message in request['messages']], ['system', 'user'])
        self.assertEqual(json.loads(request['messages'][1]['content']), {
            'user_prompt': prompt, 'context': original_context,
        })

    def test_reusing_archivist_keeps_project_contexts_separate(self):
        first = {'project': {'id': 1}, 'characters': [{'name': 'Marta'}]}
        second = {'project': {'id': 2}, 'characters': [{'name': 'Olek'}]}
        self.reply['characters'] = [{'name': 'Marta', 'profile': 'Szuka biletu.'}]
        first_result = self.archivist.prepare_context(user_prompt='Znajdź bilet.', context=first)
        self.reply['characters'] = [{'name': 'Olek', 'profile': 'Szuka klucza.'}]
        second_result = self.archivist.prepare_context(user_prompt='Znajdź klucz.', context=second)

        self.assertEqual([character.name for character in first_result.characters], ['Marta'])
        self.assertEqual([character.name for character in second_result.characters], ['Olek'])
        self.assertEqual(
            [json.loads(request['messages'][1]['content']) for request in self.requests],
            [
                {'user_prompt': 'Znajdź bilet.', 'context': first},
                {'user_prompt': 'Znajdź klucz.', 'context': second},
            ],
        )

    def test_rejects_character_outside_supplied_profiles(self):
        self.reply['characters'] = [{'name': 'Olek', 'profile': 'Szuka klucza.'}]

        with self.assertRaisesRegex(ValueError, 'postać spoza przekazanych kart'):
            self.archivist.prepare_context(
                user_prompt='Kontynuuj.', context={'characters': [{'name': 'Marta'}]},
            )

    def test_rejects_scene_outside_supplied_history(self):
        self.reply['previous_scenes'] = [{'scene_number': 3, 'summary': 'Marta odzyskuje bilet.'}]
        context = {
            'scene': {'scene_number': 3},
            'previous_scenes': [{'scene_number': 2, 'content_text': 'Marta gubi bilet.'}],
        }

        with self.assertRaisesRegex(ValueError, 'scenę spoza przekazanego kontekstu'):
            self.archivist.prepare_context(user_prompt='Kontynuuj.', context=context)

    def test_rejects_invalid_structured_output(self):
        empty_archive = self.reply.copy()
        for fields in (
            {'characters': [{'name': 'Marta', 'profile': ' '}]},
            {'previous_scenes': [{'scene_number': 0, 'summary': 'Scena.'}]},
            {'continuity_facts': 'Jedna informacja zamiast listy.'},
        ):
            with self.subTest(fields=fields):
                self.reply = {**empty_archive, **fields}
                with self.assertRaises(OutputParserException):
                    self.archivist.prepare_context(user_prompt='Kontynuuj.', context={'project': {'id': 1}})
