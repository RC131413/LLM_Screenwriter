"""Shared request validation and response envelopes for API routers."""

from datetime import datetime

from ninja import Schema
from pydantic import ConfigDict, field_validator, model_validator

from .security.input_validation import validate_data_tree


class InputSchema(Schema):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

    @model_validator(mode='before')
    @classmethod
    def bound_input(cls, data):
        validate_data_tree(data)
        return data

    @field_validator('username', 'identifier', 'title', 'name', 'dialogue_tone', mode='before', check_fields=False)
    @classmethod
    def trim_labels(cls, value):
        return value.strip() if isinstance(value, str) else value


class MessageOut(Schema):
    detail: str


class TimestampedOut(Schema):
    id: int
    created_at: datetime
    updated_at: datetime
