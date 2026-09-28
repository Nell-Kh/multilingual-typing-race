"""Response headers that cost nothing and close off whole classes of attack (ADR-026).

This API answers with JSON and nothing else, so the headers are the strict ones:
never sniff a content type, never render in a frame, never leak the URL in a
referrer. HSTS is sent only in production, where TLS is terminated in front of
us — sending it from a local http server would pin a browser to https://localhost
for a year.

No Content-Security-Policy here. A CSP belongs on the origin that serves the
*pages* (nginx, in front of the built frontend); on this origin its only effect
would be to break the Swagger UI at /docs, which loads its assets from a CDN.
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

# One year, the minimum any preload list accepts.
HSTS = "max-age=31536000; includeSubDomains"

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), microphone=()",
}


def install_security_headers(app: FastAPI, *, hsts: bool) -> None:
    @app.middleware("http")
    async def _headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in HEADERS.items():
            # Never clobber a header a route set deliberately.
            response.headers.setdefault(name, value)
        if hsts:
            response.headers.setdefault("Strict-Transport-Security", HSTS)
        return response
