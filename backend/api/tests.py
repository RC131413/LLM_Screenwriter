from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, models, transaction
from django.db.backends.postgresql.base import DatabaseWrapper
from django.db.migrations.autodetector import MigrationAutodetector
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.operations.models import CreateModel
from django.db.migrations.state import ProjectState
from django.db.migrations.writer import MigrationWriter
from django.test import SimpleTestCase, TestCase, override_settings

from .models import (
    Act, AgentExecution, Character, GenerationRun, Project, Scene,
    SceneCharacter, SceneGenerationRequest, SceneVariant, User, UserProfile,
)


class ModelStructureTests(SimpleTestCase):
    def test_all_erd_models_are_registered_with_bigint_primary_keys(self):
        expected = {
            User, UserProfile, Project, Act, Character, Scene, SceneCharacter,
            SceneGenerationRequest, GenerationRun, AgentExecution, SceneVariant,
        }
        self.assertEqual(set(apps.get_app_config('api').get_models()), expected)
        for model in expected:
            with self.subTest(model=model.__name__):
                self.assertIsInstance(model._meta.pk, models.BigAutoField)

    def test_erd_field_coverage(self):
        fields = {
            User: 'username email password is_active is_staff last_login created_at updated_at',
            UserProfile: 'user display_name avatar_url preferred_language writing_style_preferences llm_preferences created_at updated_at',
            Project: 'user title logline synopsis genre target_audience screenplay_format status metadata created_at updated_at',
            Act: 'project title act_number sort_order summary metadata created_at updated_at',
            Character: 'project name role age psychological_profile appearance backstory goals fears voice_profile memory_metadata created_at updated_at',
            Scene: 'project act scene_number sort_order title location_heading time_of_day content_text ai_metadata editor_metadata created_at updated_at',
            SceneCharacter: 'scene character presence_type notes created_at',
            SceneGenerationRequest: 'scene user_prompt system_prompt context_snapshot model_name generation_parameters created_at',
            GenerationRun: 'request status langgraph_thread_id started_at finished_at total_duration_ms error_message run_metadata created_at updated_at',
            AgentExecution: 'run agent_name node_name status started_at finished_at duration_ms input_payload output_payload logs error_message created_at',
            SceneVariant: 'run scene variant_number title generated_full_text critic_score critic_feedback critic_metadata is_selected created_at',
        }
        for model, expected in fields.items():
            with self.subTest(model=model.__name__):
                actual = {field.name for field in model._meta.fields}
                self.assertTrue(set(expected.split()) <= actual)

    def test_json_defaults_are_empty_and_independent(self):
        count = 0
        for model in apps.get_app_config('api').get_models():
            first, second = model(), model()
            for field in model._meta.fields:
                if not isinstance(field, models.JSONField):
                    continue
                count += 1
                with self.subTest(model=model.__name__, field=field.name):
                    self.assertIs(field.default, dict)
                    self.assertEqual(getattr(first, field.name), {})
                    getattr(first, field.name)['test'] = True
                    self.assertEqual(getattr(second, field.name), {})
        self.assertEqual(count, 15)

    def test_json_fields_map_to_postgresql_jsonb_without_connecting(self):
        postgres = DatabaseWrapper({'ENGINE': 'django.db.backends.postgresql', 'NAME': 'schema_probe'})
        for model in apps.get_app_config('api').get_models():
            for field in model._meta.fields:
                if isinstance(field, models.JSONField):
                    self.assertEqual(field.db_type(postgres), 'jsonb')
        self.assertIsNone(postgres.connection)

    def test_user_uses_django_password_hashing_and_erd_column(self):
        self.assertEqual(settings.AUTH_USER_MODEL, 'api.User')
        self.assertIs(get_user_model(), User)
        self.assertTrue(User._meta.get_field('email').unique)
        self.assertEqual(User._meta.get_field('password').column, 'password_hash')
        user = User(username='writer', email='writer@example.com')
        user.set_password('A-test-password-123!')
        self.assertNotEqual(user.password, 'A-test-password-123!')
        self.assertTrue(user.check_password('A-test-password-123!'))
        self.assertFalse(user.check_password('wrong-password'))

    @override_settings(MIGRATION_MODULES={})
    def test_initial_migration_matches_models_and_serializes(self):
        loader = MigrationLoader(None, ignore_no_migrations=True)
        detector = MigrationAutodetector(loader.project_state(), ProjectState.from_apps(apps))
        changes = detector.changes(graph=loader.graph)
        self.assertNotIn('api', changes)
        migration = loader.disk_migrations[('api', '0001_initial')]
        created = {operation.name for operation in migration.operations if isinstance(operation, CreateModel)}
        self.assertEqual(len(created), 11)
        self.assertIn('User', created)
        serialized = MigrationWriter(migration).as_string()
        self.assertIn('editor_metadata', serialized)
        self.assertIn('password_hash', serialized)
        self.assertIn('default=dict', serialized)


class ERDRelationshipTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username='writer', email='writer@example.com')
        cls.project = Project.objects.create(user=cls.user, title='Main project')
        cls.act = Act.objects.create(project=cls.project, act_number=1)
        cls.scene = Scene.objects.create(project=cls.project, act=cls.act, scene_number=1)
        cls.other_scene = Scene.objects.create(project=cls.project, act=cls.act, scene_number=2)
        cls.character = Character.objects.create(project=cls.project, name='ANNA')
        cls.other_project = Project.objects.create(user=cls.user, title='Other project')
        cls.other_act = Act.objects.create(project=cls.other_project, act_number=1)
        cls.other_character = Character.objects.create(project=cls.other_project, name='MAREK')
        cls.request = SceneGenerationRequest.objects.create(scene=cls.scene, user_prompt='Write a quiet scene.')
        cls.generation_run = GenerationRun.objects.create(request=cls.request)

    def assert_integrity_error(self, operation):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                operation()

    def test_profile_is_one_to_one(self):
        profile = UserProfile.objects.create(user=self.user, display_name='Writer')
        self.assertEqual(self.user.profile, profile)
        self.assert_integrity_error(lambda: UserProfile.objects.create(user=self.user))

    def test_email_and_username_are_unique(self):
        self.assert_integrity_error(lambda: User.objects.create_user(username='writer', email='new@example.com'))
        self.assert_integrity_error(lambda: User.objects.create_user(username='another', email='writer@example.com'))

    def test_act_numbers_are_unique_within_project(self):
        self.assert_integrity_error(lambda: Act.objects.create(project=self.project, act_number=1))
        self.assertEqual(self.other_act.act_number, self.act.act_number)

    def test_scene_numbers_are_unique_within_project(self):
        self.assert_integrity_error(lambda: Scene.objects.create(project=self.project, act=self.act, scene_number=1))
        other = Scene.objects.create(project=self.other_project, act=self.other_act, scene_number=1)
        self.assertEqual(other.scene_number, self.scene.scene_number)

    def test_zero_numbers_are_rejected_by_database(self):
        self.assert_integrity_error(lambda: Act.objects.create(project=self.project, act_number=0))
        self.assert_integrity_error(lambda: Scene.objects.create(project=self.project, act=self.act, scene_number=0))
        self.assert_integrity_error(lambda: SceneVariant.objects.create(run=self.generation_run, scene=self.scene, variant_number=0, generated_full_text='Text'))

    def test_cast_has_unique_pair_and_many_to_many_access(self):
        member = SceneCharacter.objects.create(scene=self.scene, character=self.character, presence_type='voice_over', notes='Phone call')
        self.assertEqual(list(self.scene.characters.all()), [self.character])
        self.assertEqual(list(self.character.scenes.all()), [self.scene])
        self.assertEqual(self.scene.cast_members.get(), member)
        self.assert_integrity_error(lambda: SceneCharacter.objects.create(scene=self.scene, character=self.character))

    def test_scene_cannot_validate_with_act_from_another_project(self):
        scene = Scene(project=self.project, act=self.other_act, scene_number=3)
        with self.assertRaises(ValidationError) as error:
            scene.full_clean()
        self.assertIn('act', error.exception.message_dict)

    def test_cast_cannot_validate_with_character_from_another_project(self):
        member = SceneCharacter(scene=self.scene, character=self.other_character)
        with self.assertRaises(ValidationError) as error:
            member.full_clean()
        self.assertIn('character', error.exception.message_dict)

    def test_invalid_foreign_keys_raise_validation_errors(self):
        scene = Scene(project=self.project, act_id=999999, scene_number=3)
        with self.assertRaises(ValidationError):
            scene.full_clean()
        member = SceneCharacter(scene=self.scene, character_id=999999)
        with self.assertRaises(ValidationError):
            member.full_clean()
        variant = SceneVariant(run_id=999999, scene=self.scene, variant_number=1, generated_full_text='Text')
        with self.assertRaises(ValidationError):
            variant.full_clean()

    def test_generation_request_has_one_run(self):
        self.assertEqual(self.request.run, self.generation_run)
        self.assert_integrity_error(lambda: GenerationRun.objects.create(request=self.request))

    def test_variant_numbers_are_unique_within_run(self):
        variant = SceneVariant.objects.create(run=self.generation_run, scene=self.scene, variant_number=1, generated_full_text='A scene.', critic_score=Decimal('8.75'))
        variant.refresh_from_db()
        self.assertEqual(variant.critic_score, Decimal('8.75'))
        self.assert_integrity_error(lambda: SceneVariant.objects.create(run=self.generation_run, scene=self.scene, variant_number=1, generated_full_text='Other text'))

    def test_variant_must_match_request_scene(self):
        variant = SceneVariant(run=self.generation_run, scene=self.other_scene, variant_number=1, generated_full_text='Wrong scene.')
        with self.assertRaises(ValidationError) as error:
            variant.full_clean()
        self.assertIn('scene', error.exception.message_dict)

    def test_json_metadata_round_trip(self):
        self.scene.ai_metadata = {'context': {'cast': ['ANNA']}, 'version': 1}
        self.scene.editor_metadata = {'blocks': [{'type': 'action', 'text': 'Anna waits.'}], 'zoom': 100}
        self.scene.save()
        self.scene.refresh_from_db()
        self.assertEqual(self.scene.ai_metadata['context']['cast'], ['ANNA'])
        self.assertEqual(self.scene.editor_metadata['blocks'][0]['text'], 'Anna waits.')

    def test_pending_generation_fields_allow_missing_execution_data(self):
        execution = AgentExecution.objects.create(run=self.generation_run, agent_name='Writer')
        self.assertEqual(execution.status, 'pending')
        self.assertIsNone(execution.started_at)
        self.assertIsNone(execution.duration_ms)
        self.assertEqual(execution.logs, {})
        self.assertIsNone(self.generation_run.total_duration_ms)

    def test_deleting_character_keeps_scene_content(self):
        SceneCharacter.objects.create(scene=self.scene, character=self.character)
        self.character.delete()
        self.assertFalse(SceneCharacter.objects.filter(scene=self.scene).exists())
        self.assertTrue(Scene.objects.filter(pk=self.scene.pk).exists())

    def test_deleting_act_cascades_scene_generation_history(self):
        AgentExecution.objects.create(run=self.generation_run, agent_name='Writer')
        SceneVariant.objects.create(run=self.generation_run, scene=self.scene, variant_number=1, generated_full_text='Text')
        self.act.delete()
        self.assertFalse(Scene.objects.filter(project=self.project).exists())
        self.assertFalse(SceneGenerationRequest.objects.exists())
        self.assertFalse(GenerationRun.objects.exists())
        self.assertFalse(AgentExecution.objects.exists())
        self.assertFalse(SceneVariant.objects.exists())
        self.assertTrue(Character.objects.filter(pk=self.character.pk).exists())

    def test_timestamps_and_request_history_order(self):
        self.assertIsNotNone(self.scene.created_at)
        self.assertIsNotNone(self.scene.updated_at)
        request = SceneGenerationRequest.objects.create(scene=self.scene, user_prompt='Another attempt.')
        self.assertEqual(list(self.scene.generation_requests.all()), [request, self.request])


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
