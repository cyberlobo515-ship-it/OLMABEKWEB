export type PlanTier = "standard" | "pro" | "ultra";
export type InputMode = "chat" | "image" | "code";
export type UltraSkin = "obsidian" | "galaxy" | "blackhole";
export type CodeStack = "auto" | "html" | "react" | "python";

export interface PlanConfig {
  id: PlanTier;
  name: string;
  tagline: string;
  price: number;
  displayPrice: string;
  messagesPerDay: number;
  imagesPerDay: number;
  codeTokensPerDay: number;
  thinkingLabel: string;
  features: string[];
}

export const PLANS: Record<PlanTier, PlanConfig> = {
  standard: {
    id: "standard",
    name: "Standart",
    tagline: "Tanishish uchun",
    price: 0,
    displayPrice: "0",
    messagesPerDay: 25,
    imagesPerDay: 8,
    codeTokensPerDay: 25_000,
    thinkingLabel: "Tezkor",
    features: [
      "25 ta xabar / kun",
      "8 ta rasm / kun",
      "25,000 Olmabek Code token / kun",
      "Jonli kod preview oynasi",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Kundalik ish va dasturlash",
    price: 20_000,
    displayPrice: "20,000",
    messagesPerDay: 150,
    imagesPerDay: 20,
    codeTokensPerDay: 250_000,
    thinkingLabel: "High Reasoning",
    features: [
      "150 ta xabar / kun",
      "20 ta rasm / kun",
      "250,000 Olmabek Code token / kun (10x ko'p)",
      "Kuchli UI va komponent kodlash (High)",
      "Ustuvor tezkor javob",
    ],
  },
  ultra: {
    id: "ultra",
    name: "Ultra",
    tagline: "To'liq muhandislik quvvati",
    price: 45_000,
    displayPrice: "45,000",
    messagesPerDay: 999_999,
    imagesPerDay: 80,
    codeTokensPerDay: 2_000_000,
    thinkingLabel: "XHigh Architect",
    features: [
      "Cheksiz xabar va javoblar",
      "80 ta rasm / kun",
      "2,000,000 Olmabek Code token / kun (8x Pro'dan ko'p)",
      "XHigh chuqur kod arxitekturasi va auto-tuzatish",
      "Rasm uslublari: Kino, Anime, 3D, Realistik",
      "Chat eksporti (.md) va 3 ta Ultra mavzu",
    ],
  },
};

export interface UserState {
  name: string;
  email: string;
  plan: PlanTier;
  messagesLeft: number;
  imagesLeft: number;
  codeTokensLeft: number;
  day: string;
  trialEndsAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  type: "text" | "image" | "code";
  prompt?: string;
  tokensUsed?: number;
  thinkingLevel?: string;
  stack?: CodeStack;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface RequestLogItem {
  t: number;
  u: string;
  p: PlanTier;
  m: InputMode;
  x: string;
  ms: number;
  tokens?: number;
  ok: boolean;
  e?: string;
}

export const IMAGE_STYLES: Array<{ label: string; promptSuffix: string }> = [
  { label: "Kino", promptSuffix: "cinematic film still, dramatic lighting" },
  { label: "Anime", promptSuffix: "anime style, vibrant colors, detailed" },
  { label: "3D", promptSuffix: "3D render, soft studio light, octane" },
  { label: "Realistik", promptSuffix: "photorealistic, 85mm lens, ultra detailed" },
  { label: "Akvarel", promptSuffix: "watercolor painting, soft washes" },
];

export const ULTRA_SKINS: Array<{ id: UltraSkin; label: string }> = [
  { id: "obsidian", label: "Obsidian" },
  { id: "galaxy", label: "Galaktika" },
  { id: "blackhole", label: "Qora tuynuk" },
];

export const CODE_STACKS: Array<{ id: CodeStack; label: string }> = [
  { id: "auto", label: "Avto" },
  { id: "html", label: "HTML / Tailwind" },
  { id: "react", label: "React JSX" },
  { id: "python", label: "Python" },
];

export function formatCompactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
