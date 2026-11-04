"""Give each graph node a structured response while a test controls the writer."""

import json
from functools import wraps
from unittest.mock import Mock, patch


def patch_writer(**writer_options):
    def decorate(test):
        @wraps(test)
        def run(self):
            writer = Mock(**writer_options)

            def respond(prompt, **options):
                properties = options['output_schema']['properties']
                if 'continuity_facts' in properties:
                    context = json.loads(prompt)['context']
                    answer = {
                        'characters': [{'name': card['name'], 'profile': 'Profil postaci.'}
                                       for card in context.get('characters', [])],
                        'previous_scenes': [], 'continuity_facts': [], 'open_threads': [],
                    }
                elif 'beats' in properties:
                    answer = {'beats': ['Rozwiń wydarzenie w bieżącej scenie.']}
                elif 'score' in properties:
                    answer = {'score': 8, 'feedback': 'Scena jest spójna.', 'findings': []}
                else:
                    return writer(prompt, **options)
                return json.dumps(answer, ensure_ascii=False)

            with patch('backend.ollama.generate', side_effect=respond):
                return test(self, writer)
        return run
    return decorate
