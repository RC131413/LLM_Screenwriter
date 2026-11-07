import json

from backend.api.models import Character, GenerationRun, SceneCharacter, SceneVariant

from ._api_base import ApiTestCase
from ._graph_transport import patch_writer


CORRECT_SCENE = json.dumps({'blocks': [
    {'type': 'action', 'text': 'Pradziadek pokazuje Maćkowi list.'},
    {'type': 'speech', 'speaker': 'STARSZY MĘŻCZYZNA', 'parenthetical': None,
     'spoken_text': 'Twój dziadek zostawił ten list.'},
    {'type': 'speech', 'speaker': 'MACIEK', 'parenthetical': None,
     'spoken_text': 'Dziękuję, pradziadku.'},
]}, ensure_ascii=False)


class SpeakerLabelApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.character.name = 'MACIEK'
        self.character.save(update_fields=['name'])
        self.elder = Character.objects.create(
            project=self.project, name='STARSZY MĘŻCZYZNA', role='Pradziadek Maćka',
        )
        SceneCharacter.objects.create(scene=self.scene, character=self.elder)
        self.scene.location_heading = 'WN. CHATA'
        self.scene.save(update_fields=['location_heading'])

    @patch_writer(return_value=CORRECT_SCENE)
    def test_selected_labels_survive_generation_saving_and_application(self, generate):
        variant = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Pradziadek pokazuje Maćkowi list.',
        }), 201).json()

        self.assertEqual(generate.call_args.kwargs['output_schema']['$defs']
                         ['CastGeneratedSpeech']['properties']['speaker']['enum'],
                         ['MACIEK', 'STARSZY MĘŻCZYZNA'])
        generated_blocks = variant['critic_metadata']['blocks']
        self.assertEqual([block['text'] for block in generated_blocks if block['type'] == 'character'],
                         ['STARSZY MĘŻCZYZNA', 'MACIEK'])
        self.assertIn('Pradziadek pokazuje Maćkowi list.', variant['generated_full_text'])
        self.assertIn('Dziękuję, pradziadku.', variant['generated_full_text'])

        self.assert_status(self.send('post', f'/variants/{variant["id"]}/select', {'apply_to_scene': True}), 200)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.editor_metadata['blocks'], generated_blocks)
        self.assertEqual(set(self.scene.cast_members.values_list('character_id', flat=True)),
                         {self.character.pk, self.elder.pk})
        self.assertEqual(Character.objects.filter(project=self.project).count(), 2)
        generate.assert_called_once()

    @patch_writer(return_value=json.dumps({'blocks': [
        {'type': 'speech', 'speaker': 'PRADZIADEK', 'parenthetical': None, 'spoken_text': 'Usiądź.'},
    ]}))
    def test_incorrect_label_is_not_persisted_as_a_variant(self, generate):
        before = SceneVariant.objects.count()
        response = self.assert_status(self.send('post', f'/scenes/{self.scene.pk}/generate', {
            'user_prompt': 'Starszy mężczyzna zaprasza Maćka do stołu.',
        }), 502)

        self.assertIn('Scenarzysta', response.json()['detail'])
        run = GenerationRun.objects.get(request__user_prompt='Starszy mężczyzna zaprasza Maćka do stołu.')
        self.assertEqual(run.status, 'failed')
        self.assertFalse(run.variants.exists())
        self.assertEqual(SceneVariant.objects.count(), before)
        generate.assert_called_once()
