from io import StringIO
from unittest.mock import patch

from django.apps import apps
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from backend.api.models import Project, Scene, SceneCharacter, SceneVariant, User, UserProfile


@override_settings(DEBUG=True)
class SeedDatabaseTests(TestCase):
    password = 'Seed-test-password-123!'

    def seed(self, **options):
        output = StringIO()
        call_command('seed_db', password=self.password, stdout=output, **options)
        return output.getvalue()

    def counts(self):
        return {model.__name__: model.objects.count() for model in apps.get_app_config('api').get_models()}

    def test_seed_populates_all_erd_models_with_consistent_relations(self):
        self.seed()
        self.assertEqual(self.counts(), {
            'User': 2, 'UserProfile': 2, 'Project': 2, 'Act': 6, 'Character': 4,
            'Scene': 6, 'SceneCharacter': 10, 'SceneGenerationRequest': 6,
            'GenerationRun': 6, 'AgentExecution': 24, 'SceneVariant': 12,
        })
        for model in apps.get_app_config('api').get_models():
            for instance in model.objects.all():
                instance.full_clean()
        for scene in Scene.objects.select_related('act'):
            self.assertEqual(scene.project_id, scene.act.project_id)
        for member in SceneCharacter.objects.select_related('scene', 'character'):
            self.assertEqual(member.scene.project_id, member.character.project_id)
        for variant in SceneVariant.objects.select_related('run__request'):
            self.assertEqual(variant.scene_id, variant.run.request.scene_id)

    def test_repeat_seed_keeps_counts_ids_and_passwords(self):
        self.seed()
        before = {model.__name__: list(model.objects.order_by('pk').values()) for model in apps.get_app_config('api').get_models()}
        output = self.seed()
        after = {model.__name__: list(model.objects.order_by('pk').values()) for model in apps.get_app_config('api').get_models()}
        self.assertEqual(before, after)
        self.assertEqual(output.count(': 0 created'), 11)

    def test_existing_user_data_and_seed_edits_are_preserved(self):
        user = User.objects.create_user(username='personal', email='personal@example.com')
        personal = Project.objects.create(user=user, title='Personal work', metadata={'important': True})
        self.seed()
        project = Project.objects.get(user__username='demo_writer')
        project.title = 'Edited demo project'
        project.save()
        user = User.objects.get(username='demo_writer')
        user.set_password('Changed-password-456!')
        user.save()
        self.seed()
        personal.refresh_from_db()
        project.refresh_from_db()
        user.refresh_from_db()
        self.assertEqual(personal.metadata, {'important': True})
        self.assertEqual(project.title, 'Edited demo project')
        self.assertTrue(user.check_password('Changed-password-456!'))
        self.assertEqual(Project.objects.count(), 3)

    def test_seed_passwords_are_hashed_and_accounts_are_not_staff(self):
        output = self.seed()
        for user in User.objects.all():
            self.assertTrue(user.check_password(self.password))
            self.assertFalse(user.is_staff)
            self.assertFalse(user.is_superuser)
        self.assertNotIn(self.password, output)

    def test_username_collision_rolls_back_whole_seed(self):
        user = User.objects.create_user(username='demo_editor', email='another-owner@example.com')
        with self.assertRaises(CommandError):
            self.seed()
        self.assertEqual(User.objects.count(), 1)
        self.assertTrue(User.objects.filter(pk=user.pk).exists())
        self.assertFalse(Project.objects.exists())
        self.assertFalse(UserProfile.objects.exists())

    def test_failure_during_generation_rolls_back_every_table(self):
        target = 'backend.api.management.commands.seed_db.Command.seed_generation'
        with patch(target, side_effect=ValidationError('Invalid generation context')):
            with self.assertRaises(CommandError):
                self.seed()
        self.assertTrue(all(count == 0 for count in self.counts().values()))

    @override_settings(DEBUG=False)
    def test_seed_refuses_production_settings(self):
        with self.assertRaises(CommandError):
            self.seed()
        self.assertFalse(User.objects.exists())

    def test_seed_refuses_short_password(self):
        with self.assertRaises(CommandError):
            call_command('seed_db', password='short', stdout=StringIO())
        self.assertFalse(User.objects.exists())

    def test_password_can_be_loaded_from_environment(self):
        with patch.dict('os.environ', {'SEED_DEMO_PASSWORD': self.password}):
            call_command('seed_db', stdout=StringIO())
        self.assertTrue(User.objects.get(username='demo_writer').check_password(self.password))

