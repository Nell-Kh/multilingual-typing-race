"""Everything under /api/v1. New routers get included here."""

from fastapi import APIRouter

from app.api import admin_texts, auth, texts

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(texts.router)
router.include_router(admin_texts.router)
