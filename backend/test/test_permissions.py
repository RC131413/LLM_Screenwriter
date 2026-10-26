from ._api_base import ApiTestCase


class PermissionTests(ApiTestCase):

    def test_client_cannot_override_owner_or_server_fields(self):
        for data in [{'title': 'No', 'user_id': self.other_user.pk},
                     {'title': 'No', 'id': 999}, {'title': 'No', 'created_at': '2000-01-01'}]:
            self.assert_status(self.send('post', '/projects', data), 422)
        self.assert_status(self.send('patch', f'/acts/{self.act.pk}', {'project_id': self.foreign_project.pk}), 422)

    def test_foreign_resources_return_404_for_every_read_path(self):
        paths = [
            f'/projects/{self.foreign_project.pk}', f'/projects/{self.foreign_project.pk}/workspace',
            f'/projects/{self.foreign_project.pk}/acts', f'/projects/{self.foreign_project.pk}/characters',
            f'/projects/{self.foreign_project.pk}/scenes', f'/acts/{self.foreign_act.pk}',
            f'/characters/{self.foreign_character.pk}', f'/scenes/{self.foreign_scene.pk}',
            f'/scenes/{self.foreign_scene.pk}/cast', f'/cast/{self.foreign_member.pk}',
            f'/scenes/{self.foreign_scene.pk}/prompts', f'/prompts/{self.foreign_prompt.pk}',
            f'/prompts/{self.foreign_prompt.pk}/run', f'/scenes/{self.foreign_scene.pk}/runs',
            f'/runs/{self.foreign_run.pk}', f'/runs/{self.foreign_run.pk}/agents',
            f'/agent-executions/{self.foreign_execution.pk}', f'/runs/{self.foreign_run.pk}/variants',
            f'/scenes/{self.foreign_scene.pk}/variants', f'/variants/{self.foreign_variant.pk}',
        ]
        for path in paths:
            with self.subTest(path=path):
                self.assert_status(self.send('get', path), 404)

    def test_foreign_resources_cannot_be_changed_or_deleted(self):
        paths = [f'/projects/{self.foreign_project.pk}', f'/acts/{self.foreign_act.pk}',
                 f'/characters/{self.foreign_character.pk}', f'/scenes/{self.foreign_scene.pk}',
                 f'/cast/{self.foreign_member.pk}']
        for path in paths:
            for method in ['patch', 'delete']:
                with self.subTest(path=path, method=method):
                    self.assert_status(self.send(method, path, {}), 404)
        self.assert_status(self.send('post', f'/variants/{self.foreign_variant.pk}/select', {}), 404)
        self.assert_status(self.send('post', f'/projects/{self.foreign_project.pk}/actions/trash'), 404)

    def test_foreign_parent_creation_endpoints_are_protected(self):
        for path, payload in [
            (f'/projects/{self.foreign_project.pk}/acts', {'act_number': 2}),
            (f'/projects/{self.foreign_project.pk}/characters', {'name': 'No'}),
            (f'/projects/{self.foreign_project.pk}/scenes', {'act_id': self.foreign_act.pk, 'scene_number': 2}),
            (f'/scenes/{self.foreign_scene.pk}/cast', {'character_id': self.foreign_character.pk}),
            (f'/scenes/{self.foreign_scene.pk}/prompts', {'user_prompt': 'No'}),
        ]:
            self.assert_status(self.send('post', path, payload), 404)

