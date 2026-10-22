from django.contrib import admin

# Register your models here.
from django.contrib import admin
from django.apps import apps

models = apps.get_app_config('api').get_models()
for model in models:
    try:
        admin.site.register(model)
    except admin.sites.AlreadyRegistered:
        pass