"""One error shape for the whole API: `{"error": {"code": ..., "message": ...}}`.

Clients can switch on `code` without parsing prose, and every failure — ours,
FastAPI's validation, an unknown route — looks the same.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Raise anywhere in a request; the handler below turns it into the JSON shape."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _payload(code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, **extra}}


_HTTP_CODES = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_payload(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_payload("validation_error", "Request failed validation", details=details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(code, str(exc.detail)),
            headers=dict(exc.headers or {}),
        )
