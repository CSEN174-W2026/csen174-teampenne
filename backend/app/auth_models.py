from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class UserPublic(BaseModel):
    id: str
    email: str
    full_name: str
    is_admin: bool
    is_active: bool
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


class LoginRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=6)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class UserListResponse(BaseModel):
    rows: List[UserPublic]


class CreateUserRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    full_name: str = ""
    is_admin: bool = False
    is_active: bool = True


class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)
    full_name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None


class ApiMessage(BaseModel):
    ok: bool = True
    message: str = ""
