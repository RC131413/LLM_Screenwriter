from backend.api.models import Scene

from ._api_base import ApiTestCase


class StructureTests(ApiTestCase):

    def test_act_crud_and_nonempty_delete_protection(self):
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/acts'), 200)
        act = self.assert_status(self.send('post', f'/projects/{self.project.pk}/acts', {
            'act_number': 3, 'title': 'Final act', 'summary': 'Resolution',
        }), 201).json()
        self.assert_status(self.send('get', f'/acts/{act["id"]}'), 200)
        self.assert_status(self.send('patch', f'/acts/{act["id"]}', {'summary': 'New summary', 'sort_order': 7}), 200)
        self.assert_status(self.send('delete', f'/acts/{act["id"]}'), 204)
        self.assert_status(self.send('delete', f'/acts/{self.act.pk}'), 409)
        self.assertTrue(Scene.objects.filter(pk=self.scene.pk).exists())

    def test_duplicate_numbers_and_null_values_fail_without_database_damage(self):
        self.assert_status(self.send('post', f'/projects/{self.project.pk}/acts', {'act_number': 1}), 422)
        for payload in [{'act_number': 0}, {'act_number': None}, {'title': None}, {'metadata': None}]:
            self.assert_status(self.send('patch', f'/acts/{self.next_act.pk}', payload), 422)
        self.next_act.refresh_from_db()
        self.assertEqual(self.next_act.act_number, 2)
        self.assert_status(self.send('get', '/projects'), 200)

    def test_scene_crud_move_and_context_get_are_independent(self):
        scene = self.assert_status(self.send('post', f'/projects/{self.project.pk}/scenes', {
            'act_id': self.act.pk, 'scene_number': 3, 'title': 'New scene',
            'ai_metadata': {'scene_goal': 'Reveal the truth'}, 'editor_metadata': {'notes': 'Quietly'},
        }), 201).json()
        pk = scene['id']
        self.assert_status(self.send('patch', f'/scenes/{pk}', {'act_id': self.next_act.pk}), 200)
        self.assertEqual(Scene.objects.get(pk=pk).act_id, self.next_act.pk)
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/scenes?act_id={self.act.pk}'), 200)
        self.assertEqual(Scene.objects.get(pk=pk).act_id, self.next_act.pk)
        self.assert_status(self.send('get', f'/scenes/{pk}'), 200)
        self.assert_status(self.send('delete', f'/scenes/{pk}'), 204)

    def test_scene_cannot_move_to_another_project_even_same_owner(self):
        for act in [self.second_act, self.foreign_act]:
            self.assert_status(self.send('patch', f'/scenes/{self.scene.pk}', {'act_id': act.pk}), 404)
            self.assert_status(self.send('post', f'/projects/{self.project.pk}/scenes', {
                'act_id': act.pk, 'scene_number': 3,
            }), 404)
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.act_id, self.act.pk)
        self.assert_status(self.send('get', f'/projects/{self.project.pk}/scenes?act_id={self.second_act.pk}'), 404)

