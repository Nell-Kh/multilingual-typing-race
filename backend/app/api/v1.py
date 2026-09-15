"""Everything under /api/v1. New routers get included here."""

from fastapi import APIRouter

from app.api import auth

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
