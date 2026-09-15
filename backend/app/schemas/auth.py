from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

# Long enough to matter, capped so nobody can DoS argon2 with a megabyte password.
PASSWORD_MIN, PASSWORD_MAX = 8, 128


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    display_name: str = Field(min_length=1, max_length=50)

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()

    @field_validator("display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("display_name must not be blank")
        return stripped


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=PASSWORD_MAX)

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()


class TokenResponse(BaseModel):
    """The access token goes in the body; the refresh token rides in an httpOnly cookie."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # seconds
