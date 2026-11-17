import { extractCodeArtifacts, type ExtractedPreview } from './utils/codeExtractor';
import {
  formatCompactTokens,
  PLANS,
  type CodeStack,
  type InputMode,
  type PlanTier,
  type RequestLogItem,
  type UltraSkin,
  type UserState,
} from './types';

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  type: 'text' | 'image';
  prompt?: string;
  mode?: InputMode;
  tokensUsed?: number;
}

interface StoredChat {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

interface BodyEl extends HTMLDivElement {
  _raw?: string;
  _avatar?: HTMLDivElement | null;
  _prompt?: string;
}

interface DotsEl extends HTMLDivElement {
  _t?: number;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

(() => {
  'use strict';

  // ===== CONFIG =====
  const LIMITS: Record<PlanTier, number> = { standard: 25, pro: 150, ultra: 999999 };
  const IMG_LIMITS: Record<PlanTier, number> = { standard: 8, pro: 20, ultra: 80 };
  const CODE_LIMITS: Record<PlanTier, number> = {
    standard: PLANS.standard.codeTokensPerDay,
    pro: PLANS.pro.codeTokensPerDay,
    ultra: PLANS.ultra.codeTokensPerDay,
  };
  const today = () => new Date().toISOString().slice(0, 10);

  const STORAGE_KEY = 'olmabek_user';
  const CHATS_KEY = 'olmabek_chats';
  const THEME_KEY = 'olmabek_theme';
  const ADMIN_KEY = 'olmabek_admin';
  const MAX_CHATS = 50;
  const API_BASE =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { OLMABEK_API_BASE?: string }).OLMABEK_API_BASE === 'string'
      ? (window as unknown as { OLMABEK_API_BASE?: string }).OLMABEK_API_BASE!
      : '';

  // ⚠️ ADMIN KIRISHI
  const ADMIN_USER = 'cyberlobo515';
  const ADMIN_PASS = 'Samsung18_';
  const ADMIN_PLAN_KEY = 'olmabek_admin_plan';
  const AI_OFF_KEY = 'olmabek_ai_off';
  const LOG_KEY = 'olmabek_reqlog';
  const SKIN_KEY = 'olmabek_skin';

  const MODE_CONFIG: Record<InputMode, { placeholder: string; note: string }> = {
    chat: {
      placeholder: 'Xabar yozing...',
      note: "OLMABEK AI xatolik qilishi mumkin. Muhim ma'lumotlarni tekshiring.",
    },
    image: {
      placeholder: 'Rasm uchun matn yozing (masalan: qora BMW M8 tungi shaharda)',
      note: 'Rasm generatsiyasi 5-30 soniya vaqt oladi. Matnni aniq yozing.',
    },
    code: {
      placeholder: 'Qanday sayt, komponent yoki dastur yozay? (masalan: zamonaviy kalkulyator)',
      note: 'Olmabek Code · Google AI Studio API bilan ishlaydi va natijani Preview oynasida ko\'rsatadi.',
    },
  };

  // ===== HERO GREETINGS =====
  const HERO_GREETINGS = [
    { title: 'Doim tayyorman', sub: "Kod, tahlil, g'oya yoki matn — savolingizni yozing, birga hal qilamiz." },
    { title: 'Nima qiziqtiradi?', sub: 'Qiziq mavzuni tanlang, men tushuntirib, tahlil qilib beraman.' },
    { title: 'Bugun nima qilamiz?', sub: "Kun rejangizni ayting — kod, matn yoki g'oya bilan yordam beraman." },
    { title: 'Yangi loyihani boshlaymizmi?', sub: "G'oyangizni yozing, birga rejalashtirib, amalga oshiramiz." },
    { title: '{name}, ishlar qalay?', sub: 'Bugun nima ustida ishlaymiz?', personalized: true },
  ];

  interface HeroChip {
    icon: string;
    title: string;
    sub: string;
    text: string;
    mode: InputMode;
    tier: number;
    deep?: boolean;
    style?: number;
  }

  const HERO_CHIPS: HeroChip[] = [
    {
      icon: 'code',
      title: 'Olmabek Code',
      sub: 'Sayt yoki ilova yozib jonli Previewda ko\'ring',
      text: 'Zamonaviy, chiroyli dizaynli Pomodoro taymer va vazifalar ro\'yxati web-ilovasini yozib ber',
      mode: 'code',
      tier: 0,
    },
    {
      icon: 'lightbulb',
      title: "Biznes g'oyasi",
      sub: "Kiyim do'koni uchun marketing rejasi",
      text: "Kiyim do'konim uchun Instagram marketing rejasini tuzib ber",
      mode: 'chat',
      tier: 0,
    },
    {
      icon: 'edit_note',
      title: 'Matn tahrirlash',
      sub: "Xat yoki e'lonni silliqlang",
      text: 'Quyidagi matnni chiroyli va qisqa qilib qayta yoz:\n',
      mode: 'chat',
      tier: 0,
    },
    {
      icon: 'image',
      title: 'Rasm chizish',
      sub: 'Tasavvuringizni rasmga aylantiring',
      text: 'Kechqurungi Registon maydoni, kino uslubida',
      mode: 'image',
      tier: 0,
    },
    {
      icon: 'translate',
      title: 'Tarjima',
      sub: "Matnni istalgan tilga o'giring",
      text: 'Quyidagi matnni inglizchaga tarjima qil:\n',
      mode: 'chat',
      tier: 1,
    },
    {
      icon: 'monitoring',
      title: 'Tahlil',
      sub: "Ma'lumotdan xulosa va tavsiya",
      text: 'Quyidagi ma\'lumotni tahlil qilib, xulosa va tavsiyalar ber:\n',
      mode: 'chat',
      tier: 1,
    },
    {
      icon: 'neurology',
      title: 'Chuqur tahlil',
      sub: 'Qadam-baqadam strategiya',
      text: "Biznesim uchun 6 oylik o'sish strategiyasini qadam-baqadam tuz",
      mode: 'chat',
      tier: 2,
      deep: true,
    },
    {
      icon: 'movie',
      title: 'Kino kadri',
      sub: 'Kino uslubidagi rasm',
      text: "Yomg'irdan keyingi tungi Samarqand, kino kadri",
      mode: 'image',
      tier: 2,
      style: 0,
    },
  ];
  const TIER: Record<PlanTier, number> = { standard: 0, pro: 1, ultra: 2 };

  function getRandomGreeting(name: string) {
    const g = HERO_GREETINGS[Math.floor(Math.random() * HERO_GREETINGS.length)];
    return {
      title: g.title.replace('{name}', name || 'Foydalanuvchi'),
      sub: g.sub,
    };
  }

  // ===== STATE =====
  const state: {
    user: UserState | null;
    authMode: 'login' | 'register';
    selectedPlan: PlanTier | null;
    isSending: boolean;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    mode: string;
    inputMode: InputMode;
    codeStack: CodeStack;
    isAdmin: boolean;
    chats: StoredChat[];
    currentChatId: string | null;
    style: number | null;
    deep: boolean;
    abort: AbortController | null;
    t0: number;
    preview: ExtractedPreview | null;
    previewOpen: boolean;
    previewTab: 'preview' | 'code';
    previewDevice: string;
    pendingDeleteId: string | null;
    pendingLogout: boolean;
  } = {
    user: null,
    authMode: 'login',
    selectedPlan: null,
    isSending: false,
    history: [],
    mode: 'fast',
    inputMode: 'chat',
    codeStack: 'auto',
    isAdmin: false,
    chats: [],
    currentChatId: null,
    style: null,
    deep: false,
    abort: null,
    t0: 0,
    preview: null,
    previewOpen: false,
    previewTab: 'preview',
    previewDevice: '100%',
    pendingDeleteId: null,
    pendingLogout: false,
  };

  // ===== HELPERS =====
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

  let toastTimer: number | undefined;
  function toast(msg: string) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
  }

