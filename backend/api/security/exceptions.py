"""Failures reported by the shared security guards."""

import math


class RateLimitExceeded(Exception):
    def __init__(self, wait):
        self.wait = max(1, math.ceil(wait))
        super().__init__('Zbyt wiele zapytań. Spróbuj ponownie za chwilę.')


class SecurityStoreUnavailable(Exception):
    pass


class LLMCapacityExceeded(Exception):
    pass
