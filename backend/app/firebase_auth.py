from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import requests


class AuthError(Exception):
    pass


class UnauthorizedError(AuthError):
    pass


def _firebase_modules():
    try:
        import firebase_admin
        from firebase_admin import auth

        return firebase_admin, auth
    except Exception as exc:
        raise AuthError("firebase-admin is not installed in this Python environment") from exc


def init_firebase_app() -> None:
    firebase_admin, _ = _firebase_modules()
    if firebase_admin._apps:
        return

    project_id = os.getenv("FIREBASE_PROJECT_ID")
    sa_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")

    options = {"projectId": project_id} if project_id else None
    if sa_json:
        from firebase_admin import credentials

        cred = credentials.Certificate(json.loads(sa_json))
        firebase_admin.initialize_app(cred, options=options)
        return

    if sa_path:
        from firebase_admin import credentials

        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred, options=options)
        return

    firebase_admin.initialize_app(options=options)


def _public_user(user: Any) -> Dict[str, Any]:
    claims = dict(user.custom_claims or {})
    meta = getattr(user, "user_metadata", None)
    return {
        "id": user.uid,
        "email": user.email or "",
        "full_name": user.display_name or "",
        "is_admin": bool(claims.get("admin", False)),
        "is_active": not bool(getattr(user, "disabled", False)),
        "created_at": getattr(meta, "creation_timestamp", None),
        "updated_at": getattr(meta, "last_sign_in_timestamp", None),
    }


def current_user_from_token(token: str) -> Dict[str, Any]:
    init_firebase_app()
    _, auth = _firebase_modules()
    try:
        decoded = auth.verify_id_token(token)
    except Exception as exc:
        raise UnauthorizedError("Invalid Firebase token") from exc

    uid = decoded.get("uid")
    if not uid:
        raise UnauthorizedError("Invalid Firebase token payload")
    try:
        user = auth.get_user(uid)
    except Exception as exc:
        raise UnauthorizedError("Firebase user not found") from exc
    return _public_user(user)


def login_with_email_password(email: str, password: str) -> Dict[str, Any]:
    api_key = os.getenv("FIREBASE_WEB_API_KEY")
    if not api_key:
        raise AuthError("FIREBASE_WEB_API_KEY is required for /auth/login")

    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
    payload = {"email": email.strip().lower(), "password": password, "returnSecureToken": True}
    try:
        resp = requests.post(url, json=payload, timeout=8)
        if resp.status_code >= 400:
            raise UnauthorizedError("Invalid credentials")
        data = resp.json()
    except UnauthorizedError:
        raise
    except Exception as exc:
        raise AuthError(f"Firebase sign-in failed: {exc}") from exc

    id_token = data.get("idToken")
    if not id_token:
        raise UnauthorizedError("Invalid Firebase token")
    user = current_user_from_token(id_token)
    return {"access_token": id_token, "token_type": "bearer", "user": user}


def list_users() -> List[Dict[str, Any]]:
    init_firebase_app()
    _, auth = _firebase_modules()
    out: List[Dict[str, Any]] = []
    page = auth.list_users()
    while page:
        out.extend(_public_user(u) for u in page.users)
        page = page.get_next_page()
    return out


def create_user(*, email: str, password: str, full_name: str, is_admin: bool, is_active: bool) -> Dict[str, Any]:
    init_firebase_app()
    _, auth = _firebase_modules()
    if len(password) < 6:
        raise AuthError("password must be at least 6 characters")
    try:
        user = auth.create_user(
            email=email.strip().lower(),
            password=password,
            display_name=full_name.strip() or None,
            disabled=not bool(is_active),
        )
        auth.set_custom_user_claims(user.uid, {"admin": bool(is_admin)})
        return _public_user(auth.get_user(user.uid))
    except Exception as exc:
        raise AuthError(str(exc)) from exc


def update_user(
    *,
    user_id: str,
    email: Optional[str] = None,
    password: Optional[str] = None,
    full_name: Optional[str] = None,
    is_admin: Optional[bool] = None,
    is_active: Optional[bool] = None,
) -> Dict[str, Any]:
    init_firebase_app()
    _, auth = _firebase_modules()
    kwargs: Dict[str, Any] = {}
    if email is not None:
        kwargs["email"] = email.strip().lower()
    if password is not None:
        if len(password) < 6:
            raise AuthError("password must be at least 6 characters")
        kwargs["password"] = password
    if full_name is not None:
        kwargs["display_name"] = full_name.strip() or None
    if is_active is not None:
        kwargs["disabled"] = not bool(is_active)
    try:
        if kwargs:
            auth.update_user(user_id, **kwargs)
        if is_admin is not None:
            current = auth.get_user(user_id)
            claims = dict(current.custom_claims or {})
            claims["admin"] = bool(is_admin)
            auth.set_custom_user_claims(user_id, claims)
        return _public_user(auth.get_user(user_id))
    except Exception as exc:
        raise AuthError(str(exc)) from exc


def deactivate_user(user_id: str) -> Dict[str, Any]:
    return update_user(user_id=user_id, is_active=False)


def ensure_bootstrap_admin() -> Optional[Dict[str, Any]]:
    admin_email = os.getenv("ADMIN_EMAIL")
    if not admin_email:
        return None
    init_firebase_app()
    _, auth = _firebase_modules()
    try:
        user = auth.get_user_by_email(admin_email.strip().lower())
        claims = dict(user.custom_claims or {})
        if not claims.get("admin", False):
            claims["admin"] = True
            auth.set_custom_user_claims(user.uid, claims)
        return _public_user(auth.get_user(user.uid))
    except Exception:
        return None
