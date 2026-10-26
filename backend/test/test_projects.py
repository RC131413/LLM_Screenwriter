from backend.api.models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant,
)

from ._api_base import ApiTestCase


class ProjectTests(ApiTestCase):

    def test_project_crud_and_workspace(self):
        project = self.assert_status(self.send('post', '/projects', {
            'title': 'New film', 'synopsis': 'A long synopsis', 'target_audience': 'Adults',
        }), 201).json()
        self.assertEqual(project['user_id'], self.user.pk)
        pk = project['id']
        self.assert_status(self.send('get', f'/projects/{pk}'), 200)
        self.assert_status(self.send('patch', f'/projects/{pk}', {'title': 'Renamed'}), 200)
        self.assertEqual(Project.objects.get(pk=pk).synopsis, 'A long synopsis')
        self.assert_status(self.send('delete', f'/projects/{pk}'), 204)
        self.assertFalse(Project.objects.filter(pk=pk).exists())
        workspace = self.assert_status(self.send('get', f'/projects/{self.project.pk}/workspace'), 200).json()
        self.assertEqual(len(workspace['scenes']), 2)
        self.assertEqual(workspace['scenes'][0]['cast_members'][0]['character_id'], self.character.pk)

    def test_project_filters_soft_delete_archive_favorite_and_recent(self):
        pk = self.project.pk
        self.assertEqual(self.send('get', '/projects').json()['count'], 2)
        for action, collection in [('favorite', 'favorites'), ('open', 'recent'), ('archive', 'archive'), ('trash', 'trash')]:
            self.assert_status(self.send('post', f'/projects/{pk}/actions/{action}'), 200)
            response = self.assert_status(self.send('get', f'/projects?collection={collection}'), 200).json()
            self.assertEqual([p['id'] for p in response['items']], [pk])
        self.assertEqual(self.send('get', '/projects?collection=archive').json()['count'], 0)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/restore'), 200)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/unarchive'), 200)
        self.assert_status(self.send('post', f'/projects/{pk}/actions/unfavorite'), 200)
        self.assertEqual(self.send('get', '/projects?collection=favorites').json()['count'], 0)
        self.assertEqual(self.send('get', '/projects').json()['count'], 2)
        self.assertEqual(self.send('get', '/projects?search=Second').json()['count'], 1)

    def test_pagination_is_bounded_and_validated(self):
        response = self.assert_status(self.send('get', '/projects?limit=1&offset=1'), 200).json()
        self.assertEqual(response['count'], 2)
        self.assertEqual(len(response['items']), 1)
        for query in ['limit=0', 'limit=101', 'offset=-1', 'collection=invalid']:
            self.assert_status(self.send('get', '/projects?' + query), 422)

    def test_project_deletion_cascades_only_its_own_data(self):
        self.assert_status(self.send('delete', f'/projects/{self.project.pk}'), 204)
        for model, pk in [(Act, self.act.pk), (Scene, self.scene.pk), (Character, self.character.pk),
                          (SceneCharacter, self.member.pk), (SceneGenerationRequest, self.prompt.pk),
                          (GenerationRun, self.generation_run.pk), (AgentExecution, self.execution.pk),
                          (SceneVariant, self.variant.pk)]:
            self.assertFalse(model.objects.filter(pk=pk).exists())
        self.assertTrue(Project.objects.filter(pk=self.foreign_project.pk).exists())
        self.assertTrue(Scene.objects.filter(pk=self.foreign_scene.pk).exists())

