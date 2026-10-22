from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class User(AbstractUser):
    email = models.EmailField(unique=True)
    # Keep Django's password API while matching the ERD's database column.
    password = models.CharField(max_length=128, db_column='password_hash')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class UserProfile(TimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile',
    )
    display_name = models.CharField(max_length=150, blank=True)
    avatar_url = models.TextField(blank=True)
    preferred_language = models.CharField(max_length=10, default='pl')
    writing_style_preferences = models.JSONField(default=dict, blank=True)
    llm_preferences = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.display_name or f'Profile for user {self.user_id}'


class Project(TimeStampedModel):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='projects',
    )
    title = models.CharField(max_length=255)
    logline = models.TextField(blank=True)
    synopsis = models.TextField(blank=True)
    genre = models.CharField(max_length=100, blank=True)
    target_audience = models.CharField(max_length=255, blank=True)
    screenplay_format = models.CharField(max_length=32, default='fountain')
    status = models.CharField(max_length=32, default='draft')
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-updated_at', '-pk']

    def __str__(self):
        return self.title


class Act(TimeStampedModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='acts')
    title = models.CharField(max_length=255, blank=True)
    act_number = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    sort_order = models.PositiveIntegerField(default=0)
    summary = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['sort_order', 'act_number', 'pk']
        constraints = [
            models.UniqueConstraint(fields=['project', 'act_number'], name='unique_project_act_number'),
            models.CheckConstraint(condition=models.Q(act_number__gte=1), name='act_number_gte_1'),
        ]

    def __str__(self):
        return f'Act {self.act_number}: {self.title}'


class Character(TimeStampedModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='characters')
    name = models.CharField(max_length=150)
    role = models.CharField(max_length=255, blank=True)
    age = models.PositiveIntegerField(null=True, blank=True)
    psychological_profile = models.TextField(blank=True)
    appearance = models.TextField(blank=True)
    backstory = models.TextField(blank=True)
    goals = models.TextField(blank=True)
    fears = models.TextField(blank=True)
    voice_profile = models.JSONField(default=dict, blank=True)
    memory_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['name', 'pk']

    def __str__(self):
        return self.name


class Scene(TimeStampedModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='scenes')
    act = models.ForeignKey(Act, on_delete=models.CASCADE, related_name='scenes')
    scene_number = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    sort_order = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=255, blank=True)
    location_heading = models.CharField(max_length=255, blank=True)
    time_of_day = models.CharField(max_length=50, blank=True)
    content_text = models.TextField(blank=True)
    ai_metadata = models.JSONField(default=dict, blank=True)
    editor_metadata = models.JSONField(default=dict, blank=True)
    characters = models.ManyToManyField(
        Character, through='SceneCharacter', related_name='scenes', blank=True,
    )

    class Meta:
        ordering = ['sort_order', 'scene_number', 'pk']
        constraints = [
            models.UniqueConstraint(fields=['project', 'scene_number'], name='unique_project_scene_number'),
            models.CheckConstraint(condition=models.Q(scene_number__gte=1), name='scene_number_gte_1'),
        ]

    def clean(self):
        super().clean()
        if not self.act_id or not self.project_id:
            return
        try:
            act = self.act
        except Act.DoesNotExist:
            return
        if act.project_id != self.project_id:
            raise ValidationError({'act': 'The act must belong to the same project as the scene.'})

    def __str__(self):
        return f'Scene {self.scene_number}: {self.title}'


class SceneCharacter(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name='cast_members')
    character = models.ForeignKey(Character, on_delete=models.CASCADE, related_name='scene_appearances')
    presence_type = models.CharField(max_length=50, default='on_screen')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['scene', 'character'], name='unique_scene_character'),
        ]

    def clean(self):
        super().clean()
        if not self.scene_id or not self.character_id:
            return
        try:
            scene, character = self.scene, self.character
        except (Scene.DoesNotExist, Character.DoesNotExist):
            return
        if scene.project_id != character.project_id:
            raise ValidationError({'character': 'The character must belong to the scene project.'})

    def __str__(self):
        return f'Scene {self.scene_id}, character {self.character_id}'


class SceneGenerationRequest(models.Model):
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name='generation_requests')
    user_prompt = models.TextField()
    system_prompt = models.TextField(blank=True)
    context_snapshot = models.JSONField(default=dict, blank=True)
    model_name = models.CharField(max_length=255, default='Bielik 11B')
    generation_parameters = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['scene', '-created_at'], name='request_scene_created_idx')]

    def __str__(self):
        return f'Request {self.pk} for scene {self.scene_id}'


class GenerationRun(TimeStampedModel):
    request = models.OneToOneField(
        SceneGenerationRequest, on_delete=models.CASCADE, related_name='run',
    )
    status = models.CharField(max_length=32, default='pending')
    langgraph_thread_id = models.CharField(max_length=255, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    total_duration_ms = models.PositiveBigIntegerField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    run_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at', '-pk']

    def __str__(self):
        return f'Run {self.pk}: {self.status}'


class AgentExecution(models.Model):
    run = models.ForeignKey(GenerationRun, on_delete=models.CASCADE, related_name='agent_executions')
    agent_name = models.CharField(max_length=100)
    node_name = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=32, default='pending')
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveBigIntegerField(null=True, blank=True)
    input_payload = models.JSONField(default=dict, blank=True)
    output_payload = models.JSONField(default=dict, blank=True)
    logs = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'pk']

    def __str__(self):
        return f'{self.agent_name}: {self.status}'


class SceneVariant(models.Model):
    run = models.ForeignKey(GenerationRun, on_delete=models.CASCADE, related_name='variants')
    scene = models.ForeignKey(Scene, on_delete=models.CASCADE, related_name='variants')
    variant_number = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    title = models.CharField(max_length=255, blank=True)
    generated_full_text = models.TextField()
    critic_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    critic_feedback = models.TextField(blank=True)
    critic_metadata = models.JSONField(default=dict, blank=True)
    is_selected = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['variant_number', 'pk']
        constraints = [
            models.UniqueConstraint(fields=['run', 'variant_number'], name='unique_run_variant_number'),
            models.CheckConstraint(condition=models.Q(variant_number__gte=1), name='variant_number_gte_1'),
        ]

    def clean(self):
        super().clean()
        if not self.run_id or not self.scene_id:
            return
        try:
            request_scene_id = self.run.request.scene_id
        except (GenerationRun.DoesNotExist, SceneGenerationRequest.DoesNotExist):
            return
        if request_scene_id != self.scene_id:
            raise ValidationError({'scene': 'The variant must belong to the generation request scene.'})

    def __str__(self):
        return f'Variant {self.variant_number} for scene {self.scene_id}'
