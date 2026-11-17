import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Content } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_IMAGE_URL = "https://olmabekaiweb.onrender.com/api/image";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

interface ChatTurn {
  role: string;
  content: string;
}

function getThinkingLevel(plan: string, deep: boolean, isCode: boolean): ThinkingLevel {
  if (plan === "ultra") {
    return deep || isCode ? ThinkingLevel.XHIGH : ThinkingLevel.HIGH;
  }
  if (plan === "pro") {
    return isCode || deep ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;
  }
  return isCode ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW;
}

function buildContents(history: ChatTurn[], message: string, currentCode?: string): Content[] {
  const contents: Content[] = [];
  const safeHistory = Array.isArray(history) ? history.slice(-16) : [];
  for (const item of safeHistory) {
    if (!item || typeof item.content !== "string" || !item.content.trim()) continue;
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    });
  }
  const finalPrompt =
    currentCode && currentCode.trim()
      ? `Hozirgi mavjud kod konteksti:\n\`\`\`\n${currentCode.slice(0, 18000)}\n\`\`\`\n\nFoydalanuvchi talabi:\n${message}`
      : message;
  contents.push({
    role: "user",
    parts: [{ text: finalPrompt }],
  });
  return contents;
}

function getCodeSystemInstruction(plan: string, stack: string): string {
  const stackGuidance =
    stack === "react"
      ? "Foydalanuvchi React JSX/TSX komponentini xohlaydi. Komponentni to'liq yozing (default export App bo'lsin, Tailwind CSS ishlatilsin, Lucide ikonkalari o'rniga inline SVG yoki toza CSS ishlating, tashqi kutubxonalarsiz ham jonli preview da chiroyli ishlashi uchun)."
      : stack === "python"
        ? "Foydalanuvchi Python kodini xohlaydi. Toza, tipizatsiyalangan, izohli va ishga tushirishga tayyor ```python``` kodi yozing."
        : "Veb-ilova, sahifa, o'yin yoki UI so'ralganda DOIM bitta to'liq, mustaqil ishlaydigan ```html``` fayli (`<!DOCTYPE html>...`) ko'rinishida yozing (Tailwind CDN `<script src=\"https://cdn.tailwindcss.com\"></script>`, Google Fonts, ichki `<style>` va `<script>` bilan). Shunda Preview oynasida darhol mukammal ishlaydi!";

  const tierDepth =
    plan === "ultra"
      ? "Siz ULTRA darajadagi Senior Principal Architect rejimidasiz: maksimal sifat, mukammal responsive layout, mikro-animatsiyalar, boy interaktiv holatlar, dark/light balans va xatosiz arxitektura yarating."
      : plan === "pro"
        ? "Siz PRO darajadagi Senior Full-Stack dasturchisiz: to'liq funksional, zamonaviy va estetik jihatdan yuqori saviyali kod yozing."
        : "Siz Standart yordamchisiz: aniq, ixcham va to'g'ri ishlaydigan kod yozing.";

  return [
    "Siz OLMABEK CODE — OLMABEK AI platformasining Google AI Studio asosidagi professional dasturlash muharririsiz.",
    tierDepth,
    stackGuidance,
    "Javobni o'zbek tilida 1-2 qisqa gap bilan boshlang, so'ng to'liq kodni bitta asosiy fenced kod blokida (masalan ```html ... ``` yoki ```python ... ```) taqdim eting.",
    "Kodni hech qachon '...' deb qisqartirmang — har bir funksional qism to'liq yozilsin.",
  ].join("\n\n");
}

function getChatSystemInstruction(plan: string, deep: boolean): string {
  const depth =
    plan === "ultra" && deep
      ? "Murakkab savollarni chuqur, bosqichma-bosqich, misollar va aniq xulosalar bilan tahlil qilib bering."
      : plan === "pro"
        ? "Aniq, tezkor, tizimli va foydali javoblar bering."
        : "Lo'nda, tushunarli va samimiy o'zbek tilida javob bering.";

  return `Siz OLMABEK AI — o'zbek tilida mukammal fikrlaydigan sun'iy intellekt yordamchisiz. ${depth} Zarur bo'lganda markdown sarlavhalar, ro'yxatlar va kod bloklaridan foydalaning.`;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || "Noma'lum xato");
  if (!process.env.GEMINI_API_KEY) {
    return {
      status: 500,
      message: "GEMINI_API_KEY sozlanmagan. Settings > Secrets panelidan API kalitini tekshiring.",
    };
  }
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED") || raw.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "API kaliti yaroqsiz yoki ruxsat berilmagan. Settings > Secrets panelini tekshiring.",
    };
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "So'rovlar limiti vaqtincha tugadi (429). Birozdan so'ng qayta urinib ko'ring.",
    };
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE")) {
    return {
      status: 503,
      message: "Google AI Studio serverida vaqtincha yuklama yuqori (503). Bir necha soniyadan so'ng qayta urinib ko'ring.",
    };
  }
  return { status: 500, message: raw };
}

