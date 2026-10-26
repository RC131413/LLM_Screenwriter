from backend.api.models import Scene, SceneCharacter

from ._api_base import ApiTestCase


class CharacterTests(ApiTestCase):

    def test_removing_character_does_not_remove_its_scenes(self):
        self.assert_status(self.send('delete', f'/characters/{self.character.pk}'), 204)
        self.assertFalse(SceneCharacter.objects.filter(pk=self.member.pk).exists())
        self.assertTrue(Scene.objects.filter(pk=self.scene.pk).exists())

    def test_character_crud_includes_llm_context_fields(self):
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/characters'), 200)
        character = self.assert_status(self.send('post', f'/projects/{self.project.pk}/characters', {
            'name': 'JAN', 'appearance': 'Grey coat', 'backstory': 'A former teacher',
            'voice_profile': {'tone': 'quiet'}, 'age': 40,
        }), 201).json()
        self.assertEqual(character['appearance'], 'Grey coat')
        pk = character['id']
        self.assert_status(self.send('get', f'/characters/{pk}'), 200)
        self.assert_status(self.send('patch', f'/characters/{pk}', {'backstory': 'A former writer', 'age': None}), 200)
        self.assert_status(self.send('delete', f'/characters/{pk}'), 204)

    def test_cast_crud_and_cross_project_validation(self):
        response = self.assert_status(self.send('get', f'/scenes/{self.scene.pk}/cast'), 200).json()
        self.assertEqual(response['count'], 1)
        member = self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {
            'character_id': self.character.pk, 'presence_type': 'voice_over', 'notes': 'Phone call',
        }), 201).json()
        pk = member['id']
        self.assert_status(self.send('get', f'/cast/{pk}'), 200)
        self.assert_status(self.send('patch', f'/cast/{pk}', {'notes': 'Off screen'}), 200)
        self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {'character_id': self.character.pk}), 422)
        for character in [self.second_character, self.foreign_character]:
            self.assert_status(self.send('post', f'/scenes/{self.next_scene.pk}/cast', {'character_id': character.pk}), 404)
        self.assert_status(self.send('delete', f'/cast/{pk}'), 204)

