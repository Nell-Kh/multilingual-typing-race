from datetime import timedelta

from fastapi import APIRouter, Request, Response, status

from app.core.deps import (
    ClientIp,
    CurrentUser,
    RateLimiterDep,
    RedisDep,
    SessionDep,
    SettingsDep,
)
from app.core.errors import ApiError
from app.core.security import (
    InvalidTokenError,
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.settings import Settings
from app.models import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserOut
from app.services import refresh_tokens, users
from app.services.rate_limit import Allowance, Limit, RateLimiter

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"
# The cookie is only ever needed by these routes, so the browser sends it nowhere else.
REFRESH_COOKIE_PATH = "/api/v1/auth"

# Rate-limit buckets (ADR-022). Names are part of the Redis key, so don't rename
# them casually: counters written under the old name would be orphaned.
BUCKET_REGISTER_IP = "auth:register:ip"
BUCKET_LOGIN_IP = "auth:login:ip"
BUCKET_LOGIN_EMAIL = "auth:login:email"
BUCKET_REFRESH_IP = "auth:refresh:ip"


def _refuse(allowance: Allowance) -> None:
    """Turn a spent allowance into the API's error shape, with Retry-After."""
    raise ApiError(
        429,
        "rate_limited",
        "Too many attempts. Try again in a few minutes.",
        headers={"Retry-After": str(allowance.retry_after)},
    )


async def _spend(
    limiter: RateLimiter, settings: Settings, bucket: str, identity: str, times: int
) -> None:
    """Count one attempt and refuse if that put the caller over the ceiling."""
    if not settings.rate_limit_enabled:
        return
    allowance = await limiter.hit(
        bucket, identity, Limit(times, settings.rate_limit_window_seconds)
    )
    if not allowance.allowed:
        _refuse(allowance)


async def _issue_tokens(
    response: Response, redis: RedisDep, settings: Settings, user: User
) -> TokenResponse:
    """Access token in the body, refresh token in an httpOnly cookie, jti recorded in Redis."""
    access = create_access_token(user.id)
    refresh, claims = create_refresh_token(user.id)
    ttl = timedelta(days=settings.refresh_token_days)
    await refresh_tokens.store(redis, claims.jti, user.id, ttl)

    # Cross-site in prod (frontend and API are different hosts) needs SameSite=None + Secure.
    # Locally both are "localhost", so Lax works and Secure would break plain http.
    secure = settings.app_env == "prod"
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=int(ttl.total_seconds()),
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=secure,
        samesite="none" if secure else "lax",
    )
    return TokenResponse(access_token=access, expires_in=settings.access_token_minutes * 60)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    ip: ClientIp,
) -> TokenResponse:
    await _spend(limiter, settings, BUCKET_REGISTER_IP, ip, settings.rate_limit_register_per_ip)
    try:
        user = await users.create_user(
            session, email=body.email, password=body.password, display_name=body.display_name
        )
    except users.EmailTakenError as exc:
        raise ApiError(409, "email_taken", "An account with this email already exists") from exc
    return await _issue_tokens(response, redis, settings, user)


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    ip: ClientIp,
) -> TokenResponse:
    email = body.email.lower()
    await _spend(limiter, settings, BUCKET_LOGIN_IP, ip, settings.rate_limit_login_per_ip)

    # The per-email counter is *read* before the password is checked, so a guessing
    # run stops costing an argon2 verification once it is over the ceiling, and is
    # only *spent* by a failure: getting your own password right, however many
    # attempts in, is never what locks you out.
    email_limit = Limit(
        settings.rate_limit_login_failures_per_email, settings.rate_limit_window_seconds
    )
    if settings.rate_limit_enabled:
        allowance = await limiter.peek(BUCKET_LOGIN_EMAIL, email, email_limit)
        if not allowance.allowed:
            _refuse(allowance)

    user = await users.authenticate(session, email=body.email, password=body.password)
    if user is None:
        if settings.rate_limit_enabled:
            await limiter.hit(BUCKET_LOGIN_EMAIL, email, email_limit)
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect")

    if settings.rate_limit_enabled:
        await limiter.reset(BUCKET_LOGIN_EMAIL, email)
    return await _issue_tokens(response, redis, settings, user)


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    limiter: RateLimiterDep,
    ip: ClientIp,
) -> TokenResponse:
    await _spend(limiter, settings, BUCKET_REFRESH_IP, ip, settings.rate_limit_refresh_per_ip)
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw is None:
        raise ApiError(401, "unauthorized", "Missing refresh token")
    try:
        claims = decode_token(raw, TokenType.REFRESH)
    except InvalidTokenError as exc:
        raise ApiError(401, "unauthorized", "Invalid or expired refresh token") from exc

    # Rotation: the old token is spent whether or not we succeed below.
    owner = await refresh_tokens.consume(redis, claims.jti)
    if owner is None or owner != claims.sub:
        raise ApiError(401, "unauthorized", "Refresh token is no longer valid")
    user = await users.get_user(session, claims.sub)
    if user is None:
        raise ApiError(401, "unauthorized", "User no longer exists")
    return await _issue_tokens(response, redis, settings, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, redis: RedisDep) -> None:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw is not None:
        try:
            claims = decode_token(raw, TokenType.REFRESH)
            await refresh_tokens.revoke(redis, claims.jti)
        except InvalidTokenError:
            pass  # already useless; clearing the cookie is all that's left to do
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