async function withTransientRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const delays = [900, 1800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err || "");
      const isTransient = msg.includes("503") || msg.includes("UNAVAILABLE");
      if (!isTransient || attempt === delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

const CODE_TOKEN_LIMITS: Record<string, number> = {
  standard: 25_000,
  pro: 250_000,
  ultra: 2_000_000,
};

const SITE_LIMITS: Record<string, number> = {
  standard: 4,
  pro: 25,
  ultra: 999_999,
};

interface UsageRecord {
  day: string;
  tokensUsed: number;
  sitesUsed: number;
}

const usageDb = new Map<string, UsageRecord>();

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrResetRecord(userId: string): UsageRecord {
  const day = getToday();
  const existing = usageDb.get(userId);
  if (!existing || existing.day !== day) {
    const fresh: UsageRecord = { day, tokensUsed: 0, sitesUsed: 0 };
    usageDb.set(userId, fresh);
    return fresh;
  }
  return existing;
}

function getCodeTokensLeft(userId: string, plan: string, isAdmin: boolean): number {
  if (isAdmin) return CODE_TOKEN_LIMITS.ultra;
  const tier = plan in CODE_TOKEN_LIMITS ? plan : "standard";
  const record = getOrResetRecord(userId);
  return Math.max(0, CODE_TOKEN_LIMITS[tier] - record.tokensUsed);
}

function consumeCodeTokens(userId: string, plan: string, isAdmin: boolean, tokens: number): number {
  if (isAdmin) return CODE_TOKEN_LIMITS.ultra;
  const tier = plan in CODE_TOKEN_LIMITS ? plan : "standard";
  const record = getOrResetRecord(userId);
  record.tokensUsed += Math.max(0, tokens);
  return Math.max(0, CODE_TOKEN_LIMITS[tier] - record.tokensUsed);
}

function checkAndIncrementSiteLimit(userId: string, plan: string, isAdmin: boolean) {
  if (isAdmin || plan === "ultra") {
    return { allowed: true, left: 999_999, limit: 999_999 };
  }
  const tier = plan in SITE_LIMITS ? plan : "standard";
  const maxLimit = SITE_LIMITS[tier];
  const record = getOrResetRecord(userId);
  if (record.sitesUsed >= maxLimit) {
    return { allowed: false, left: 0, limit: maxLimit };
  }
  record.sitesUsed += 1;
  return { allowed: true, left: maxLimit - record.sitesUsed, limit: maxLimit };
}

function cleanHtmlOutput(rawText: string): string {
  const text = (rawText || "").trim();
  const fence = text.match(/```(?:html|htm)?\s*\n([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const doc = text.match(/(<!DOCTYPE\s+html[\s\S]*<\/html>)/i);
  if (doc) return doc[1].trim();
  return text.replace(/^```(?:html)?\s*/i, "").replace(/```$/i, "").trim();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      status: "ok",
      service: "Olmabek AI Server",
      model: "gemini-4-hydrogen",
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.get("/api/limits", (req: Request, res: Response) => {
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : "guest";
    const planRaw = typeof req.query.plan === "string" ? req.query.plan : "standard";
    const tier = planRaw in CODE_TOKEN_LIMITS ? planRaw : "standard";
    const isAdmin = req.query.is_admin === "true";
    const record = getOrResetRecord(userId);
    res.json({
      plan: tier,
      codeTokensLeft: getCodeTokensLeft(userId, tier, isAdmin),
      codeTokensLimit: CODE_TOKEN_LIMITS[tier],
      sitesLeft: isAdmin || tier === "ultra" ? 999_999 : Math.max(0, SITE_LIMITS[tier] - record.sitesUsed),
      sitesLimit: SITE_LIMITS[tier],
    });
  });

  // Streaming endpoint for both Olmabek Chat & Olmabek Code
  const handleStream = async (req: Request, res: Response, isCodeDefault: boolean) => {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "Xabar matni bo'sh" });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: "GEMINI_API_KEY topilmadi. Settings > Secrets panelidan API kalitini kiriting.",
      });
      return;
    }

    const plan = typeof body.plan === "string" ? body.plan : "standard";
    const deep = Boolean(body.deep);
    const isCode = isCodeDefault || body.mode === "code";
    const stack = typeof body.stack === "string" ? body.stack : "auto";
    const currentCode = typeof body.currentCode === "string" ? body.currentCode : undefined;
    const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];
    const userId = typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : "guest";
    const isAdmin = Boolean(body.is_admin);

    if (isCode && !isAdmin && getCodeTokensLeft(userId, plan, isAdmin) <= 0) {
      res.status(429).json({
        error: "Kunlik Olmabek Code token limiti tugadi. Pro yoki Ultra tarifiga o'ting.",
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const controller = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const thinkingLevel = getThinkingLevel(plan, deep, isCode);
      const systemInstruction = isCode
        ? getCodeSystemInstruction(plan, stack)
        : getChatSystemInstruction(plan, deep);

      const contents = buildContents(history, message, isCode ? currentCode : undefined);

      const stream = await withTransientRetry(
        () =>
          ai.models.generateContentStream({
            model: "gemini-4-hydrogen",
            contents,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
            },
          }),
        controller.signal
      );

      let promptTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let charCount = 0;

      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        const text = chunk.text ?? "";
        if (text) {
          charCount += text.length;
          sendEvent({ type: "chunk", text });
        }
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
          outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
          totalTokens =
            chunk.usageMetadata.totalTokenCount ?? (promptTokens + outputTokens || totalTokens);
        }
      }

      if (!totalTokens && charCount > 0) {
        outputTokens = Math.max(1, Math.ceil(charCount / 3.5));
        promptTokens = Math.max(1, Math.ceil(message.length / 4));
        totalTokens = promptTokens + outputTokens;
      }

      const tokensLeft = isCode
        ? consumeCodeTokens(userId, plan, isAdmin, totalTokens)
        : getCodeTokensLeft(userId, plan, isAdmin);

      sendEvent({
        type: "usage",
        promptTokens,
        outputTokens,
        totalTokens,
        tokensLeft,
        thinkingLevel,
      });
      sendEvent({ type: "done" });
      res.end();
    } catch (err) {
      if (!controller.signal.aborted) {
        const formatted = formatGeminiError(err);
        sendEvent({ type: "error", error: formatted.message });
      }
      if (!res.writableEnded) res.end();
    }
  };

  app.post("/api/code/stream", (req, res) => handleStream(req, res, true));
  app.post("/api/chat/stream", (req, res) => handleStream(req, res, false));

  // Non-streaming JSON endpoints for compatibility / diagnostics
  const handleSync = async (req: Request, res: Response, isCodeDefault: boolean) => {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "Xabar matni bo'sh" });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: "GEMINI_API_KEY topilmadi. Settings > Secrets panelidan API kalitini kiriting.",
      });
      return;
    }

    const plan = typeof body.plan === "string" ? body.plan : "standard";
    const deep = Boolean(body.deep);
    const isCode = isCodeDefault || body.mode === "code";
    const stack = typeof body.stack === "string" ? body.stack : "auto";
    const currentCode = typeof body.currentCode === "string" ? body.currentCode : undefined;
    const history: ChatTurn[] = Array.isArray(body.history) ? body.history : [];
    const userId = typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : "guest";
    const isAdmin = Boolean(body.is_admin);

    if (isCode && !isAdmin && getCodeTokensLeft(userId, plan, isAdmin) <= 0) {
      res.status(429).json({
        error: "Kunlik Olmabek Code token limiti tugadi. Pro yoki Ultra tarifiga o'ting.",
      });
      return;
    }

    try {
      const thinkingLevel = getThinkingLevel(plan, deep, isCode);
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: buildContents(history, message, isCode ? currentCode : undefined),
          config: {
            systemInstruction: isCode
              ? getCodeSystemInstruction(plan, stack)
              : getChatSystemInstruction(plan, deep),
            thinkingConfig: { thinkingLevel },
          },
        })
      );

      const reply = response.text ?? "";
      const usage = response.usageMetadata;
      const totalTokens = usage?.totalTokenCount ?? Math.ceil(reply.length / 3.5);
      const tokensLeft = isCode
        ? consumeCodeTokens(userId, plan, isAdmin, totalTokens)
        : getCodeTokensLeft(userId, plan, isAdmin);

      res.json({
        reply,
        usage: {
          promptTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
          totalTokens,
          tokensLeft,
          thinkingLevel,
        },
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  };

  app.post("/api/code", (req, res) => handleSync(req, res, true));
  app.post("/api/chat", (req, res) => handleSync(req, res, false));

  // Website builder endpoint matching Python backend (/api/build-site)
  app.post("/api/build-site", async (req: Request, res: Response) => {
    const body = req.body || {};
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      res.status(400).json({ error: "So'rov matni bo'sh" });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: "GEMINI_API_KEY topilmadi. Settings > Secrets panelidan API kalitini kiriting.",
      });
      return;
    }

    const plan = typeof body.plan === "string" ? body.plan : "standard";
    const userId = typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : "guest";
    const isAdmin = Boolean(body.is_admin);
    const currentCode = typeof body.current_code === "string" ? body.current_code : "";

    const limitInfo = checkAndIncrementSiteLimit(userId, plan, isAdmin);
    if (!limitInfo.allowed) {
      res.status(429).json({
        error: `Kunlik veb-sayt yaratish limiti tugadi (${limitInfo.limit} ta). Pro yoki Ultra tarifiga o'ting.`,
      });
      return;
    }

    const isPremium = plan === "pro" || plan === "ultra" || isAdmin;
    const tierInstruction = isPremium
      ? "Zamonaviy, animatsiyali, mukammal responsive dizayn, interaktiv JavaScript funksiyalari va boy kontent bilan yarat."
      : "Toza, tushunarli, chiroyli va to'liq ishlaydigan oddiy veb-sahifa (HTML + CSS + JS) yarat.";

    const systemInstruction = [
      "Sen professional Frontend dasturchi va UI/UX dizaynersan.",
      "Vazifang: Foydalanuvchi so'roviga ko'ra tayyor, yagona faylli (single-file) to'liq ishlaydigan veb-sayt kodini yozish.",
      "Texnologiyalar: HTML5, CSS3 (<style> ichida) va Vanilla JavaScript (<script> ichida).",
      `1. ${tierInstruction}`,
      "2. Barcha CSS va JS kodlari bitta <!DOCTYPE html> hujjati ichida bo'lsin, shunda uni to'g'ridan-to'g'ri iframe (Preview) oynasida ochish mumkin bo'lsin.",
      "3. Hech qanday tushuntirish matni yoki markdown (```html) yozma! Faqat toza HTML kodning o'zini qaytar.",
      "4. Matnlar foydalanuvchi so'ragan tilda (asosan o'zbek tilida) bo'lsin.",
    ].join("\n");

    const userPrompt = currentCode.trim()
      ? `Quyidagi mavjud veb-sayt kodini foydalanuvchi talabiga moslab tahrirla va yangilangan to'liq kodni qaytar:\n\nTALAB: ${prompt}\n\nMAVJUD KOD:\n${currentCode.slice(0, 18000)}`
      : `Quyidagi talab asosida yangi veb-sayt yarat:\n${prompt}`;

    try {
      const thinkingLevel = getThinkingLevel(plan, plan === "ultra", true);
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: userPrompt,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel },
          },
        })
      );

      const htmlCode = cleanHtmlOutput(response.text ?? "");
      if (!htmlCode) {
        res.status(500).json({ error: "Kod generatsiya qilinmadi" });
        return;
      }

      const totalTokens = response.usageMetadata?.totalTokenCount ?? Math.ceil(htmlCode.length / 3.5);
      const tokensLeft = consumeCodeTokens(userId, plan, isAdmin, totalTokens);

      res.json({
        ready: true,
        html: htmlCode,
        sitesLeft: limitInfo.left,
        tokensUsed: totalTokens,
        tokensLeft,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Image endpoint proxy to existing Render service until Python backend is dropped
  app.post("/api/image", async (req: Request, res: Response) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const upstream = await fetch(UPSTREAM_IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await upstream.json().catch(() => ({}));
      res.status(upstream.status).json(data);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Rasm serveri javob bermadi (vaqt tugadi)"
          : "Rasm serveriga ulanib bo'lmadi";
      res.status(502).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = path.resolve(__dirname, "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`OLMABEK AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
