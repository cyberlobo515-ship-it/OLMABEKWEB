import os
import re
import json
import base64
from datetime import date
from typing import List, Optional, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from google import genai
from google.genai import types

# ===== SOZLAMALAR =====
# Render.com Environment Variables bo'limiga GEMINI_API_KEY ni qo'shing
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
CHAT_MODEL = os.environ.get("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
CODE_PRO_MODEL = os.environ.get("GEMINI_CODE_MODEL", "gemini-2.5-pro")
IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "imagen-3.0-generate-002")

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

app = FastAPI(title="Olmabek AI Backend")

# CORS sozlamalari (Frontend ulanishi uchun)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== TARIF LIMITLARI =====
# Kunlik Olmabek Code token limitlari (website bilan 100% mos)
CODE_TOKEN_LIMITS: Dict[str, int] = {
    "standard": 25_000,     # Oddiy: 25 000 token / kun
    "pro": 250_000,         # Pro: 250 000 token / kun (10x ko'p)
    "ultra": 2_000_000,     # Ultra: 2 000 000 token / kun (80x ko'p)
}

# /api/build-site uchun alohida loyiha soni limiti
SITE_LIMITS: Dict[str, int] = {
    "standard": 4,
    "pro": 25,
    "ultra": 999_999,
}

# Kunlik foydalanishni xotirada saqlash
# Format: { "user_id": {"day": "2026-11-17", "tokens_used": 0, "sites_used": 0} }
usage_db: Dict[str, dict] = {}


# ===== MA'LUMOT MODELLARI =====
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    mode: Optional[str] = "chat"
    plan: Optional[str] = "standard"
    deep: Optional[bool] = False
    stack: Optional[str] = "auto"
    currentCode: Optional[str] = ""
    user_id: Optional[str] = "guest"
    is_admin: Optional[bool] = False
    plain_stream: Optional[bool] = False


class ImageRequest(BaseModel):
    prompt: str


class SiteBuildRequest(BaseModel):
    prompt: str
    current_code: Optional[str] = ""
    plan: Optional[str] = "standard"
    user_id: Optional[str] = "guest"
    is_admin: Optional[bool] = False


# ===== YORDAMCHI FUNKSIYALAR =====
def get_today() -> str:
    return date.today().isoformat()


def get_or_reset_record(user_id: str) -> dict:
    today_str = get_today()
    record = usage_db.get(user_id)
    if not record or record.get("day") != today_str:
        record = {"day": today_str, "tokens_used": 0, "sites_used": 0}
        usage_db[user_id] = record
    return record


def get_code_tokens_left(user_id: str, plan: str, is_admin: bool) -> int:
    if is_admin:
        return CODE_TOKEN_LIMITS["ultra"]
    tier = plan if plan in CODE_TOKEN_LIMITS else "standard"
    limit = CODE_TOKEN_LIMITS[tier]
    record = get_or_reset_record(user_id)
    return max(0, limit - record["tokens_used"])


def consume_code_tokens(user_id: str, plan: str, is_admin: bool, tokens: int) -> int:
    if is_admin:
        return CODE_TOKEN_LIMITS["ultra"]
    tier = plan if plan in CODE_TOKEN_LIMITS else "standard"
    limit = CODE_TOKEN_LIMITS[tier]
    record = get_or_reset_record(user_id)
    record["tokens_used"] += max(0, tokens)
    return max(0, limit - record["tokens_used"])


def check_and_increment_site_limit(user_id: str, plan: str, is_admin: bool) -> dict:
    if is_admin or plan == "ultra":
        return {"allowed": True, "left": 999_999}

    tier = plan if plan in SITE_LIMITS else "standard"
    max_limit = SITE_LIMITS[tier]
    record = get_or_reset_record(user_id)

    if record["sites_used"] >= max_limit:
        return {"allowed": False, "left": 0, "limit": max_limit}

    record["sites_used"] += 1
    return {"allowed": True, "left": max_limit - record["sites_used"], "limit": max_limit}


def build_gemini_contents(
    history: List[ChatMessage],
    new_message: str,
    current_code: Optional[str] = None,
):
    contents = []
    for m in (history or [])[-16:]:
        if not m.content or not m.content.strip():
            continue
        role = "model" if m.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=m.content)]))

    final_prompt = new_message
    if current_code and current_code.strip():
        final_prompt = (
            f"Hozirgi mavjud kod konteksti:\n```\n{current_code[:18000]}\n```\n\n"
            f"Foydalanuvchi talabi:\n{new_message}"
        )
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=final_prompt)]))
    return contents


