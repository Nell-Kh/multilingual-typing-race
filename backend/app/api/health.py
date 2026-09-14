from typing import Literal

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

router = APIRouter()

CheckResult = Literal["ok", "error"]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    checks: dict[str, CheckResult]


async def check_db(engine: AsyncEngine) -> CheckResult:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "error"


async def check_redis(client: Redis) -> CheckResult:
    try:
        pong = await client.ping()
        return "ok" if pong else "error"
    except Exception:
        return "error"


@router.get("/healthz", response_model=HealthResponse)
async def healthz(request: Request, response: Response) -> HealthResponse:
    checks: dict[str, CheckResult] = {
        "db": await check_db(request.app.state.engine),
        "redis": await check_redis(request.app.state.redis),
    }
    healthy = all(v == "ok" for v in checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(status="ok" if healthy else "degraded", checks=checks)