  function esc(s: unknown): string {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function saveUser() {
    if (state.user) localStorage.setItem(STORAGE_KEY, JSON.stringify(state.user));
  }
  function loadUser(): UserState | null {
    try {
      const r = localStorage.getItem(STORAGE_KEY);
      return r ? (JSON.parse(r) as UserState) : null;
    } catch {
      return null;
    }
  }

  // ===== CHAT STORAGE =====
  function loadChats(): StoredChat[] {
    try {
      const raw = localStorage.getItem(CHATS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function saveChats() {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(state.chats));
    } catch {
      while (state.chats.length > 1) {
        state.chats.pop();
        try {
          localStorage.setItem(CHATS_KEY, JSON.stringify(state.chats));
          return;
        } catch {
          // keep popping
        }
      }
    }
  }
  function genId() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }
  function getCurrentChat() {
    return state.chats.find((c) => c.id === state.currentChatId) || null;
  }
  function createChat(title: string) {
    const chat: StoredChat = {
      id: genId(),
      title: (title || 'Yangi suhbat').trim().slice(0, 50) || 'Yangi suhbat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.chats.unshift(chat);
    if (state.chats.length > MAX_CHATS) state.chats.pop();
    state.currentChatId = chat.id;
    saveChats();
    renderSidebar();
    return chat;
  }
  function pushMessage(
    role: 'user' | 'assistant',
    content: string,
    type: 'text' | 'image' = 'text',
    extra: Partial<StoredMessage> = {}
  ) {
    let chat = getCurrentChat();
    if (!chat) chat = createChat('Yangi suhbat');
    chat.messages.push({ role, content, type, ...extra });
    chat.updatedAt = Date.now();
    saveChats();
    return chat;
  }

  // ===== ELEMENTS =====
  const landing = $<HTMLDivElement>('landing');
  const lnAuth = $<HTMLDivElement>('lnAuth');
  const authScreen = $<HTMLElement>('authScreen');
  const authForm = $<HTMLFormElement>('authForm');
  const authName = $<HTMLInputElement>('authName');
  const authEmail = $<HTMLInputElement>('authEmail');
  const authPass = $<HTMLInputElement>('authPass');
  const authBtn = $<HTMLButtonElement>('authBtn');
  const nameField = $<HTMLDivElement>('nameField');
  const authTabs = document.querySelectorAll<HTMLButtonElement>('.auth-tab');

  const appScreen = $<HTMLDivElement>('appScreen');
  const sidebar = $<HTMLElement>('sidebar');
  const sidebarOver = $<HTMLDivElement>('sidebarOverlay');
  const sidebarHist = $<HTMLDivElement>('sidebarHistory');
  const menuBtn = $<HTMLButtonElement>('menuBtn');
  const collapseBtn = $<HTMLButtonElement>('collapseBtn');
  const newChatBtn = $<HTMLButtonElement>('newChatBtn');
  const accountBtn = $<HTMLButtonElement>('accountBtn');
  const userAvatar = $<HTMLDivElement>('userAvatar');
  const userNameEl = $<HTMLSpanElement>('userName');
  const userPlanEl = $<HTMLSpanElement>('userPlan');

  const chatArea = $<HTMLDivElement>('chatArea');
  const messages = $<HTMLDivElement>('messages');
  const input = $<HTMLTextAreaElement>('input');
  const sendBtn = $<HTMLButtonElement>('sendBtn');
  const composerInner = $<HTMLDivElement>('composerInner');
  const composerNote = $<HTMLParagraphElement>('composerNote');
  const limitBadge = $<HTMLDivElement>('limitBadge');
  const limitText = $<HTMLSpanElement>('limitText');
  const modeTabs = document.querySelectorAll<HTMLButtonElement>('.mode-tab');

  const codeStackRow = $<HTMLDivElement>('codeStackRow');
  const codeTokenHud = $<HTMLSpanElement>('codeTokenHud');
  const fileInput = $<HTMLInputElement>('fileInput');
  const attachBtn = $<HTMLButtonElement>('attachBtn');

  const previewToggleBtn = $<HTMLButtonElement>('previewToggleBtn');
  const previewPane = $<HTMLElement>('previewPane');
  const pvFrameWrap = $<HTMLDivElement>('pvFrameWrap');
  const previewFrame = $<HTMLIFrameElement>('previewFrame');
  const pvCodeWrap = $<HTMLPreElement>('pvCodeWrap');
  const pvCodeEl = $<HTMLElement>('pvCodeEl');
  const pvErrorBar = $<HTMLDivElement>('pvErrorBar');
  const pvErrorText = $<HTMLSpanElement>('pvErrorText');
  const pvFixBtn = $<HTMLButtonElement>('pvFixBtn');
  const pvRefresh = $<HTMLButtonElement>('pvRefresh');
  const pvCopy = $<HTMLButtonElement>('pvCopy');
  const pvDownload = $<HTMLButtonElement>('pvDownload');
  const pvFullscreen = $<HTMLButtonElement>('pvFullscreen');
  const pvClose = $<HTMLButtonElement>('pvClose');

  const modal = $<HTMLDivElement>('modal');
  const currentPlan = $<HTMLSpanElement>('currentPlan');
  const currentLimit = $<HTMLSpanElement>('currentLimit');
  const limitWarning = $<HTMLDivElement>('limitWarning');
  const payPlanName = $<HTMLSpanElement>('payPlanName');
  const payPlanPrice = $<HTMLSpanElement>('payPlanPrice');
  const trialBtn = $<HTMLButtonElement>('trialBtn');
  const successText = $<HTMLParagraphElement>('successText');
  const successBtn = $<HTMLButtonElement>('successBtn');
  const backBtn = $<HTMLButtonElement>('backBtn');
  const logoutBtn = $<HTMLButtonElement>('logoutBtn');

  const adminBar = $<HTMLDivElement>('adminBar');
  const adminBtn = $<HTMLButtonElement>('adminBtn');
  const adminModal = $<HTMLDivElement>('adminModal');
  const adminForm = $<HTMLFormElement>('adminForm');
  const adminEmail = $<HTMLInputElement>('adminEmail');
  const adminPass = $<HTMLInputElement>('adminPass');
  const adminSubmit = $<HTMLButtonElement>('adminSubmit');

  const STYLES: Array<[string, string]> = [
    ['Kino', 'cinematic film still, dramatic lighting'],
    ['Anime', 'anime style, vibrant colors, detailed'],
    ['3D', '3D render, soft studio light, octane'],
    ['Realistik', 'photorealistic, 85mm lens, ultra detailed'],
    ['Akvarel', 'watercolor painting, soft washes'],
  ];
  const SKINS: Array<[UltraSkin, string]> = [
    ['obsidian', 'Obsidian'],
    ['galaxy', 'Galaktika'],
    ['blackhole', 'Qora tuynuk'],
  ];

  // ===== PREVIEW PANE =====
  function renderPreviewCodeFallback(lang: string) {
    return `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8" />
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#090b10; color:#eceef2; font-family:system-ui,sans-serif; padding:24px; text-align:center; }
  .box { max-width:360px; padding:24px; border-radius:18px; background:#11151d; border:1px solid rgba(255,255,255,0.1); }
  .tag { display:inline-block; padding:4px 12px; border-radius:99px; font-size:12px; background:rgba(143,168,255,0.16); color:#8fa8ff; margin-bottom:12px; text-transform:uppercase; }
  h3 { margin:0 0 8px; font-size:18px; }
  p { margin:0; font-size:13px; color:#98a0af; line-height:1.55; }
</style>
</head>
<body>
  <div class="box">
    <span class="tag">${esc(lang || 'kod')}</span>
    <h3>Kod tayyor</h3>
    <p>Bu dasturlash tili brauzer oynasida bevosita ishga tushirilmaydi. Yuqoridagi <b>Kod</b> bo'limiga o'tib to'liq kodni ko'rishingiz, nusxalashingiz yoki yuklab olishingiz mumkin.</p>
  </div>
</body>
</html>`;
  }

  function syncPreviewUI() {
    const has = Boolean(state.preview && state.preview.hasCode);
    previewToggleBtn.classList.toggle('visible', has);
    previewToggleBtn.classList.toggle('active', has && state.previewOpen);
    previewPane.classList.toggle('open', has && state.previewOpen);
    previewPane.setAttribute('aria-hidden', String(!(has && state.previewOpen)));

    if (!has || !state.preview) return;

    const showFrame = state.previewTab === 'preview';
    pvFrameWrap.classList.toggle('hidden', !showFrame);
    pvCodeWrap.classList.toggle('hidden', showFrame);

    document.querySelectorAll<HTMLButtonElement>('.pv-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.pvtab === state.previewTab);
    });
    document.querySelectorAll<HTMLButtonElement>('.pv-dev').forEach((b) => {
      b.classList.toggle('active', b.dataset.pvdev === state.previewDevice);
    });
    pvFrameWrap.style.width = state.previewDevice;
    pvCodeEl.textContent = state.preview.primaryCode;
  }

  function applyPreviewFromMarkdown(markdown: string, options: { open?: boolean; forceTab?: 'preview' | 'code' } = {}) {
    const extracted = extractCodeArtifacts(markdown);
    if (!extracted.hasCode) return false;
    state.preview = extracted;
    pvErrorBar.classList.add('hidden');
    pvErrorText.textContent = '';

    if (options.forceTab) {
      state.previewTab = options.forceTab;
    } else if (!extracted.isRenderable) {
      state.previewTab = 'code';
    } else {
      state.previewTab = 'preview';
    }

    if (options.open !== undefined) {
      state.previewOpen = options.open;
    }

    previewFrame.srcdoc = extracted.isRenderable
      ? extracted.previewHtml
      : renderPreviewCodeFallback(extracted.primaryLang);

    syncPreviewUI();
    return true;
  }

  function togglePreviewPane(open?: boolean) {
    if (!state.preview || !state.preview.hasCode) {
      toast("Hozircha preview uchun kod yo'q");
      return;
    }
    state.previewOpen = open !== undefined ? open : !state.previewOpen;
    if (!state.previewOpen) previewPane.classList.remove('fullscreen');
    syncPreviewUI();
  }

  previewToggleBtn.addEventListener('click', () => togglePreviewPane());
  pvClose.addEventListener('click', () => togglePreviewPane(false));
  pvFullscreen.addEventListener('click', () => {
    const fs = previewPane.classList.toggle('fullscreen');
    const ic = pvFullscreen.querySelector('.material-symbols-outlined');
    if (ic) ic.textContent = fs ? 'close_fullscreen' : 'open_in_full';
  });
  pvRefresh.addEventListener('click', () => {
    if (!state.preview) return;
    pvErrorBar.classList.add('hidden');
    previewFrame.srcdoc = state.preview.isRenderable
      ? state.preview.previewHtml
      : renderPreviewCodeFallback(state.preview.primaryLang);
    toast('Preview yangilandi');
  });
  pvCopy.addEventListener('click', () => {
    if (!state.preview?.primaryCode) return;
    (navigator.clipboard ? navigator.clipboard.writeText(state.preview.primaryCode) : Promise.reject())
      .then(() => toast('Kod nusxalandi ✓'))
      .catch(() => toast("Nusxalab bo'lmadi"));
  });
  pvDownload.addEventListener('click', () => {
    if (!state.preview?.primaryCode) return;
    const extMap: Record<string, string> = {
      html: 'html',
      htm: 'html',
      jsx: 'jsx',
      tsx: 'tsx',
      react: 'jsx',
      python: 'py',
      py: 'py',
      js: 'js',
      javascript: 'js',
      ts: 'ts',
      typescript: 'ts',
      css: 'css',
      svg: 'svg',
    };
    const ext = extMap[state.preview.primaryLang] || 'txt';
    const blob = new Blob([state.preview.primaryCode], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `olmabek-code.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.querySelectorAll<HTMLButtonElement>('.pv-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.pvtab === 'code' ? 'code' : 'preview';
      state.previewTab = tab;
      syncPreviewUI();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.pv-dev').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.previewDevice = btn.dataset.pvdev || '100%';
      syncPreviewUI();
    });
  });

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.source !== 'olmabek-preview' || e.data.type !== 'error') return;
    pvErrorText.textContent = 'Xato: ' + String(e.data.message || 'Skript xatosi');
    pvErrorBar.classList.remove('hidden');
  });

  pvFixBtn.addEventListener('click', () => {
    if (state.isSending) return;
    const errText = pvErrorText.textContent || "Runtime xatosi aniqlandi";
    setInputMode('code');
    input.value = `Preview oynasida quyidagi xato chiqdi, shuni tuzatib kodni to'liq qayta yozib ber:\n${errText}`;
    autoResize();
    sendBtn.disabled = false;
    sendMessage();
  });

  // ===== HERO =====
  function renderHero() {
    if (document.getElementById('hero')) return;
    const p = (document.documentElement.dataset.plan || 'standard') as PlanTier;
    const tier = TIER[p] || 0;
    const g = getRandomGreeting(state.user?.name || 'Foydalanuvchi');
    const NAMES: Record<PlanTier, string> = { standard: 'Oddiy', pro: 'Pro', ultra: 'Ultra' };
    const TAG: Record<PlanTier, string> = {
      standard: 'Bepul tarif',
      pro: 'Ustuvor tezkor javob',
      ultra: 'Hamma imkoniyat ochiq',
    };
    const admin = state.isAdmin;
    const u = state.user;
    const mMax = LIMITS[p] || 25;
    const iMax = IMG_LIMITS[p] || 8;
    const cMax = CODE_LIMITS[p] || 25000;
    const mLeft = p === 'ultra' ? null : admin ? mMax : Math.max(0, u?.messagesLeft || 0);
    const iLeft = admin ? iMax : Math.max(0, u?.imagesLeft || 0);
    const cLeft = admin ? cMax : Math.max(0, u?.codeTokensLeft ?? cMax);
    const mPct = mLeft === null ? 100 : Math.min(100, (mLeft / mMax) * 100);
    const iPct = Math.min(100, (iLeft / iMax) * 100);
    const cPct = Math.min(100, (cLeft / cMax) * 100);
    const skin = (localStorage.getItem(SKIN_KEY) || 'obsidian') as UltraSkin;
    const skinName = (SKINS.find((x) => x[0] === skin) || SKINS[0])[1];
    const UP: Record<PlanTier, [string, string, string | null]> = {
      standard: ["Pro'ni 2 kun bepul sinab ko'ring", '150 xabar · 250K code token · 20 rasm', "Pro'ni sinash"],
      pro: ['Ultra bilan keyingi bosqichga', 'Cheksiz xabar · 2M code token (XHigh) · 80 rasm', "Ultra'ni sinash"],
      ultra: ['Ultra faol', 'Mavzu: ' + skinName + ' · 2M code token', null],
    };
    const upInfo = UP[p];
    const hero = document.createElement('div');
    hero.id = 'hero';
    hero.className = 'hero hx hx-' + p;
    hero.innerHTML = `
      <div class="hx-fx" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="hx-badge"><span class="hx-dot"></span>${NAMES[p]} <em>${TAG[p]}</em></div>
      <div class="hx-orbwrap">
        ${tier ? '<div class="hx-orbit"><b></b></div>' : ''}${tier === 2 ? '<div class="hx-orbit o2"><b></b></div>' : ''}
        <div class="hero-orb" aria-hidden="true"></div>
      </div>
      <h1 class="hero-title">${esc(g.title)}</h1>
      <p class="hero-sub">${esc(g.sub)}</p>
      <div class="hx-usage has-code">
        <div class="hx-card"><div class="ug" style="--v:${mPct.toFixed(1)}"><b>${mLeft === null ? '∞' : mLeft}</b></div><div><small>Xabarlar</small><strong>${mLeft === null ? 'Cheksiz' : mLeft + ' / ' + mMax}</strong><span class="t">bugun qoldi</span></div></div>
        <div class="hx-card"><div class="ug code" style="--v:${cPct.toFixed(1)}"><b>${formatCompactTokens(cLeft)}</b></div><div><small>Code token</small><strong>${formatCompactTokens(cLeft)} / ${formatCompactTokens(cMax)}</strong><span class="t">Olmabek Code</span></div></div>
        <div class="hx-card"><div class="ug img" style="--v:${iPct.toFixed(1)}"><b>${iLeft}</b></div><div><small>Rasmlar</small><strong>${iLeft} / ${iMax}</strong><span class="t">bugun qoldi</span></div></div>
        <div class="hx-card hx-plan"><small>${esc(upInfo[0])}</small><strong>${esc(upInfo[1])}</strong>${upInfo[2] ? `<button type="button" class="hx-up">${upInfo[2]}</button>` : ''}</div>
      </div>
      <div class="hx-sec"><span>Tez boshlash</span></div>
      <div class="hero-chips">
        ${HERO_CHIPS.map((c, i) => {
          const lock = c.tier > tier;
          return `<button type="button" class="hero-chip${lock ? ' locked' : ''}" data-chip="${i}">
            <span class="material-symbols-outlined">${lock ? 'lock' : c.icon}</span>
            <span>${esc(c.title)}<small>${esc(c.sub)}</small></span>
            ${lock ? `<em class="chip-lock">${c.tier === 1 ? 'Pro' : 'Ultra'}</em>` : ''}
          </button>`;
        }).join('')}
      </div>
      ${
        tier === 2
          ? `
      <div class="hx-sec ultra"><span>✦ Ultra boshqaruvi</span></div>
      <div class="hx-ultra-panel">
        <div class="ux ux-deep${state.deep ? ' on' : ''}" data-u="deep" role="button" tabindex="0"><span class="material-symbols-outlined">neurology</span><div><b>Chuqur o'ylash</b><small>Qadam-baqadam javob</small></div><i class="ux-sw"></i></div>
        <div class="ux"><b>Rasm uslubi</b><div class="ux-row">${STYLES.map((x, i) => `<button type="button" data-style="${i}" class="${state.style === i ? 'on' : ''}">${x[0]}</button>`).join('')}</div></div>
        <div class="ux"><b>Mavzu</b><div class="ux-row">${SKINS.map((x) => `<button type="button" class="sk sk-${x[0]}${skin === x[0] ? ' on' : ''}" data-skin="${x[0]}"><i></i>${x[1]}</button>`).join('')}</div></div>
      </div>`
          : ''
      }
    `;
    hero.querySelectorAll<HTMLButtonElement>('.hero-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.chip);
        const c = HERO_CHIPS[idx];
        if (!c) return;
        if (c.tier > tier) {
          toast('Bu imkoniyat ' + (c.tier === 1 ? 'Pro' : 'Ultra') + ' tarifida');
          openModal();
          return;
        }
        setInputMode(c.mode);
        if (c.deep) {
          state.deep = true;
          $('deepBtn').classList.add('on');
        }
        if (c.style != null) {
          state.style = c.style;
          styleRow
            .querySelectorAll<HTMLButtonElement>('button')
            .forEach((x) => x.classList.toggle('on', Number(x.dataset.s) === state.style));
        }
        input.value = c.text;
        autoResize();
        sendBtn.disabled = !input.value.trim();
        input.focus();
      });
    });
    const up = hero.querySelector<HTMLButtonElement>('.hx-up');
    if (up) up.addEventListener('click', () => openModal());
    const deep = hero.querySelector<HTMLDivElement>('[data-u="deep"]');
    if (deep) {
      deep.addEventListener('click', () => {
        state.deep = !state.deep;
        deep.classList.toggle('on', state.deep);
        $('deepBtn').classList.toggle('on', state.deep);
        toast(state.deep ? "Chuqur o'ylash yoqildi" : "Chuqur o'ylash o'chirildi");
      });
    }
    hero.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.style);
        state.style = state.style === i ? null : i;
        hero
          .querySelectorAll<HTMLButtonElement>('[data-style]')
          .forEach((x) => x.classList.toggle('on', Number(x.dataset.style) === state.style));
        styleRow
          .querySelectorAll<HTMLButtonElement>('button')
          .forEach((x) => x.classList.toggle('on', Number(x.dataset.s) === state.style));
        if (state.style != null) setInputMode('image');
      })
    );
    hero.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = b.dataset.skin as UltraSkin;
        localStorage.setItem(SKIN_KEY, s);
        syncSkin();
        hero
          .querySelectorAll<HTMLButtonElement>('[data-skin]')
          .forEach((x) => x.classList.toggle('on', x.dataset.skin === s));
      })
    );
    messages.appendChild(hero);
  }
  function hideHero() {
    const h = document.getElementById('hero');
    if (h) h.remove();
  }
  function newHero() {
    hideHero();
    renderHero();
  }

  // ===== SIDEBAR =====
  function renderSidebar() {
    if (!sidebarHist) return;
    const q = ($<HTMLInputElement>('chatSearch')?.value || '').toLowerCase().trim();

    if (!state.chats.length) {
      sidebarHist.innerHTML = `
        <div class="empty-history">
          <span class="material-symbols-outlined">chat_bubble</span>
          <p>Hali suhbatlar yo'q</p>
          <span>Birinchi suhbatni boshlang</span>
        </div>`;
      return;
    }

    const now = Date.now();
    const DAY = 86400000;
    const groups: Record<'today' | 'yesterday' | 'week' | 'older', StoredChat[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    state.chats.forEach((c) => {
      if (q && !c.title.toLowerCase().includes(q)) return;
      const age = now - (c.updatedAt || c.createdAt || 0);
      if (age < DAY) groups.today.push(c);
      else if (age < 2 * DAY) groups.yesterday.push(c);
      else if (age < 7 * DAY) groups.week.push(c);
      else groups.older.push(c);
    });

    const labels = { today: 'Bugun', yesterday: 'Kecha', week: 'Oxirgi 7 kun', older: 'Eski' };
    let html = '';
    let total = 0;

    (['today', 'yesterday', 'week', 'older'] as const).forEach((key) => {
      if (!groups[key].length) return;
      total += groups[key].length;
      html += `<div class="chat-group"><div class="chat-group-label">${labels[key]}</div>`;
      groups[key].forEach((c) => {
        const active = c.id === state.currentChatId ? 'active' : '';
        html += `<button class="chat-item ${active}" data-chat-id="${c.id}">
          <span class="material-symbols-outlined">chat_bubble</span>
          <span class="chat-item-title">${esc(c.title)}</span>
          <span class="chat-item-delete" data-delete-id="${c.id}" title="O'chirish">
            <span class="material-symbols-outlined">close</span>
          </span>
        </button>`;
      });
      html += `</div>`;
    });

    if (!total) {
      html = `<div class="empty-history">
        <span class="material-symbols-outlined">search</span>
        <p>Suhbat topilmadi</p>
        <span>Boshqa so'z bilan urinib ko'ring</span>
      </div>`;
    }

    sidebarHist.innerHTML = html;

    sidebarHist.querySelectorAll<HTMLButtonElement>('.chat-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.chat-item-delete')) return;
        if (el.dataset.chatId) openChat(el.dataset.chatId);
      });
    });
    sidebarHist.querySelectorAll<HTMLElement>('.chat-item-delete').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.dataset.deleteId) deleteChat(el.dataset.deleteId);
      });
    });
  }

  function openChat(id: string) {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    state.currentChatId = id;
    state.history = chat.messages
      .filter((m) => m.type === 'text')
      .map((m) => ({ role: m.role, content: m.content }));
    messages.innerHTML = '';
    state.preview = null;
    state.previewOpen = false;
    if (!chat.messages.length) {
      renderHero();
    } else {
      let lastCodeMd = '';
      chat.messages.forEach((m) => {
        if (m.type === 'image') renderSavedImage(m.content, m.prompt || '');
        else {
          renderSavedText(m.role, m.content);
          if (m.role === 'assistant' && m.content.includes('```')) {
            lastCodeMd = m.content;
          }
        }
      });
      if (lastCodeMd) {
        applyPreviewFromMarkdown(lastCodeMd, { open: false });
      }
    }
    syncPreviewUI();
    renderSidebar();
    chatArea.scrollTop = chatArea.scrollHeight;
    if (window.innerWidth <= 768) closeSidebar();
    if (!input.disabled) input.focus();
  }

  function deleteChat(id: string) {
    if (state.pendingDeleteId !== id) {
      state.pendingDeleteId = id;
      toast("O'chirish uchun yana bosing");
      window.setTimeout(() => {
        if (state.pendingDeleteId === id) state.pendingDeleteId = null;
      }, 2600);
      return;
    }
    state.pendingDeleteId = null;
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.currentChatId === id) {
      state.currentChatId = null;
      state.history = [];
      state.preview = null;
      state.previewOpen = false;
      syncPreviewUI();
      messages.innerHTML = '';
      renderHero();
    }
    saveChats();
    renderSidebar();
    toast("Suhbat o'chirildi");
  }

  // ===== MESSAGE RENDERING =====
  function scrollBottom() {
    chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }

  function renderSavedText(role: 'user' | 'assistant', text: string): BodyEl {
    hideHero();
    const domRole = role === 'assistant' ? 'ai' : 'user';
    const msg = document.createElement('div');
    msg.className = 'msg ' + domRole;
    let avatar: HTMLDivElement | null = null;
    if (domRole === 'ai') {
      avatar = document.createElement('div');
      avatar.className = 'msg-avatar ai';
      avatar.textContent = 'AI';
      msg.appendChild(avatar);
    }
    const body = document.createElement('div') as BodyEl;
    body.className = 'msg-body';
    if (domRole === 'ai') {
      body.innerHTML = md(text);
      body._raw = text;
    } else {
      body.textContent = text;
    }
    msg.appendChild(body);
    messages.appendChild(msg);
    body._avatar = avatar;
    return body;
  }

  function renderSavedImage(b64: string, promptText: string) {
    hideHero();
    const msg = document.createElement('div');
    msg.className = 'msg ai';
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar ai';
    avatar.textContent = 'AI';
    const body = document.createElement('div');
    body.className = 'msg-body image-body';
    const img = document.createElement('img');
    img.className = 'generated-image';
    img.src = 'data:image/png;base64,' + b64;
    img.alt = promptText || 'rasm';
    body.appendChild(img);
    if (promptText) {
      const cap = document.createElement('div');
      cap.className = 'image-caption';
      cap.textContent = '🎨 ' + promptText;
      body.appendChild(cap);
    }
    msg.appendChild(avatar);
    msg.appendChild(body);
    messages.appendChild(msg);
  }

  function streamInto(el: BodyEl, text: string): Promise<void> {
    return new Promise((resolve) => {
      const span = document.createElement('span');
      const cursor = document.createElement('span');
      cursor.className = 'typing-cursor';
      el.appendChild(span);
      el.appendChild(cursor);
      if (el._avatar) el._avatar.classList.add('typing');
      let i = 0;
      function frame() {
        if (state.abort && state.abort.signal.aborted) {
          cursor.remove();
          if (el._avatar) el._avatar.classList.remove('typing');
          resolve();
          return;
        }
        i = Math.min(text.length, i + 4);
        el._raw = text.slice(0, i);
        span.innerHTML = md(el._raw);
        const near = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 150;
        if (near) chatArea.scrollTop = chatArea.scrollHeight;
        if (i < text.length) requestAnimationFrame(frame);
        else {
          cursor.remove();
          if (el._avatar) el._avatar.classList.remove('typing');
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function appendImagePlaceholder(promptText: string): BodyEl {
    hideHero();
    const msg = document.createElement('div');
    msg.className = 'msg ai';
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar ai typing';
    avatar.textContent = 'AI';
    const body = document.createElement('div') as BodyEl;
    body.className = 'msg-body image-body';
    body.innerHTML = `
      <div class="forge">
        <div class="forge-mesh"><i></i><i></i><i></i></div>
        <div class="forge-grid"></div><div class="forge-scan"></div>
        <div class="forge-core"><div class="forge-ring"></div><div class="forge-ring r2"></div><span class="forge-pct">0%</span></div>
        <div class="forge-text"><b>Tasavvur yig'ilmoqda…</b></div>
        <div class="forge-prompt">${esc(promptText)}</div>
      </div>`;
    msg.appendChild(avatar);
    msg.appendChild(body);
    messages.appendChild(msg);
    scrollBottom();
    body._avatar = avatar;
    body._prompt = promptText;
    startForge(body);
    return body;
  }

  function replaceWithImage(body: BodyEl, b64: string, promptText: string) {
    logReq({ mode: 'image', text: promptText, ok: true });
    if (body._avatar) body._avatar.classList.remove('typing');
    body.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'generated-image';
    img.src = 'data:image/png;base64,' + b64;
    img.alt = promptText;
    body.appendChild(img);
    const cap = document.createElement('div');
    cap.className = 'image-caption';
    cap.textContent = '🎨 ' + promptText;
    body.appendChild(cap);
    scrollBottom();
  }

  function replaceWithError(body: BodyEl, err: string) {
    logReq({ mode: 'image', text: body._prompt || '', ok: false, err });
    if (body._avatar) body._avatar.classList.remove('typing');
    body.innerHTML = '';
    body.className = 'msg-body';
    body.textContent = '⚠️ Rasm xatosi: ' + err;
  }

  // ===== MODE =====
  function setInputMode(mode: InputMode) {
    if (!MODE_CONFIG[mode]) return;
    state.inputMode = mode;
    document.documentElement.dataset.mode = mode;
    const sendIcon = sendBtn.querySelector('.material-symbols-outlined');
    if (sendIcon) {
      sendIcon.textContent =
        mode === 'image' ? 'brush' : mode === 'code' ? 'terminal' : 'arrow_upward';
    }
    modeTabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    input.placeholder = MODE_CONFIG[mode].placeholder;
    composerNote.textContent = MODE_CONFIG[mode].note;
    updateLimitUI();
    if (!input.disabled) input.focus();
  }
  modeTabs.forEach((t) =>
    t.addEventListener('click', () => {
      const m = t.dataset.mode as InputMode;
      if (m) setInputMode(m);
    })
  );

  // Code Stack buttons
  if (codeStackRow) {
    codeStackRow.querySelectorAll<HTMLButtonElement>('.cs-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = (btn.dataset.stack || 'auto') as CodeStack;
        state.codeStack = s;
        codeStackRow
          .querySelectorAll<HTMLButtonElement>('.cs-btn')
          .forEach((b) => b.classList.toggle('on', b.dataset.stack === s));
      });
    });
  }

  // File attach into prompt
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const ext = file.name.split('.').pop() || 'txt';
        const snippet = content.slice(0, 14000);
        const prefix = input.value.trim() ? input.value.trim() + '\n\n' : '';
        input.value = `${prefix}Fayl (${file.name}):\n\`\`\`${ext}\n${snippet}\n\`\`\`\n`;
        if (/\.(py|js|ts|tsx|jsx|html|css|json)$/i.test(file.name)) {
          setInputMode('code');
        }
        autoResize();
        sendBtn.disabled = !input.value.trim();
        toast(`"${file.name}" qo'shildi`);
      } catch {
        toast("Faylni o'qib bo'lmadi");
      } finally {
        fileInput.value = '';
      }
    });
  }

  // ===== AUTH =====
  function setAuthMode(mode: 'login' | 'register') {
    state.authMode = mode;
    authTabs.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    const lbl = authBtn.querySelector('.btn-label');
    if (mode === 'register') {
      nameField.hidden = false;
      authName.required = true;
      if (lbl) lbl.textContent = "Ro'yxatdan o'tish";
    } else {
      nameField.hidden = true;
      authName.required = false;
      if (lbl) lbl.textContent = 'Kirish';
    }
  }
  authTabs.forEach((t) =>
    t.addEventListener('click', () => setAuthMode(t.dataset.mode === 'register' ? 'register' : 'login'))
  );

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const pass = authPass.value;
    const name = authName.value.trim();
    if (!email) {
      authEmail.focus();
      toast('Email yoki telefonni kiriting');
      return;
    }
    if (pass.length < 4) {
      authPass.focus();
      toast('Parol kamida 4 belgi');
      return;
    }
    if (state.authMode === 'register' && !name) {
      authName.focus();
      toast('Ismingizni kiriting');
      return;
    }

    authBtn.classList.add('loading');
    authBtn.disabled = true;
    setTimeout(() => {
      const displayName = name || email.split('@')[0] || 'Foydalanuvchi';
      state.user = {
        name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
        email,
        plan: 'standard',
        messagesLeft: LIMITS.standard,
        imagesLeft: IMG_LIMITS.standard,
        codeTokensLeft: CODE_LIMITS.standard,
        day: today(),
      };
      saveUser();
      authBtn.classList.remove('loading');
      authBtn.disabled = false;
      enterApp();
    }, 600);
  });

  // ===== APP ENTRY =====
  function enterApp() {
    localStorage.setItem('olmabek_seen', '1');
    landing.classList.remove('show');
    authScreen.classList.remove('show');
    appScreen.classList.remove('hidden');
    appScreen.classList.add('flex');
    updateUserUI();
    updateLimitUI();
    renderSidebar();
    setInputMode('chat');
    messages.innerHTML = '';
    state.preview = null;
    state.previewOpen = false;
    syncPreviewUI();
    renderHero();
    setTimeout(() => input.focus(), 100);
  }

  function updateUserUI() {
    if (!state.user) return;
    userNameEl.textContent = state.user.name;
    userAvatar.textContent = state.user.name.charAt(0).toUpperCase();
    userPlanEl.textContent = state.isAdmin ? 'Admin' : PLANS[state.user.plan]?.name || 'Standart';
    const np = state.isAdmin
      ? ((localStorage.getItem(ADMIN_PLAN_KEY) || 'ultra') as PlanTier)
      : state.user.plan || 'standard';
    if (document.documentElement.dataset.plan !== np) {
      document.documentElement.dataset.plan = np;
      appScreen.classList.remove('plan-switch');
      void appScreen.offsetWidth;
      appScreen.classList.add('plan-switch');
      const hh = document.getElementById('hero');
      if (hh) {
        hh.remove();
        renderHero();
      }
    }
    syncSkin();
  }

  function syncMeteors(on: boolean) {
    const amb = document.querySelector<HTMLElement>('.ambient');
    if (!amb || amb.dataset.meteors === String(on)) return;
    amb.dataset.meteors = String(on);
    amb.querySelectorAll('.meteor').forEach((m) => m.remove());
    if (!on) return;
    for (let i = 0, n = window.innerWidth < 700 ? 3 : 7; i < n; i++) {
      const m = document.createElement('span');
      m.className = 'meteor';
      m.style.left = 30 + Math.random() * 70 + '%';
      m.style.top = Math.random() * 35 + '%';
      m.style.animationDelay = Math.random() * 9 + 's';
      m.style.animationDuration = 5 + Math.random() * 5 + 's';
      amb.appendChild(m);
    }
  }

  function updateLimitUI() {
    if (!state.user) return;
    const plan = state.user.plan || 'standard';
    const left = state.user.messagesLeft;
    const cLeft = typeof state.user.codeTokensLeft === 'number' ? state.user.codeTokensLeft : CODE_LIMITS[plan];
    const isAdmin = state.isAdmin;

    if (codeTokenHud) {
      codeTokenHud.textContent = isAdmin
        ? 'Cheksiz token (Admin)'
        : `${cLeft.toLocaleString('en-US')} / ${CODE_LIMITS[plan].toLocaleString('en-US')} token`;
    }

    if (isAdmin) {
      limitText.textContent = 'Admin';
      limitBadge.classList.remove('warn', 'locked');
      limitBadge.classList.add('admin');
    } else if (state.inputMode === 'code') {
      if (cLeft <= 0) {
        limitText.textContent = 'Code token tugadi';
        limitBadge.classList.remove('warn', 'admin');
        limitBadge.classList.add('locked');
      } else {
        limitText.textContent = `${formatCompactTokens(cLeft)} code token`;
        limitBadge.classList.remove('warn', 'locked', 'admin');
      }
    } else if (plan === 'ultra') {
      limitText.textContent = `Cheksiz · ${formatCompactTokens(cLeft)} code · ${state.user.imagesLeft} rasm`;
      limitBadge.classList.remove('warn', 'locked', 'admin');
    } else if (left <= 0) {
      limitText.textContent = 'Limit tugadi';
      limitBadge.classList.remove('warn', 'admin');
      limitBadge.classList.add('locked');
    } else if (left <= 1) {
      limitText.textContent = `${left} xabar · ${state.user.imagesLeft} rasm`;
      limitBadge.classList.remove('admin', 'locked');
      limitBadge.classList.add('warn');
    } else {
      limitText.textContent = `${left} xabar · ${formatCompactTokens(cLeft)} code`;
      limitBadge.classList.remove('warn', 'locked', 'admin');
    }

    const isChatLocked = !isAdmin && state.inputMode === 'chat' && left <= 0 && plan !== 'ultra';
    const isCodeLocked = !isAdmin && state.inputMode === 'code' && cLeft <= 0;
    const isLocked = isChatLocked || isCodeLocked;

    if (isLocked) {
      composerInner.classList.add('locked');
      input.disabled = true;
      sendBtn.disabled = true;
    } else {
      composerInner.classList.remove('locked');
      input.disabled = false;
      sendBtn.disabled = !input.value.trim();
    }
    adminBar.classList.toggle('visible', isLocked);
    const unlimited = isAdmin || plan === 'ultra';
    const mp = unlimited ? 100 : Math.max(0, Math.min(100, (left / (LIMITS[plan] || 25)) * 100));
    const ip = isAdmin
      ? 100
      : Math.max(0, Math.min(100, (state.user.imagesLeft / (IMG_LIMITS[plan] || 8)) * 100));
    document.documentElement.style.setProperty('--msg', mp.toFixed(1));
    document.documentElement.style.setProperty('--img', ip.toFixed(1));
  }

  // ===== INPUT =====
  function autoResize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }
  input.addEventListener('input', () => {
    autoResize();
    if (!state.isSending) sendBtn.disabled = !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.inputMode === 'image') generateImage();
      else sendMessage();
    }
  });
  sendBtn.addEventListener('click', () => {
    if (state.isSending) {
      stopGeneration();
      return;
    }
    if (state.inputMode === 'image') generateImage();
    else sendMessage();
  });

  // ===== SYNTAX HIGHLIGHT =====
  const KW =
    /^(?:def|class|return|if|elif|else|for|while|do|import|from|as|in|not|and|or|is|None|True|False|try|except|finally|with|lambda|pass|break|continue|yield|async|await|function|const|let|var|new|this|self|null|undefined|true|false|switch|case|default|export|throw|catch|typeof|void|static|public|private|protected|int|float|double|string|bool|char|long|struct|enum|interface|type|extends|implements|package|using|namespace|fn|pub|mut|impl|match|go|func|print|echo|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|CREATE|TABLE|INTO|VALUES|ORDER|BY|GROUP|LIMIT)$/;
  function hl(code: string, lang: string): string {
    const hash = /^(py|python|sh|bash|shell|zsh|yaml|yml|rb|ruby|r|toml|dockerfile)$/i.test(lang || '')
      ? '|#[^\\n]*'
      : '';
    const re = new RegExp(
      '(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|<!--[\\s\\S]*?-->|--[^\\n]*(?=\\n|$)' +
        hash +
        ')|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_]\\w*)(?=\\s*\\()|(\\b[A-Za-z_]\\w*\\b)',
      'g'
    );
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      let cls = '';
      if (m[1]) cls = 'c';
      else if (m[2]) cls = 's';
      else if (m[3]) cls = 'n';
      else if (m[4]) cls = KW.test(m[4]) ? 'k' : 'f';
      else if (m[5] && KW.test(m[5])) cls = 'k';
      out += cls ? '<span class="tk-' + cls + '">' + esc(m[0]) + '</span>' : esc(m[0]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  // ===== MARKDOWN =====
  function md(t: string): string {
    t = String(t == null ? '' : t);
    if ((t.match(/```/g) || []).length % 2) t += '\n```';
    const codes: Array<{ l: string; c: string }> = [];
    t = t.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_m, l: string, c: string) => {
      codes.push({ l, c: c.replace(/\n$/, '') });
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    t = esc(t);
    t = t
      .replace(/`([^`\n]+)`/g, '<code class="ic">$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/^(#{1,3}) (.+)$/gm, (_m, h: string, x: string) => `<span class="md-h md-h${h.length}">${x}</span>`)
      .replace(/^(?:- |\* )(.+)$/gm, '<span class="md-li">$1</span>')
      .replace(/^(\d+)\. (.+)$/gm, '<span class="md-li"><b>$1.</b>$2</span>');
    t = t.replace(/(<\/(?:span|div)>)\n/g, '$1');
    t = t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => {
      const c = codes[Number(i)];
      return (
        '<div class="code"><div class="code-head"><i>' +
        esc(c.l || 'kod') +
        '</i><div class="code-actions"><button type="button" class="code-preview-btn">Preview</button><button type="button" class="code-copy">Nusxalash</button></div></div><pre><code>' +
        hl(c.c, c.l) +
        '</code></pre></div>'
      );
    });
    return t.replace(/(<\/pre><\/div>)\n/g, '$1');
  }

  messages.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const copyBtn = target.closest<HTMLButtonElement>('.code-copy');
    if (copyBtn) {
      const txt = copyBtn.closest('.code')?.querySelector('code')?.innerText || '';
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(() => {
          copyBtn.textContent = 'Nusxalandi ✓';
          setTimeout(() => (copyBtn.textContent = 'Nusxalash'), 1600);
        })
        .catch(() => toast("Nusxalab bo'lmadi"));
      return;
    }

    const pvBtn = target.closest<HTMLButtonElement>('.code-preview-btn');
    if (pvBtn) {
      const msgBody = pvBtn.closest('.msg-body') as BodyEl | null;
      const codeBox = pvBtn.closest('.code');
      const rawMarkdown = msgBody?._raw;
      if (rawMarkdown && applyPreviewFromMarkdown(rawMarkdown, { open: true })) {
        return;
      }
      const codeTxt = codeBox?.querySelector('code')?.innerText || '';
      const lang = codeBox?.querySelector('.code-head i')?.textContent?.trim() || 'html';
      if (codeTxt) {
        applyPreviewFromMarkdown(`\`\`\`${lang}\n${codeTxt}\n\`\`\``, { open: true });
      }
    }
  });

  // ===== IMAGE FORGE =====
  function startForge(body: BodyEl) {
    const P = [
      "Tasavvur yig'ilmoqda",
      'Ranglar aralashmoqda',
      'Shakl chizilmoqda',
      "Yorug'lik qo'shilmoqda",
      'Detallar silliqlanmoqda',
    ];
    let p = 0;
    let k = 0;
    const iv = window.setInterval(() => {
      const pc = body.querySelector('.forge-pct');
      if (!pc) {
        window.clearInterval(iv);
        return;
      }
      p += (94 - p) * 0.045;
      pc.textContent = Math.round(p) + '%';
      const forge = body.querySelector<HTMLElement>('.forge');
      if (forge) forge.style.setProperty('--fp', p.toFixed(1));
      k++;
      if (k % 22 === 0) {
        const b = body.querySelector('.forge-text b');
        if (b) b.textContent = P[(k / 22) % P.length] + '…';
      }
    }, 90);
  }

  // ===== ULTRA EXTRAS: image styles · deep thinking · export =====
  const isUltra = () => document.documentElement.dataset.plan === 'ultra';
  function needUltra() {
    if (isUltra()) return true;
    toast('Bu imkoniyat faqat Ultra tarifida');
    openModal();
    return false;
  }
  const styleRow = document.createElement('div');
  styleRow.id = 'styleRow';
  styleRow.innerHTML =
    '<span class="sr-label">✦ Ultra uslubi</span>' +
    STYLES.map((x, i) => '<button type="button" data-s="' + i + '">' + x[0] + '</button>').join('');
  composerInner.before(styleRow);
  styleRow.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !needUltra()) return;
    const i = Number(b.dataset.s);
    state.style = state.style === i ? null : i;
    styleRow
      .querySelectorAll('button')
      .forEach((x) => x.classList.toggle('on', Number(x.dataset.s) === state.style));
  });
  function withStyle(p: string) {
    return isUltra() && state.style != null ? p + ', ' + STYLES[state.style][1] : p;
  }
  function deepWrap(t: string) {
    return state.deep && isUltra()
      ? "Qadam-baqadam chuqur o'ylab, batafsil va aniq javob ber:\n\n" + t
      : t;
  }
  $('deepBtn').addEventListener('click', () => {
    if (!needUltra()) return;
    state.deep = !state.deep;
    $('deepBtn').classList.toggle('on', state.deep);
    toast(state.deep ? "Chuqur o'ylash yoqildi" : "Chuqur o'ylash o'chirildi");
  });
  $('exportBtn').addEventListener('click', () => {
    if (!needUltra()) return;
    if (!state.history.length) {
      toast("Yuklab olish uchun chat bo'sh");
      return;
    }
    const txt = state.history
      .map((m) => (m.role === 'user' ? '## Siz\n' : '## Olmabek AI\n') + m.content)
      .join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/markdown' }));
    a.download = 'olmabek-chat.md';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ===== STARFIELD ENGINE =====
  function Stars(canvas: HTMLCanvasElement, { density = 1 } = {}) {
    const ctx = canvas.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let stars: Array<{ x: number; y: number; r: number; z: number; p: number; s: number; hue: number }> = [];
    let raf = 0;
    let shoot: { x: number; y: number; l: number } | null = null;
    let mx = 0;
    let my = 0;
    let running = false;

    function size() {
      if (!ctx) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 8500 * density * (w < 700 ? 0.55 : 1));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.2,
        z: Math.random() * 0.9 + 0.1,
        p: Math.random() * 6.28,
        s: 0.6 + Math.random() * 1.6,
        hue: Math.random() < 0.2 ? 210 : Math.random() < 0.15 ? 285 : 0,
      }));
    }

    function frame(t: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin((t / 1000) * s.s + s.p));
        const x = (s.x + mx * s.z * 16 + w) % w;
        const y = (s.y + my * s.z * 16 + h) % h;
        ctx.globalAlpha = Math.min(1, a * s.z + 0.1);
        ctx.fillStyle = s.hue ? 'hsl(' + s.hue + ' 90% 80%)' : '#fff';
        ctx.beginPath();
        ctx.arc(x, y, s.r * s.z + 0.2, 0, 6.283);
        ctx.fill();
      }
      if (!reduce) {
        if (!shoot && Math.random() < 0.004)
          shoot = { x: w * 0.2 + Math.random() * w * 0.8, y: Math.random() * h * 0.4, l: 0 };
        if (shoot) {
          const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x + 63, shoot.y - 32);
          g.addColorStop(0, 'rgba(255,255,255,.95)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = 1;
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(shoot.x, shoot.y);
          ctx.lineTo(shoot.x + 63, shoot.y - 32);
          ctx.stroke();
          shoot.x -= 11;
          shoot.y += 5.8;
          if (++shoot.l > 80) shoot = null;
        }
      }
      if (running && !reduce) raf = requestAnimationFrame(frame);
    }
    return {
      start() {
        if (running) return;
        running = true;
        size();
        raf = requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
        if (ctx) ctx.clearRect(0, 0, w, h);
      },
      resize() {
        if (running) size();
      },
      setMouse(x: number, y: number) {
        mx = x;
        my = y;
      },
    };
  }

  // ===== LANDING =====
  if (authScreen.firstElementChild) {
    lnAuth.appendChild(authScreen.firstElementChild);
  }
  const lnStars = Stars($<HTMLCanvasElement>('lnCosmos'), { density: 1.25 });
  new MutationObserver(() => {
    if (landing.classList.contains('show')) lnStars.start();
    else lnStars.stop();
  }).observe(landing, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => lnStars.resize());
  document.addEventListener(
    'pointermove',
    (e) => lnStars.setMouse(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5),
    { passive: true }
  );
  function focusAuth(mode: 'login' | 'register') {
    setAuthMode(mode);
    lnAuth.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(
      () => (mode === 'register' ? authName : authEmail).focus({ preventScroll: true }),
      650
    );
  }
  document.querySelectorAll<HTMLElement>('.open-auth').forEach((b) =>
    b.addEventListener('click', () =>
      focusAuth(b.dataset.mode === 'login' ? 'login' : 'register')
    )
  );
  document.querySelectorAll<HTMLElement>('[data-scroll]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.scroll) $(a.dataset.scroll).scrollIntoView({ behavior: 'smooth' });
    })
  );
  $('lnAdmin').addEventListener('click', () => openAdminLogin());
  const revealIO = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
    { root: landing, threshold: 0.12 }
  );
  landing.querySelectorAll('.reveal').forEach((el) => revealIO.observe(el));

  // Jonli demo loop
  const DEMO: Array<[string, string]> = [
    [
      "Python'da sonlarni qo'shadigan funksiya yoz",
      "Mana tayyor funksiya:\n\n```python\ndef qosh(a, b):\n    return a + b\n\nprint(qosh(2, 3))  # 5\n```\nIstasangiz, uni batafsil tushuntirib beraman.",
    ],
    [
      "Kiyim do'konim uchun 3 ta Instagram g'oyasi ber",
      "**3 ta g'oya:**\n- Kunlik look: har kuni bitta kiyim uyg'unligi\n- Mijozlar fikri: haqiqiy sharhlar bilan reels\n- Orqa sahna: buyurtma qanday tayyorlanishi",
    ],
    [
      'Kechqurungi Registon rasmini chiz',
      'Rasm studiyasida tasvirlab bering, Olmabek chizib beradi. Ultra tarifida Kino, Anime va 3D uslublari ham bor.',
    ],
  ];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  (async function runDemo() {
    const body = $('demoBody');
    let i = 0;
    for (;;) {
      while (!landing.classList.contains('show')) await sleep(1000);
      const [q, a] = DEMO[i++ % DEMO.length];
      body.innerHTML = '';
      const u = document.createElement('div');
      u.className = 'dm-u';
      body.appendChild(u);
      for (let k = 1; k <= q.length; k++) {
        u.textContent = q.slice(0, k);
        await sleep(32);
      }
      await sleep(400);
      const t = document.createElement('div');
      t.className = 'think';
      t.innerHTML = '<i class="think-orb"></i><b>O\'ylamoqda…</b>';
      body.appendChild(t);
      await sleep(1400);
      t.remove();
      const r = document.createElement('div');
      r.className = 'dm-a';
      body.appendChild(r);
      for (let k = 3; k < a.length + 3; k += 3) {
        r.innerHTML = md(a.slice(0, k));
        await sleep(24);
      }
      await sleep(3800);
    }
  })();

  // ===== COSMIC ULTRA SKINS =====
  const ambientEl = document.querySelector('.ambient');
  const cosmosCv = document.createElement('canvas');
  cosmosCv.className = 'cosmos';
  const bhEl = document.createElement('div');
  bhEl.className = 'bh';
  bhEl.innerHTML = '<i class="bh-disk"></i><i class="bh-halo"></i><i class="bh-core"></i>';
  if (ambientEl) {
    ambientEl.appendChild(cosmosCv);
    ambientEl.appendChild(bhEl);
  }
  const stars = Stars(cosmosCv);
  const apStars = Stars($<HTMLCanvasElement>('apCosmos'), { density: 1.4 });
  function syncSkin() {
    const root = document.documentElement;
    const ultra = root.dataset.plan === 'ultra' && root.classList.contains('dark');
    const skin = localStorage.getItem(SKIN_KEY) || 'obsidian';
    root.dataset.skin = skin;
    if (ultra && skin !== 'obsidian') stars.start();
    else stars.stop();
    syncMeteors(ultra && skin === 'obsidian');
  }
  window.addEventListener('resize', () => {
    stars.resize();
    apStars.resize();
  });
  document.addEventListener(
    'pointermove',
    (e) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      stars.setMouse(nx, ny);
      apStars.setMouse(nx, ny);
    },
    { passive: true }
  );
  $('skinBtn').addEventListener('click', () => {
    if (!needUltra()) return;
    const cur = SKINS.findIndex((x) => x[0] === (localStorage.getItem(SKIN_KEY) || 'obsidian'));
    const next = SKINS[(cur + 1) % SKINS.length];
    localStorage.setItem(SKIN_KEY, next[0]);
    syncSkin();
    toast('Mavzu: ' + next[1]);
  });

  // ===== ADMIN ENTRY POINTS =====
  function openAdminLogin() {
    adminModal.classList.add('active');
    adminModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    adminEmail.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      openAdminLogin();
    }
  });
  const keysDown = new Set<string>();
  document.addEventListener('keydown', (e) => {
    keysDown.add(e.key.toLowerCase());
    const t = e.target as HTMLElement;
    if (/INPUT|TEXTAREA|SELECT/.test(t.tagName || '') || t.isContentEditable) return;
    if (e.shiftKey && keysDown.has('a') && keysDown.has('s')) {
      e.preventDefault();
      keysDown.clear();
      openAdminLogin();
    }
  });
  document.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keysDown.clear());
  window.addEventListener('hashchange', () => {
    if (location.hash === '#admin') openAdminLogin();
  });
  if (location.hash === '#admin') setTimeout(openAdminLogin, 400);

  // ===== ADMIN CENTRE =====
  const adminPanel = $<HTMLDivElement>('adminPanel');
  const PLAN_NOTE: Record<PlanTier, string> = {
    standard: '25 xabar · 25K Code token · 8 rasm / kun',
    pro: '150 xabar · 250K Code token · 20 rasm / kun · ustuvor javob',
    ultra: "Cheksiz xabar · 2M Code token (XHigh) · 80 rasm · barcha imkoniyatlar",
  };

  function logReq(entry: { mode: InputMode; text: string; ok: boolean; err?: string; tokens?: number }) {
    let list: RequestLogItem[] = [];
    try {
      list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    } catch {
      list = [];
    }
    list.unshift({
      t: Date.now(),
      u: state.user?.name || 'Mehmon',
      p: ((document.documentElement.dataset.plan || 'standard') as PlanTier),
      m: entry.mode,
      x: String(entry.text || '').slice(0, 90),
      ms: Math.round(performance.now() - (state.t0 || performance.now())),
      tokens: entry.tokens,
      ok: Boolean(entry.ok),
      e: entry.err || '',
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 300)));
    if (adminPanel.classList.contains('open')) renderAdmin();
  }

  function openAdminPanel() {
    landing.classList.remove('show');
    authScreen.classList.remove('show');
    adminPanel.classList.add('open');
    adminPanel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    applyAdminPlan((localStorage.getItem(ADMIN_PLAN_KEY) || 'ultra') as PlanTier);
  }
  function closeAdminPanel() {
    adminPanel.classList.remove('open');
    adminPanel.setAttribute('aria-hidden', 'true');
    apStars.stop();
    document.body.style.overflow = '';
    if (!state.user) landing.classList.add('show');
  }
  function applyAdminPlan(p: PlanTier) {
    localStorage.setItem(ADMIN_PLAN_KEY, p);
    document.documentElement.dataset.plan = p;
    syncSkin();
    if (state.user) updateUserUI();
    renderAdmin();
  }

  function countUp(el: HTMLElement, to: number) {
    const from = Number(el.dataset.v) || 0;
    el.dataset.v = String(to);
    if (from === to) {
      el.textContent = String(to);
      return;
    }
    const t0 = performance.now();
    const d = 900;
    (function f(t: number) {
      const k = Math.min(1, (t - t0) / d);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }

  function renderStats() {
    let list: RequestLogItem[] = [];
    try {
      list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    } catch {
      list = [];
    }
    const n = list.length;
    const chatCount = list.filter((x) => x.m === 'chat').length;
    const codeCount = list.filter((x) => x.m === 'code').length;
    const imgCount = list.filter((x) => x.m === 'image').length;
    const ok = list.filter((x) => x.ok).length;
    const ms = list.map((x) => x.ms).sort((a, b) => a - b);
    const avg = n ? Math.round(ms.reduce((a, b) => a + b, 0) / n) : 0;
    const p95 = n ? ms[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
    const K: Array<[string, number, string]> = [
      ["Jami so'rov", n, ''],
      ['Chat / Kod', chatCount + codeCount, ''],
      ['Rasm', imgCount, ''],
      ['Muvaffaqiyat', n ? Math.round((ok / n) * 100) : 0, '%'],
      ["O'rtacha", avg, ' ms'],
      ['P95', p95, ' ms'],
      ['Xatolar', n - ok, ''],
      ['Foydalanuvchilar', new Set(list.map((x) => x.u)).size, ''],
    ];
    const kp = $('apKpis');
    if (!kp.children.length) {
      kp.innerHTML = K.map(() => '<div class="kpi"><small></small><b><span>0</span><em></em></b></div>').join('');
    }
    K.forEach((k, i) => {
      const c = kp.children[i] as HTMLElement;
      const sm = c.querySelector('small');
      const em = c.querySelector('em');
      const sp = c.querySelector('span');
      if (sm) sm.textContent = k[0];
      if (em) em.textContent = k[2];
      if (sp) countUp(sp, k[1]);
    });

    const now = Date.now();
    const H = 12;
    const b = Array<number>(H).fill(0);
    list.forEach((x) => {
      const d = Math.floor((now - x.t) / 3600000);
      if (d >= 0 && d < H) b[H - 1 - d]++;
    });
    const mx = Math.max(1, ...b);
    $('chHours').innerHTML = b
      .map(
        (v, i) =>
          '<div class="bar" style="--h:' +
          Math.max(4, (v / mx) * 100) +
          '%;animation-delay:' +
          i * 50 +
          'ms"><span>' +
          (v || '') +
          '</span><i>' +
          new Date(now - (H - 1 - i) * 3600000).getHours() +
          '</i></div>'
      )
      .join('');

    const P: Record<PlanTier, number> = { standard: 0, pro: 0, ultra: 0 };
    const cols: Record<PlanTier, string> = {
      standard: '143 168 255',
      pro: '94 214 196',
      ultra: '216 200 255',
    };
    const names: Record<PlanTier, string> = { standard: 'Oddiy', pro: 'Pro', ultra: 'Ultra' };
    list.forEach((x) => {
      const tierKey = x.p in P ? x.p : 'standard';
      P[tierKey] = (P[tierKey] || 0) + 1;
    });
    let acc = 0;
    const segs = (Object.keys(P) as PlanTier[]).map((k) => {
      const a = acc;
      acc += (P[k] / (n || 1)) * 100;
      return 'rgb(' + cols[k] + ') ' + a + '% ' + acc + '%';
    });
    $('chPlan').style.background = n
      ? 'conic-gradient(' + segs.join(',') + ')'
      : 'rgb(255 255 255 / .08)';
    $('chPlanLeg').innerHTML = (Object.keys(P) as PlanTier[])
      .map(
        (k) =>
          '<span><i style="background:rgb(' +
          cols[k] +
          ')"></i>' +
          names[k] +
          '<em>' +
          P[k] +
          '</em></span>'
      )
      .join('');

    const L = list.slice(0, 30).reverse();
    const svg = $('chLat');
    if (L.length < 2) {
      svg.innerHTML =
        '<text x="200" y="64" text-anchor="middle" fill="currentColor" opacity=".4" font-size="12">Ma\'lumot yetarli emas</text>';
    } else {
      const lm = Math.max(1, ...L.map((x) => x.ms));
      const pts = L.map((x, i) => [(i / (L.length - 1)) * 400, 112 - (x.ms / lm) * 100]);
      const d = pts
        .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
        .join(' ');
      svg.innerHTML =
        '<defs><linearGradient id="lgA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:rgb(var(--c-secondary));stop-opacity:.4"/><stop offset="1" style="stop-color:rgb(var(--c-secondary));stop-opacity:0"/></linearGradient></defs><path d="' +
        d +
        ' L400 120 L0 120Z" fill="url(#lgA)"/><path class="ln" d="' +
        d +
        '"/>';
    }
    const U: Record<string, number> = {};
    list.forEach((x) => {
      U[x.u] = (U[x.u] || 0) + 1;
    });
    const top = Object.entries(U)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    $('chTop').innerHTML = top.length
      ? top
          .map(
            ([u, c]) =>
              '<div><span>' +
              esc(u) +
              '</span><b>' +
              c +
              '</b><i style="--w:' +
              (c / top[0][1]) * 100 +
              '%"></i></div>'
          )
          .join('')
      : '<div class="empty-feed">Hali ma\'lumot yo\'q</div>';
  }

  function renderSkinSeg() {
    const sk = localStorage.getItem(SKIN_KEY) || 'obsidian';
    adminPanel
      .querySelectorAll<HTMLButtonElement>('#apSkin button')
      .forEach((b) => b.classList.toggle('on', b.dataset.askin === sk));
  }

  function renderAdmin() {
    const p = (localStorage.getItem(ADMIN_PLAN_KEY) || 'ultra') as PlanTier;
    adminPanel
      .querySelectorAll<HTMLButtonElement>('#apSeg button')
      .forEach((b) => b.classList.toggle('on', b.dataset.aplan === p));
    $('apPlanNote').textContent = PLAN_NOTE[p];
    const off = localStorage.getItem(AI_OFF_KEY) === '1';
    $('aiToggle').classList.toggle('on', !off);
    $('aiState').textContent = off ? "AI o'chirilgan" : 'AI yoqilgan';
    $('aiHint').textContent = off
      ? "Foydalanuvchilar javob ololmaydi (faqat shu brauzerda)"
      : 'Foydalanuvchilar chat, kod va rasm yarata oladi';
    let list: RequestLogItem[] = [];
    try {
      list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    } catch {
      list = [];
    }
    $('stReq').textContent = String(list.length);
    $('stErr').textContent = String(list.filter((x) => !x.ok).length);
    $('stLat').textContent = String(
      list.length ? Math.round(list.reduce((a, x) => a + x.ms, 0) / list.length) : 0
    );
    const PL: Record<PlanTier, string> = { standard: 'Oddiy', pro: 'Pro', ultra: 'Ultra' };
    $('reqFeed').innerHTML = list.length
      ? list
          .slice(0, 12)
          .map((x) => {
            const icon = x.m === 'image' ? 'brush' : x.m === 'code' ? 'code' : 'chat';
            return (
              '<div class="fd' +
              (x.ok ? '' : ' bad') +
              '"><span class="material-symbols-outlined">' +
              icon +
              '</span><div><b>' +
              esc(x.u) +
              '<em>' +
              (PL[x.p] || x.p) +
              ' · ' +
              new Date(x.t).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) +
              '</em></b><span class="tx">' +
              esc(x.ok ? x.x : '⚠ ' + (x.e || '')) +
              '</span></div><small>' +
              x.ms +
              ' ms</small></div>'
            );
          })
          .join('')
      : '<div class="empty-feed">Hali so\'rov yo\'q. Chatga o\'tib savol bering.</div>';
    renderStats();
    renderSkinSeg();
  }

  $('apSeg').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b?.dataset.aplan) applyAdminPlan(b.dataset.aplan as PlanTier);
  });
  $('aiToggle').addEventListener('click', () => {
    const off = localStorage.getItem(AI_OFF_KEY) === '1';
    if (off) localStorage.removeItem(AI_OFF_KEY);
    else localStorage.setItem(AI_OFF_KEY, '1');
    renderAdmin();
  });
  $('logClear').addEventListener('click', () => {
    localStorage.removeItem(LOG_KEY);
    renderAdmin();
  });
  $('apChat').addEventListener('click', () => {
    if (!state.user) {
      state.user = {
        name: 'Admin',
        email: 'admin',
        plan: 'ultra',
        messagesLeft: 999999,
        imagesLeft: 999,
        codeTokensLeft: CODE_LIMITS.ultra,
        day: today(),
      };
    }
    closeAdminPanel();
    enterApp();
  });
  $('apExit').addEventListener('click', () => {
    state.isAdmin = false;
    localStorage.removeItem(ADMIN_KEY);
    document.documentElement.dataset.plan = (state.user && state.user.plan) || 'standard';
    syncSkin();
    closeAdminPanel();
    if (state.user) {
      updateUserUI();
      updateLimitUI();
    }
  });
  $('apSkin').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.askin) return;
    localStorage.setItem(SKIN_KEY, b.dataset.askin);
    syncSkin();
    renderSkinSeg();
  });
  $('logDemo').addEventListener('click', () => {
    let list: RequestLogItem[] = [];
    try {
      list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    } catch {
      list = [];
    }
    const names = ['Sodiq', 'Aziza', 'Jasur', 'Malika', 'Bobur', 'Dilnoza'];
    const plans: PlanTier[] = ['standard', 'standard', 'pro', 'ultra'];
    const modes: InputMode[] = ['chat', 'code', 'image'];
    const texts = [
      'Pomodoro taymer ilovasi',
      'Marketing rejasi tuz',
      'Kechqurungi Registon',
      "Python'da API server",
      'Bu xatoni tuzat',
      "Kiyim do'koni uchun g'oya",
    ];
    for (let i = 0; i < 60; i++) {
      const m = modes[Math.floor(Math.random() * modes.length)];
      list.push({
        t: Date.now() - Math.random() * 12 * 3600000,
        u: names[Math.floor(Math.random() * names.length)],
        p: plans[Math.floor(Math.random() * plans.length)],
        m,
        x: texts[Math.floor(Math.random() * texts.length)],
        ms: Math.round(m === 'image' ? 6000 + Math.random() * 9000 : 700 + Math.random() * 3200),
        ok: Math.random() > 0.07,
        e: 'Timeout',
      });
    }
    list.sort((a, b) => b.t - a.t);
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(0, 300)));
    renderAdmin();
    toast("Demo ma'lumot qo'shildi");
  });

  let diagBusy = false;
  $('diagRun').addEventListener('click', async () => {
    if (diagBusy) return;
    diagBusy = true;
    const btn = $<HTMLButtonElement>('diagRun');
    const list = $('diagList');
    const gauge = $('gauge');
    btn.disabled = true;
    btn.textContent = 'Tekshirilmoqda…';
    gauge.className = 'gauge';
    gauge.style.setProperty('--gp', '0');
    $('gaugeTxt').textContent = '…';
    const tmo = (ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), ms);
      return c.signal;
    };
    const steps: Array<[string, () => Promise<[string, string]>]> = [
      [
        'Tarmoq ulanishi',
        async () => {
          if (!navigator.onLine) throw new Error("Internet yo'q");
          return ['ok', 'Ulangan'];
        },
      ],
      [
        'Google AI Studio (Code/Chat)',
        async () => {
          const t = performance.now();
          const r = await fetch(API_BASE + '/api/health', { signal: tmo(10000) });
          const ms = Math.round(performance.now() - t);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const data = await r.json();
          if (!data.geminiConfigured) return ['warn', 'GEMINI_API_KEY kiritilmagan'];
          return ['ok', `${data.model || 'Gemini'} · ${ms} ms`];
        },
      ],
      [
        'Rasm serveri',
        async () => {
          const r = await fetch(API_BASE + '/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: tmo(15000),
          });
          if (r.status === 404) throw new Error('Topilmadi (404)');
          return ['ok', 'Mavjud'];
        },
      ],
      [
        'Brauzer xotirasi',
        async () => {
          localStorage.setItem('_t', '1');
          localStorage.removeItem('_t');
          return ['ok', 'Ishlaydi'];
        },
      ],
      ['Ovozli yozish', async () => (SR ? ['ok', "Qo'llab-quvvatlanadi"] : ['warn', "Bu brauzerda yo'q"])],
    ];
    list.innerHTML = steps
      .map(
        (x) =>
          '<div class="dg"><span class="material-symbols-outlined">radio_button_unchecked</span><div><b>' +
          x[0] +
          '</b><small>Kutilmoqda</small></div></div>'
      )
      .join('');
    const rows = list.querySelectorAll('.dg');
    let score = 0;
    for (let i = 0; i < steps.length; i++) {
      rows[i].className = 'dg run';
      const iconEl = rows[i].querySelector('.material-symbols-outlined');
      const smallEl = rows[i].querySelector('small');
      if (iconEl) iconEl.textContent = 'progress_activity';
      if (smallEl) smallEl.textContent = 'Tekshirilmoqda…';
      await sleep(350);
      let res: [string, string];
      try {
        res = await steps[i][1]();
      } catch (err) {
        const e = err as Error;
        res = [
          'fail',
          e.name === 'AbortError'
            ? 'Vaqt tugadi'
            : e.message === 'Failed to fetch'
              ? "Ulanib bo'lmadi"
              : e.message,
        ];
      }
      rows[i].className = 'dg ' + res[0];
      const iconMap: Record<string, string> = { ok: 'check_circle', warn: 'warning', fail: 'cancel' };
      if (iconEl) iconEl.textContent = iconMap[res[0]] || 'info';
      if (smallEl) smallEl.textContent = res[1];
      score += res[0] === 'ok' ? 1 : res[0] === 'warn' ? 0.6 : 0;
      gauge.style.setProperty('--gp', ((score / steps.length) * 100).toFixed(1));
    }
    const pct = Math.round((score / steps.length) * 100);
    $('gaugeTxt').textContent = pct + '%';
    gauge.classList.add(pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad');
    toast(pct >= 80 ? "Tizim sog'lom" : pct >= 50 ? "Ba'zi muammolar bor" : 'Jiddiy muammolar bor');
    btn.disabled = false;
    btn.textContent = 'Qayta tekshirish';
    diagBusy = false;
  });

  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      adminPanel.classList.contains('open') &&
      !adminModal.classList.contains('active')
    ) {
      closeAdminPanel();
    }
  });

  // ===== STOP / STREAM =====
  function setStopUI(on: boolean) {
    if (on) state.t0 = performance.now();
    sendBtn.classList.toggle('is-stop', on);
    const ic = sendBtn.querySelector('.material-symbols-outlined');
    if (ic) {
      ic.textContent = on
        ? 'stop'
        : state.inputMode === 'image'
          ? 'brush'
          : state.inputMode === 'code'
            ? 'terminal'
            : 'arrow_upward';
    }
    sendBtn.title = on ? "To'xtatish" : 'Yuborish';
  }
  function stopGeneration() {
    if (state.abort) state.abort.abort();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isSending && !modal.classList.contains('active')) {
      stopGeneration();
    }
  });

  async function streamReply(
    text: string,
    el: BodyEl,
    dots: DotsEl,
    signal: AbortSignal,
    mode: InputMode
  ): Promise<{ reply: string; tokensUsed: number; tokensLeft?: number }> {
    const plan = state.user?.plan || 'standard';
    const endpoint = mode === 'code' ? '/api/code/stream' : '/api/chat/stream';
    const payload = JSON.stringify({
      message: text,
      history: state.history.slice(-16),
      plan,
      deep: state.deep && isUltra(),
      mode,
      stack: state.codeStack,
      currentCode: mode === 'code' ? state.preview?.primaryCode : undefined,
      user_id: state.user?.email || 'guest',
      is_admin: state.isAdmin,
    });

    let res: Response | null = null;
    try {
      res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }

    if (res && res.ok && res.body) {
      const span = document.createElement('span');
      const cursor = document.createElement('span');
      cursor.className = 'typing-cursor';
      el.appendChild(span);
      el.appendChild(cursor);
      if (el._avatar) el._avatar.classList.add('typing');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let sseBuf = '';
      let fullText = '';
      let tokensUsed = 0;
      let tokensLeft: number | undefined;
      let first = true;
      let lastPreviewSync = 0;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += dec.decode(value, { stream: true });
          const parts = sseBuf.split('\n\n');
          sseBuf = parts.pop() || '';

          for (const part of parts) {
            const line = part
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!line) continue;
            const rawJson = line.slice(5).trim();
            if (!rawJson) continue;
            let evt: {
              type?: string;
              text?: string;
              error?: string;
              totalTokens?: number;
              tokensLeft?: number;
            };
            try {
              evt = JSON.parse(rawJson);
            } catch {
              continue;
            }
            if (evt.type === 'error') {
              throw new Error(evt.error || 'Server xatosi');
            }
            if (evt.type === 'chunk' && evt.text) {
              if (first) {
                window.clearInterval(dots._t);
                dots.remove();
                first = false;
              }
              fullText += evt.text;
              el._raw = fullText;
              span.innerHTML = md(fullText);
              if (chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 150) {
                chatArea.scrollTop = chatArea.scrollHeight;
              }
              if (mode === 'code' && performance.now() - lastPreviewSync > 900) {
                const ex = extractCodeArtifacts(fullText);
                if (ex.hasCode && ex.isRenderable) {
                  applyPreviewFromMarkdown(fullText, { open: true });
                  lastPreviewSync = performance.now();
                }
              }
            } else if (evt.type === 'usage') {
              if (typeof evt.totalTokens === 'number') tokensUsed = evt.totalTokens;
              if (typeof evt.tokensLeft === 'number') tokensLeft = evt.tokensLeft;
            }
          }
        }
      } finally {
        if (first) {
          window.clearInterval(dots._t);
          dots.remove();
        }
        cursor.remove();
        if (el._avatar) el._avatar.classList.remove('typing');
      }
      if (!tokensUsed && fullText) {
        tokensUsed = Math.max(1, Math.ceil(fullText.length / 3.5));
      }
      return { reply: fullText || "Javob bo'sh qaytdi.", tokensUsed, tokensLeft };
    }

    const syncRes = await getReply(text, signal, mode);
    window.clearInterval(dots._t);
    dots.remove();
    await streamInto(el, syncRes.reply);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return syncRes;
  }

  // ===== VOICE =====
  const micBtn = $<HTMLButtonElement>('micBtn');
  const winSpeech = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const SR = winSpeech.SpeechRecognition || winSpeech.webkitSpeechRecognition;
  let rec: SpeechRecognitionInstance | null = null;
  let listening = false;
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (!SR) {
        toast("Brauzer ovozli yozishni qo'llamaydi (Chrome tavsiya etiladi)");
        return;
      }
      if (listening && rec) {
        rec.stop();
        return;
      }
      rec = new SR();
      rec.lang = 'uz-UZ';
      rec.interimResults = true;
      const base = input.value;
      rec.onstart = () => {
        listening = true;
        micBtn.classList.add('listening');
        composerInner.classList.add('voice');
      };
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        input.value = (base ? base + ' ' : '') + t;
        autoResize();
        if (!state.isSending) sendBtn.disabled = !input.value.trim();
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') toast('Mikrofonga ruxsat bering');
        else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Ovoz xatosi: ' + e.error);
      };
      rec.onend = () => {
        listening = false;
        micBtn.classList.remove('listening');
        composerInner.classList.remove('voice');
        input.focus();
      };
      rec.start();
    });
  }

  // ===== CURSOR LIGHT =====
  document.addEventListener(
    'pointermove',
    (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(
        '.hero-chip, .view-pricing .grid > div, .ap-card, .ln-card, .hx-card, .ux'
      );
      if (t) {
        const r = t.getBoundingClientRect();
        t.style.setProperty('--mx', e.clientX - r.left + 'px');
        t.style.setProperty('--my', e.clientY - r.top + 'px');
      }
      document.documentElement.style.setProperty('--gx', e.clientX + 'px');
      document.documentElement.style.setProperty('--gy', e.clientY + 'px');
    },
    { passive: true }
  );

  // ===== AI CHAT / CODE =====
  async function getReply(
    text: string,
    signal: AbortSignal,
    mode: InputMode
  ): Promise<{ reply: string; tokensUsed: number; tokensLeft?: number }> {
    const plan = state.user?.plan || 'standard';
    const endpoint = mode === 'code' ? '/api/code' : '/api/chat';
    let res: Response;
    try {
      res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: state.history.slice(-16),
          plan,
          deep: state.deep && isUltra(),
          mode,
          stack: state.codeStack,
          currentCode: mode === 'code' ? state.preview?.primaryCode : undefined,
          user_id: state.user?.email || 'guest',
          is_admin: state.isAdmin,
        }),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new Error("Serverga ulanib bo'lmadi");
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.error || err.detail) detail = err.error || err.detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }
    const data = await res.json();
    const reply = data.reply || "Javob bo'sh qaytdi.";
    const tokensUsed = data.usage?.totalTokens || Math.ceil(reply.length / 3.5);
    const tokensLeft = typeof data.usage?.tokensLeft === 'number' ? data.usage.tokensLeft : undefined;
    return { reply, tokensUsed, tokensLeft };
  }

  async function sendMessage() {
    if (localStorage.getItem(AI_OFF_KEY) === '1' && !state.isAdmin) {
      toast("AI vaqtincha o'chirilgan");
      return;
    }
    if (state.isSending || !state.user) return;
    const mode = state.inputMode === 'code' ? 'code' : 'chat';

    if (mode === 'chat' && !state.isAdmin && state.user.messagesLeft <= 0 && state.user.plan !== 'ultra') {
      openModal({ fromLimit: true });
      return;
    }
    if (mode === 'code' && !state.isAdmin && state.user.codeTokensLeft <= 0) {
      toast('Bugungi Code token limiti tugadi');
      openModal({ fromLimit: true });
      return;
    }

    const text = input.value.trim();
    if (!text) return;

    state.isSending = true;
    input.value = '';
    autoResize();
    sendBtn.disabled = false;
    setStopUI(true);

    if (!getCurrentChat()) createChat(text);

    pushMessage('user', text, 'text', { mode });
    state.history.push({ role: 'user', content: text });
    renderSavedText('user', text);
    scrollBottom();

    if (!state.isAdmin && mode === 'chat') {
      state.user.messagesLeft = Math.max(0, state.user.messagesLeft - 1);
      saveUser();
    }
    updateLimitUI();
    renderSidebar();

    const aiBody = renderSavedText('assistant', '');
    const dots = document.createElement('div') as DotsEl;
    dots.className = 'think';
    dots.innerHTML = '<i class="think-orb"></i><b>O\'ylamoqda…</b>';
    const phrases =
      mode === 'code'
        ? ['Arxitektura tuzilmoqda…', 'Kodni yozmoqda…', 'Preview tayyorlanmoqda…']
        : state.deep
          ? ["Chuqur o'ylamoqda…", 'Variantlarni solishtirmoqda…', 'Xulosa tuzmoqda…']
          : ["O'ylamoqda…", 'Tahlil qilmoqda…', 'Javob yozmoqda…'];
    let pi = 0;
    dots._t = window.setInterval(() => {
      pi = (pi + 1) % phrases.length;
      const b = dots.querySelector('b');
      if (b) b.textContent = phrases[pi];
    }, 2200);
    aiBody.appendChild(dots);
    scrollBottom();

    state.abort = new AbortController();
    try {
      const promptText = mode === 'chat' ? deepWrap(text) : text;
      const { reply: full, tokensUsed, tokensLeft } = await streamReply(
        promptText,
        aiBody,
        dots,
        state.abort.signal,
        mode
      );

      if (!state.isAdmin && mode === 'code') {
        state.user.codeTokensLeft =
          typeof tokensLeft === 'number'
            ? Math.min(state.user.codeTokensLeft, tokensLeft)
            : Math.max(0, state.user.codeTokensLeft - tokensUsed);
        saveUser();
        updateLimitUI();
      }

      logReq({ mode, text, ok: true, tokens: tokensUsed });
      state.history.push({ role: 'assistant', content: full });
      pushMessage('assistant', full, 'text', { mode, tokensUsed });

      if (mode === 'code' || full.includes('```html') || full.includes('```jsx') || full.includes('```tsx')) {
        applyPreviewFromMarkdown(full, { open: true });
      }
    } catch (err) {
      window.clearInterval(dots._t);
      dots.remove();
      const error = err as Error;
      if (error.name === 'AbortError') {
        const partial = (aiBody._raw || '').trim();
        aiBody.querySelectorAll('.typing-cursor').forEach((c) => c.remove());
        if (aiBody._avatar) aiBody._avatar.classList.remove('typing');
        if (partial) {
          state.history.push({ role: 'assistant', content: partial });
          pushMessage('assistant', partial, 'text', { mode });
          if (mode === 'code') applyPreviewFromMarkdown(partial, { open: true });
        } else {
          aiBody.textContent = "To'xtatildi.";
        }
      } else {
        logReq({ mode, text, ok: false, err: error.message });
        const errMsg = '⚠️ Xatolik: ' + error.message;
        await streamInto(aiBody, errMsg);
        pushMessage('assistant', errMsg, 'text', { mode });
      }
    }

    state.isSending = false;
    state.abort = null;
    setStopUI(false);
    updateLimitUI();
    if (!input.disabled) {
      sendBtn.disabled = !input.value.trim();
      input.focus();
    } else {
      setTimeout(() => openModal({ fromLimit: true }), 400);
    }
  }

  // ===== IMAGE =====
  async function generateImage() {
    if (localStorage.getItem(AI_OFF_KEY) === '1' && !state.isAdmin) {
      toast("AI vaqtincha o'chirilgan");
      return;
    }
    if (state.isSending || !state.user) return;
    if (!state.isAdmin && state.user.imagesLeft <= 0) {
      toast('Bugungi rasm limiti tugadi');
      openModal({ fromLimit: true });
      return;
    }
    const promptText = input.value.trim();
    if (!promptText) {
      toast('Rasm uchun matn yozing');
      return;
    }

    state.isSending = true;
    input.value = '';
    autoResize();
    sendBtn.disabled = false;
    setStopUI(true);

    if (!getCurrentChat()) createChat(promptText);

    pushMessage('user', promptText, 'text', { mode: 'image' });
    state.history.push({ role: 'user', content: promptText });
    renderSavedText('user', promptText);
    scrollBottom();
    renderSidebar();

    if (!state.isAdmin) {
      state.user.imagesLeft = Math.max(0, state.user.imagesLeft - 1);
      saveUser();
    }
    updateLimitUI();

    const body = appendImagePlaceholder(promptText);
    state.abort = new AbortController();

    try {
      const res = await fetch(API_BASE + '/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: withStyle(promptText) }),
        signal: state.abort.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Xato');
      if (!data.image) throw new Error('Rasm qaytmadi');
      replaceWithImage(body, data.image, promptText);
      pushMessage('assistant', data.image, 'image', { prompt: promptText });
    } catch (err) {
      const e = err as Error;
      replaceWithError(body, e.name === 'AbortError' ? "To'xtatildi" : e.message);
    }

    state.isSending = false;
    state.abort = null;
    setStopUI(false);
    updateLimitUI();
    if (!input.disabled) {
      sendBtn.disabled = !input.value.trim();
      input.focus();
    }
  }

  // ===== NEW CHAT =====
  newChatBtn.addEventListener('click', () => {
    state.currentChatId = null;
    state.history = [];
    state.preview = null;
    state.previewOpen = false;
    syncPreviewUI();
    messages.innerHTML = '';
    input.value = '';
    autoResize();
    sendBtn.disabled = true;
    chatArea.scrollTop = 0;
    renderSidebar();
    newHero();
    if (window.innerWidth <= 768) closeSidebar();
    if (!input.disabled) input.focus();
    toast('Yangi chat boshlandi');
  });

  // ===== SIDEBAR =====
  function openSidebar() {
    sidebar.classList.add('open');
    if (window.innerWidth <= 768) sidebarOver.classList.add('show');
  }
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOver.classList.remove('show');
  }
  menuBtn.addEventListener('click', openSidebar);
  sidebarOver.addEventListener('click', closeSidebar);
  collapseBtn.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
    else sidebar.classList.toggle('collapsed');
  });

  // ===== MODAL =====
  function openModal({ fromLimit = false } = {}) {
    updateModalStatus(fromLimit);
    showModalView('pricing');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function updateModalStatus(fromLimit: boolean) {
    if (!state.user) return;
    currentPlan.textContent = PLANS[state.user.plan]?.name || 'Standart';
    const cLeft = state.user.codeTokensLeft ?? CODE_LIMITS[state.user.plan];
    currentLimit.textContent = state.isAdmin
      ? 'Cheksiz'
      : (state.user.plan === 'ultra' ? 'Cheksiz xabar' : state.user.messagesLeft + ' xabar') +
        ' · ' +
        formatCompactTokens(cLeft) +
        ' code · ' +
        state.user.imagesLeft +
        ' rasm';
    limitWarning.classList.toggle('hidden', !fromLimit);
    limitWarning.classList.toggle('flex', fromLimit);
  }
  function showModalView(view: string) {
    document.querySelectorAll('.modal-view').forEach((v) => v.classList.remove('active'));
    const t = document.querySelector('.view-' + view);
    if (t) t.classList.add('active');
  }
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
  });
  accountBtn.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeSidebar();
    openModal({ fromLimit: false });
  });

  // ===== PLAN =====
  document.querySelectorAll<HTMLButtonElement>('.plan-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.plan as PlanTier;
      if (k) selectPlan(k);
    });
  });
  function selectPlan(key: PlanTier) {
    const plan = PLANS[key];
    if (!plan || !state.user) return;
    if (state.user.plan === key) {
      toast('Bu tarif allaqachon faol');
      return;
    }
    state.selectedPlan = key;

    if (plan.price === 0) {
      state.user.plan = 'standard';
      state.user.messagesLeft = LIMITS.standard;
      state.user.imagesLeft = IMG_LIMITS.standard;
      state.user.codeTokensLeft = CODE_LIMITS.standard;
      delete state.user.trialEndsAt;
      saveUser();
      updateUserUI();
      updateLimitUI();
      closeModal();
      return;
    }

    payPlanName.textContent = plan.name;
    payPlanPrice.textContent = plan.displayPrice + " so'm / oy";
    showModalView('payment');
  }
  backBtn.addEventListener('click', () => {
    showModalView('pricing');
    updateModalStatus(false);
  });

  if (trialBtn) {
    trialBtn.addEventListener('click', () => {
      if (!state.selectedPlan || !state.user) return;
      const trialEnds = Date.now() + 2 * 24 * 60 * 60 * 1000;

      state.user.plan = state.selectedPlan;
      state.user.trialEndsAt = trialEnds;
      state.user.messagesLeft = LIMITS[state.selectedPlan];
      state.user.imagesLeft = IMG_LIMITS[state.selectedPlan];
      state.user.codeTokensLeft = CODE_LIMITS[state.selectedPlan];

      saveUser();
      updateUserUI();
      updateLimitUI();
      closeModal();
      planBurst(state.selectedPlan);
      toast('🎉 2 kunlik bepul sinov faollashdi!');
    });
  }

  function planBurst(key: PlanTier) {
    if (key === 'standard') return;
    const b = document.createElement('div');
    b.className = 'plan-burst';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      p.style.setProperty('--a', i * 15 + 'deg');
      p.style.setProperty('--d', 180 + Math.random() * 320 + 'px');
      p.style.animationDelay = Math.random() * 0.25 + 's';
      b.appendChild(p);
    }
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2200);
  }

  successBtn.addEventListener('click', () => {
    closeModal();
    if (!input.disabled) input.focus();
  });

  // ===== LOGOUT =====
  logoutBtn.addEventListener('click', () => {
    if (!state.pendingLogout) {
      state.pendingLogout = true;
      toast('Chiqish uchun yana bosing');
      window.setTimeout(() => {
        state.pendingLogout = false;
      }, 2600);
      return;
    }
    state.pendingLogout = false;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ADMIN_KEY);
    state.user = null;
    state.selectedPlan = null;
    state.isAdmin = false;
    state.history = [];
    state.currentChatId = null;
    state.preview = null;
    state.previewOpen = false;
    syncPreviewUI();
    messages.innerHTML = '';
    closeModal();
    appScreen.classList.add('hidden');
    appScreen.classList.remove('flex');
    landing.classList.add('show');
    authForm.reset();
    setAuthMode('login');
  });

  // ===== ADMIN MODAL =====
  adminBtn.addEventListener('click', () => {
    adminModal.classList.add('active');
    adminModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => adminSubmit.focus(), 200);
  });
  document.querySelectorAll('[data-admin-close]').forEach((el) => {
    el.addEventListener('click', () => {
      adminModal.classList.remove('active');
      adminModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      adminForm.reset();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && adminModal.classList.contains('active')) {
      adminModal.classList.remove('active');
      adminModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      adminForm.reset();
    }
  });
  adminForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (adminSubmit.classList.contains('loading')) return;
    const em = adminEmail.value.trim();
    const pw = adminPass.value;
    adminSubmit.classList.add('loading');
    adminSubmit.disabled = true;
    setTimeout(() => {
      const ok = em === ADMIN_USER && pw === ADMIN_PASS;
      adminSubmit.classList.remove('loading');
      adminSubmit.disabled = false;
      if (ok) {
        state.isAdmin = true;
        localStorage.setItem(ADMIN_KEY, 'true');
        adminModal.classList.remove('active');
        adminModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        adminForm.reset();
        if (modal.classList.contains('active')) closeModal();
        if (state.user) {
          updateUserUI();
          updateLimitUI();
        }
        openAdminPanel();
      } else {
        toast("Login yoki parol noto'g'ri");
        adminPass.value = '';
        adminPass.focus();
      }
    }, 400);
  });

  // ===== THEME =====
  function initTheme() {
    const html = document.documentElement;
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light') html.classList.remove('dark');
    else html.classList.add('dark');

    $('themeToggle').addEventListener('click', () => {
      html.classList.toggle('dark');
      localStorage.setItem(THEME_KEY, html.classList.contains('dark') ? 'dark' : 'light');
      syncSkin();
    });
  }

  // ===== INIT =====
  function init() {
    initTheme();
    const searchInput = document.getElementById('chatSearch');
    if (searchInput) searchInput.addEventListener('input', renderSidebar);

    if (localStorage.getItem(ADMIN_KEY) === 'true') state.isAdmin = true;
    state.chats = loadChats();

    const saved = loadUser();
    if (saved && saved.email) {
      state.user = saved;
      if (!PLANS[state.user.plan]) state.user.plan = 'standard';

      if (state.user.trialEndsAt && Date.now() > state.user.trialEndsAt) {
        toast("Sinov muddati tugadi. Iltimos, tarifni xarid qiling.");
        state.user.plan = 'standard';
        delete state.user.trialEndsAt;
        state.user.messagesLeft = LIMITS.standard;
        state.user.imagesLeft = IMG_LIMITS.standard;
        state.user.codeTokensLeft = CODE_LIMITS.standard;
        saveUser();
      } else if (
        state.user.day !== today() ||
        typeof state.user.imagesLeft !== 'number' ||
        typeof state.user.codeTokensLeft !== 'number'
      ) {
        state.user.messagesLeft = LIMITS[state.user.plan] || 25;
        state.user.imagesLeft = IMG_LIMITS[state.user.plan];
        state.user.codeTokensLeft = CODE_LIMITS[state.user.plan];
        state.user.day = today();
        saveUser();
      } else if (typeof state.user.messagesLeft !== 'number') {
        state.user.messagesLeft = LIMITS[state.user.plan];
      }
      enterApp();
    } else {
      landing.classList.add('show');
      setAuthMode(localStorage.getItem('olmabek_seen') ? 'login' : 'register');
    }
    setInputMode('chat');
  }

  init();
})();
