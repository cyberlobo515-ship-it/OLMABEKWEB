import os
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
client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(title="Olmabek AI Backend")

# CORS sozlamalari (Frontend ulanishi uchun)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== TARIF LIMITLARI (Veb-sayt generatsiyasi uchun) =====
SITE_LIMITS = {
    "standard": 4,       # Oddiy tarif: kuniga 4 ta oddiy loyiha yoki tahrirlash
    "pro": 25,           # Pro tarif: kuniga 25 ta
    "ultra": 999999      # Ultra tarif: cheksiz
}

# Kunlik foydalanishni vaqtinchalik xotirada saqlash (Render qayta yonganda yangilanadi)
# Format: { "email_yoki_id": {"day": "2026-11-17", "sites_used": 1} }
usage_db: Dict[str, dict] = {}


# ===== MA'LUMOT MODELLARI =====
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    mode: Optional[str] = "fast"

class ImageRequest(BaseModel):
    prompt: str

class SiteBuildRequest(BaseModel):
    prompt: str
    current_code: Optional[str] = ""   # Agar mavjud saytni tahrirlash kerak bo'lsa
    plan: Optional[str] = "standard"   # standard | pro | ultra
    user_id: Optional[str] = "guest"   # Foydalanuvchi emaili yoki ID si
    is_admin: Optional[bool] = False


# ===== YORDAMCHI FUNKSIYALAR =====
def get_today() -> str:
    return date.today().isoformat()

def check_and_increment_site_limit(user_id: str, plan: str, is_admin: bool) -> dict:
    if is_admin or plan == "ultra":
        return {"allowed": True, "left": 999999}

    plan = plan if plan in SITE_LIMITS else "standard"
    max_limit = SITE_LIMITS[plan]
    today_str = get_today()

    record = usage_db.get(user_id)
    if not record or record["day"] != today_str:
        record = {"day": today_str, "sites_used": 0}
        usage_db[user_id] = record

    if record["sites_used"] >= max_limit:
        return {"allowed": False, "left": 0, "limit": max_limit}

    record["sites_used"] += 1
    return {"allowed": True, "left": max_limit - record["sites_used"], "limit": max_limit}

def build_gemini_contents(history: List[ChatMessage], new_message: str):
    contents = []
    for m in history[-20:]:
        role = "model" if m.role == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=m.content)]))
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=new_message)]))
    return contents

def clean_html_output(raw_text: str) -> str:
    """Gemini qaytargan matndan ```html va ``` teglarini tozalaydi"""
    text = raw_text.strip()
    if text.startswith("```html"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


# ===== ASOSIY ENDPOINTLAR =====

@app.get("/")
def health_check():
    return {"status": "ok", "service": "Olmabek AI Server"}


# 1. ODDIY CHAT (/api/chat)
@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan")
    try:
        sys_prompt = (
            "Sen Olmabek AI san — o'zbek tilida ravon, aniq va foydali javob beruvchi sun'iy intellektsan. "
            "Kod yozganda uni chiroyli markdown bloklarida ber."
        )
        contents = build_gemini_contents(req.history or [], req.message)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=sys_prompt,
                temperature=0.7,
            ),
        )
        return {"reply": response.text or "Javob bo'sh qaytdi."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 2. OQIMLI CHAT (/api/chat/stream)
@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan")

    sys_prompt = (
        "Sen Olmabek AI san — o'zbek tilida ravon, aniq va foydali javob beruvchi sun'iy intellektsan. "
        "Kod yozganda uni chiroyli markdown bloklarida ber."
    )
    contents = build_gemini_contents(req.history or [], req.message)

    def event_generator():
        try:
            response = client.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=sys_prompt,
                    temperature=0.7,
                ),
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            yield f"\n⚠️ Xatolik: {str(e)}"

    return StreamingResponse(event_generator(), media_type="text/plain; charset=utf-8")


# 3. RASM GENERATSIYASI (/api/image)
@app.post("/api/image")
async def image_endpoint(req: ImageRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan")
    try:
        result = client.models.generate_images(
            model="imagen-3.0-generate-002",
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
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Serverda GEMINI_API_KEY sozlanmagan")

    # Limitni tekshirish (Oddiy: 4 ta/kun, Pro: 25 ta/kun, Ultra: cheksiz)
    limit_info = check_and_increment_site_limit(
        user_id=req.user_id or "guest",
        plan=req.plan or "standard",
        is_admin=bool(req.is_admin)
    )
    if not limit_info["allowed"]:
        raise HTTPException(
            status_code=429,
            detail=f"Kunlik veb-sayt yaratish limiti tugadi ({limit_info['limit']} ta). Pro yoki Ultra tarifiga o'ting."
        )

    # Tarifga mos model va murakkablik darajasi
    is_premium = req.plan in ("pro", "ultra") or req.is_admin
    model_name = "gemini-2.5-pro" if req.plan == "ultra" else "gemini-2.5-flash"

    tier_instruction = (
        "Zamonaviy, animatsiyali, mukammal responsive dizayn, interaktiv JavaScript funksiyalari va boy kontent bilan yarat."
        if is_premium else
        "Toza, tushunarli, chiroyli va to'liq ishlaydigan oddiy veb-sahifa (HTML + CSS + JS) yarat."
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
        response = client.models.generate_content(
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

        return {
            "ready": True,                  # Frontend shu qiymat true bo'lganda o'ng tomonda Preview oynasini ochadi
            "html": html_code,              # iframe srcdoc ga beriladigan tayyor HTML + CSS + JS
            "sitesLeft": limit_info["left"] # Qolgan kunlik limit
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
