from django.test import Client

from backend.api.models import UserProfile

from ._api_base import ApiTestCase


class AccountTests(ApiTestCase):

    def test_current_account_does_not_expose_authentication_fields(self):
        response = self.assert_status(self.send('get', '/users/me'), 200).json()
        self.assertEqual(response['email'], self.user.email)
        self.assertEqual(response['profile']['user_id'], self.user.pk)
        for field in ['password', 'password_hash', 'is_staff', 'is_superuser', 'user_permissions']:
            self.assertNotIn(field, response)

    def test_account_update_only_allows_username(self):
        self.assert_status(self.send('patch', '/users/me', {'username': 'screenwriter'}), 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'screenwriter')
        for data in [{'email': 'changed@example.com'}, {'is_staff': True}, {'username': None}]:
            self.assert_status(self.send('patch', '/users/me', data), 422)
        self.assert_status(self.send('patch', '/users/me', {'username': 'OTHER'}), 409)

    def test_password_change_verifies_old_and_confirmation_and_preserves_session(self):
        data = {'old_password': self.password, 'new_password': 'Another-strong-password-826!',
                'new_password_confirm': 'Another-strong-password-826!'}
        self.assert_status(self.send('post', '/users/me/password', {**data, 'old_password': 'wrong'}), 422)
        self.assert_status(self.send('post', '/users/me/password', {**data, 'new_password_confirm': self.password}), 422)
        self.assert_status(self.send('post', '/users/me/password', data), 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(data['new_password']))
        self.assertFalse(self.user.check_password(self.password))
        self.assert_status(self.send('get', '/users/me'), 200)

    def test_profile_and_preferences_defaults_and_updates(self):
        response = self.assert_status(self.send('patch', '/users/me/profile', {
            'display_name': 'Writer Name', 'avatar_url': 'https://example.com/avatar.png',
            'preferred_language': 'pl',
        }), 200)
        self.assertEqual(response.json()['display_name'], 'Writer Name')
        self.assert_status(self.send('get', '/users/me/profile'), 200)
        preferences = self.assert_status(self.send('get', '/users/me/preferences'), 200).json()
        self.assertEqual(preferences['llm_preferences']['max_tokens'], 2048)
        preferences['llm_preferences']['temperature'] = 0.4
        preferences['writing_style_preferences']['parentheticals'] = 'ignore'
        self.assert_status(self.send('put', '/users/me/preferences', preferences), 200)
        self.assertEqual(UserProfile.objects.get(user=self.user).llm_preferences['temperature'], 0.4)
        self.assert_status(self.send('put', '/users/me/preferences', {}), 200)
        self.assertEqual(UserProfile.objects.get(user=self.user).llm_preferences['temperature'], 0.7)

    def test_invalid_preferences_and_avatar_are_rejected(self):
        for preferences in [
            {'llm_preferences': {'temperature': 1.1}},
            {'llm_preferences': {'temperature': 0.15}},
            {'llm_preferences': {'max_tokens': 0}},
            {'llm_preferences': {'model_name': 'another model'}},
            {'writing_style_preferences': {'parentheticals': 'always'}},
            {'writing_style_preferences': None},
        ]:
            self.assert_status(self.send('put', '/users/me/preferences', preferences), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'preferred_language': 'en'}), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'avatar_url': 'javascript:alert(1)'}), 422)
        self.assert_status(self.send('patch', '/users/me/profile', {'avatar_url': 'http://['}), 422)

    def test_empty_legacy_profile_json_uses_defaults(self):
        UserProfile.objects.create(user=self.user)
        response = self.assert_status(self.send('get', '/users/me/preferences'), 200).json()
        self.assertEqual(response['llm_preferences']['model_name'], 'Bielik 11B (Lokalny)')
        self.assertEqual(response['writing_style_preferences']['parentheticals'], 'sparingly')

    def test_other_sessions_expire_after_password_change(self):
        another_session = Client(enforce_csrf_checks=True)
        another_session.force_login(self.user)
        self.assert_status(self.send('post', '/users/me/password', {
            'old_password': self.password, 'new_password': 'Different-test-secret-798!',
            'new_password_confirm': 'Different-test-secret-798!',
        }), 200)
        self.assert_status(self.send('get', '/users/me', client=another_session), 401)

