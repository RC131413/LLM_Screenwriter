import json

from ._api_base import ApiTestCase


class ApiContractTests(ApiTestCase):

    def test_openapi_and_docs_cover_all_resource_groups(self):
        response = self.assert_status(self.client.get('/api/openapi.json'), 200)
        schema = response.json()
        self.assertIn('/api/scenes/{scene_id}/prompts', schema['paths'])
        self.assertIn('/api/variants/{variant_id}/select', schema['paths'])
        self.assertIn('cookie', json.dumps(schema['components']['securitySchemes']))
        self.assertNotIn('password', schema['components']['schemas']['UserOut']['properties'])
        self.assert_status(self.client.get('/api/docs'), 200)

    def test_invalid_ids_and_json_fail_cleanly(self):
        self.assert_status(self.send('get', '/projects/0'), 422)
        self.assert_status(self.send('get', '/projects/not-an-id'), 422)
        self.assert_status(self.send('get', '/projects/999999'), 404)
        self.assert_status(self.send('post', '/projects', {'title': 'Invalid JSON', 'metadata': {'value': float('nan')}}), 422)
        self.assert_status(self.send('post', '/projects', {'title': ''}), 422)
        self.assert_status(self.send('patch', f'/projects/{self.project.pk}', {'metadata': []}), 422)