def clean_html_output(raw_text: str) -> str:
    """Gemini qaytargan matndan ```html va ``` teglarini tozalab toza HTML qaytaradi."""
    text = (raw_text or "").strip()
    fence = re.search(r"```(?:html|htm)?\s*\n([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        return fence.group(1).strip()
    doc = re.search(r"(<!DOCTYPE\s+html[\s\S]*<\/html>)", text, re.IGNORECASE)
    if doc:
        return doc.group(1).strip()
    if text.startswith("```html"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def get_code_system_instruction(plan: str, stack: str) -> str:
    if stack == "react":
        stack_guidance = (
            "Foydalanuvchi React JSX/TSX komponentini xohlaydi. Komponentni to'liq yozing "
            "(default export App bo'lsin, Tailwind CSS ishlatilsin, inline SVG yoki toza CSS ishlating)."
        )
    elif stack == "python":
        stack_guidance = (
            "Foydalanuvchi Python kodini xohlaydi. Toza, tipizatsiyalangan, izohli va "
            "ishga tushirishga tayyor ```python``` kodi yozing."
        )
    else:
        stack_guidance = (
            "Veb-ilova, sahifa, o'yin yoki UI so'ralganda DOIM bitta to'liq, mustaqil ishlaydigan "
            "```html``` fayli (`<!DOCTYPE html>...`) ko'rinishida yozing (Tailwind CDN, ichki "
            "`<style>` va `<script>` bilan). Shunda Preview oynasida darhol mukammal ishlaydi!"
        )

    if plan == "ultra":
        tier_depth = (
            "Siz ULTRA darajadagi Senior Principal Architect rejimidasiz: maksimal sifat, "
            "mukammal responsive layout, mikro-animatsiyalar, boy interaktiv holatlar va xatosiz arxitektura yarating."
        )
    elif plan == "pro":
        tier_depth = (
            "Siz PRO darajadagi Senior Full-Stack dasturchisiz: to'liq funksional, zamonaviy va "
            "estetik jihatdan yuqori saviyali kod yozing."
        )
    else:
        tier_depth = "Siz Standart yordamchisiz: aniq, ixcham va to'g'ri ishlaydigan kod yozing."

    return "\n\n".join([
        "Siz OLMABEK CODE — OLMABEK AI platformasining Google AI Studio asosidagi professional dasturlash muharririsiz.",
        tier_depth,
        stack_guidance,
        "Javobni o'zbek tilida 1-2 qisqa gap bilan boshlang, so'ng to'liq kodni bitta asosiy fenced kod blokida (masalan ```html ... ``` yoki ```python ... ```) taqdim eting.",
        "Kodni hech qachon '...' deb qisqartirmang — har bir funksional qism to'liq yozilsin.",
    ])


def get_chat_system_instruction(plan: str, deep: bool) -> str:
    if plan == "ultra" and deep:
        depth = "Murakkab savollarni chuqur, bosqichma-bosqich, misollar va aniq xulosalar bilan tahlil qilib bering."
    elif plan == "pro":
        depth = "Aniq, tezkor, tizimli va foydali javoblar bering."
    else:
        depth = "Lo'nda, tushunarli va samimiy o'zbek tilida javob bering."
    return (
        f"Siz OLMABEK AI — o'zbek tilida mukammal fikrlaydigan sun'iy intellekt yordamchisiz. {depth} "
        "Zarur bo'lganda markdown sarlavhalar, ro'yxatlar va kod bloklaridan foydalaning."
    )


def select_model(plan: str, is_code: bool) -> str:
    if is_code and plan in ("pro", "ultra"):
        return CODE_PRO_MODEL
    if plan == "ultra":
        return CODE_PRO_MODEL
    return CHAT_MODEL


def sse_line(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def require_client() -> genai.Client:
    if not GEMINI_API_KEY or client is None:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan")
    return client


# ===== ASOSIY ENDPOINTLAR =====

@app.get("/")
@app.get("/api/health")
def health_check():
    return {
        "ok": True,
        "status": "ok",
        "service": "Olmabek AI Server",
        "model": CHAT_MODEL,
        "codeProModel": CODE_PRO_MODEL,
        "geminiConfigured": bool(GEMINI_API_KEY),
    }


@app.get("/api/limits")
def get_limits(user_id: str = "guest", plan: str = "standard", is_admin: bool = False):
    tier = plan if plan in CODE_TOKEN_LIMITS else "standard"
    record = get_or_reset_record(user_id)
    tokens_left = get_code_tokens_left(user_id, tier, is_admin)
    sites_left = 999_999 if (is_admin or tier == "ultra") else max(0, SITE_LIMITS[tier] - record["sites_used"])
    return {
        "plan": tier,
        "codeTokensLeft": tokens_left,
        "codeTokensLimit": CODE_TOKEN_LIMITS[tier],
        "sitesLeft": sites_left,
        "sitesLimit": SITE_LIMITS[tier],
    }


# 1. CHAT VA OLMABEK CODE (SYNC JSON)
@app.post("/api/chat")
@app.post("/api/code")
async def generate_sync_endpoint(req: ChatRequest):
    ai = require_client()
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Xabar matni bo'sh")

    plan = req.plan or "standard"
    user_id = req.user_id or "guest"
    is_admin = bool(req.is_admin)
    is_code = req.mode == "code"

    if is_code and not is_admin:
        left = get_code_tokens_left(user_id, plan, is_admin)
        if left <= 0:
            raise HTTPException(
                status_code=429,
                detail="Kunlik Olmabek Code token limiti tugadi. Pro yoki Ultra tarifiga o'ting.",
            )

    sys_prompt = (
        get_code_system_instruction(plan, req.stack or "auto")
        if is_code
        else get_chat_system_instruction(plan, bool(req.deep))
    )
    contents = build_gemini_contents(
        req.history or [],
        message,
        req.currentCode if is_code else None,
    )
    model_name = select_model(plan, is_code)

    try:
        response = ai.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=sys_prompt,
                temperature=0.5 if is_code else 0.7,
            ),
        )
        reply = response.text or "Javob bo'sh qaytdi."
        um = getattr(response, "usage_metadata", None)
        prompt_tokens = (getattr(um, "prompt_token_count", 0) or 0) if um else 0
        output_tokens = (getattr(um, "candidates_token_count", 0) or 0) if um else 0
        total_tokens = (getattr(um, "total_token_count", 0) or 0) if um else 0
        if not total_tokens:
            output_tokens = max(1, int(len(reply) / 3.5))
            prompt_tokens = max(1, int(len(message) / 4))
            total_tokens = prompt_tokens + output_tokens

        tokens_left = (
            consume_code_tokens(user_id, plan, is_admin, total_tokens)
            if is_code
            else get_code_tokens_left(user_id, plan, is_admin)
        )

        return {
            "reply": reply,
            "usage": {
                "promptTokens": prompt_tokens,
                "outputTokens": output_tokens,
                "totalTokens": total_tokens,
                "tokensLeft": tokens_left,
                "model": model_name,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 2. OQIMLI CHAT VA OLMABEK CODE (/api/chat/stream, /api/code/stream)
def stream_handler(req: ChatRequest, force_code: bool = False):
    ai = require_client()
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Xabar matni bo'sh")

    plan = req.plan or "standard"
    user_id = req.user_id or "guest"
    is_admin = bool(req.is_admin)
    is_code = force_code or req.mode == "code"

    if is_code and not is_admin:
        left = get_code_tokens_left(user_id, plan, is_admin)
        if left <= 0:
            raise HTTPException(
                status_code=429,
                detail="Kunlik Olmabek Code token limiti tugadi. Pro yoki Ultra tarifiga o'ting.",
            )

    sys_prompt = (
        get_code_system_instruction(plan, req.stack or "auto")
        if is_code
        else get_chat_system_instruction(plan, bool(req.deep))
    )
    contents = build_gemini_contents(
        req.history or [],
        message,
        req.currentCode if is_code else None,
    )
    model_name = select_model(plan, is_code)

    def event_generator():
        prompt_tokens = 0
        output_tokens = 0
        total_tokens = 0
        char_count = 0

        try:
            response = ai.models.generate_content_stream(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    temperature=0.5 if is_code else 0.7,
                ),
            )
            for chunk in response:
                text = getattr(chunk, "text", None) or ""
                if text:
                    char_count += len(text)
                    yield text if req.plain_stream else sse_line({"type": "chunk", "text": text})

                um = getattr(chunk, "usage_metadata", None)
                if um:
                    prompt_tokens = getattr(um, "prompt_token_count", None) or prompt_tokens
                    output_tokens = getattr(um, "candidates_token_count", None) or output_tokens
                    total_tokens = (
                        getattr(um, "total_token_count", None)
                        or (prompt_tokens + output_tokens)
                        or total_tokens
                    )

            if not total_tokens and char_count > 0:
                output_tokens = max(1, int(char_count / 3.5))
                prompt_tokens = max(1, int(len(message) / 4))
                total_tokens = prompt_tokens + output_tokens

            tokens_left = (
                consume_code_tokens(user_id, plan, is_admin, total_tokens)
                if is_code
                else get_code_tokens_left(user_id, plan, is_admin)
            )

            if not req.plain_stream:
                yield sse_line({
                    "type": "usage",
                    "promptTokens": prompt_tokens,
                    "outputTokens": output_tokens,
                    "totalTokens": total_tokens,
                    "tokensLeft": tokens_left,
                    "model": model_name,
                })
                yield sse_line({"type": "done"})
        except Exception as e:
            if req.plain_stream:
                yield f"\n⚠️ Xatolik: {str(e)}"
            else:
                yield sse_line({"type": "error", "error": str(e)})

    media = "text/plain; charset=utf-8" if req.plain_stream else "text/event-stream; charset=utf-8"
    return StreamingResponse(
        event_generator(),
        media_type=media,
        headers={"Cache-Control": "no-cache, no-transform"},
    )


@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    return stream_handler(req, force_code=False)


@app.post("/api/code/stream")
async def code_stream_endpoint(req: ChatRequest):
    return stream_handler(req, force_code=True)


# 3. RASM GENERATSIYASI (/api/image)
@app.post("/api/image")
async def image_endpoint(req: ImageRequest):
    ai = require_client()
    try:
        result = ai.models.generate_images(
            model=IMAGE_MODEL,
            prompt=req.prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/png",
                aspect_ratio="1:1",
            ),
        )
        if not result.generated_images:
            raise HTTPException(status_code=500, detail="Rasm generatsiya qilinmadi")

        img_bytes = result.generated_images[0].image.image_bytes
        b64_str = base64.b64encode(img_bytes).decode("utf-8")
        return {"image": b64_str}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 4. VEB-SAYT YARATISH VA TAHRIRLASH (/api/build-site)
@app.post("/api/build-site")
async def build_site_endpoint(req: SiteBuildRequest):
    ai = require_client()

    plan = req.plan or "standard"
    user_id = req.user_id or "guest"
    is_admin = bool(req.is_admin)

    limit_info = check_and_increment_site_limit(
        user_id=user_id,
        plan=plan,
        is_admin=is_admin,
    )
    if not limit_info["allowed"]:
        raise HTTPException(
            status_code=429,
            detail=f"Kunlik veb-sayt yaratish limiti tugadi ({limit_info['limit']} ta). Pro yoki Ultra tarifiga o'ting.",
        )

    is_premium = plan in ("pro", "ultra") or is_admin
    model_name = CODE_PRO_MODEL if plan == "ultra" else CHAT_MODEL

    tier_instruction = (
        "Zamonaviy, animatsiyali, mukammal responsive dizayn, interaktiv JavaScript funksiyalari va boy kontent bilan yarat."
        if is_premium
        else "Toza, tushunarli, chiroyli va to'liq ishlaydigan oddiy veb-sahifa (HTML + CSS + JS) yarat."
    )

    system_instruction = f"""
Sen professional Frontend dasturchi va UI/UX dizaynersan.
Vazifang: Foydalanuvchi so'roviga ko'ra tayyor, yagona faylli (single-file) to'liq ishlaydigan veb-sayt kodini yozish.
Texnologiyalar: HTML5, CSS3 (<style> ichida) va Vanilla JavaScript (<script> ichida).
Talablar:
1. {tier_instruction}
2. Barcha CSS va JS kodlari bitta <!DOCTYPE html> hujjati ichida bo'lsin, shunda uni to'g'ridan-to'g'ri iframe (Preview) oynasida ochish mumkin bo'lsin.
3. Hech qanday tushuntirish matni yoki markdown (```html) yozma! Faqat toza HTML kodning o'zini qaytar.
4. Matnlar foydalanuvchi so'ragan tilda (asosan o'zbek tilida) bo'lsin.
"""

    if req.current_code and req.current_code.strip():
        user_prompt = (
            f"Quyidagi mavjud veb-sayt kodini foydalanuvchi talabiga moslab tahrirla va yangilangan to'liq kodni qaytar:\n\n"
            f"TALAB: {req.prompt}\n\n"
            f"MAVJUD KOD:\n{req.current_code}"
        )
    else:
        user_prompt = f"Quyidagi talab asosida yangi veb-sayt yarat:\n{req.prompt}"

    try:
        response = ai.models.generate_content(
            model=model_name,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.6,
            ),
        )
        html_code = clean_html_output(response.text or "")
        if not html_code:
            raise HTTPException(status_code=500, detail="Kod generatsiya qilinmadi")

        um = getattr(response, "usage_metadata", None)
        total_tokens = (getattr(um, "total_token_count", 0) or 0) if um else int(len(html_code) / 3.5)
        tokens_left = consume_code_tokens(user_id, plan, is_admin, total_tokens)

        return {
            "ready": True,
            "html": html_code,
            "sitesLeft": limit_info["left"],
            "tokensUsed": total_tokens,
            "tokensLeft": tokens_left,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
