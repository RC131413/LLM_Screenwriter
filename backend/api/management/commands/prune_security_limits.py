from django.core.management.base import BaseCommand
from django.utils import timezone

from backend.api.models import RequestRateLimit


class Command(BaseCommand):
    help = 'Delete expired rate-limit counters; run daily in production.'

    def handle(self, *args, **options):
        count, _ = RequestRateLimit.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(f'Removed {count} expired rate-limit counters.')
