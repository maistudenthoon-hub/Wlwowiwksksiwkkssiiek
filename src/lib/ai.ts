/**
 * RIVO AI engine — zero setup required.
 *
 * Reliability chain (first path that answers wins, so chat ALWAYS replies):
 *   1. Keyless Pollinations (OpenAI-compatible) — no key, no console, no setup.
 *   2. Saved Gemini key (Admin panel or VITE_GEMINI_API_KEY env) — upgrade path.
 *   3. Firebase AI Logic — if enabled in the Firebase console.
 *
 * Also provides: image generation (keyless, persistent URLs), vision (images
 * in attachments), file contents, auto chat titles, real SSE streaming.
 */
import { fetchGeminiKey } from "@/lib/firebase-db";

export interface AiAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string; // images (downscaled for AI + storage)
  text?: string; // text/code/csv/md file contents
}

export interface AiTurn {
  history: { role: "user" | "assistant" | "system"; content: string; id?: string }[];
  system?: string;
  attachments?: AiAttachment[]; // attachments of the LAST user message
  reasoning?: boolean;
  webSearch?: boolean;
  fast?: boolean;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface AiResult {
  text: string;
  via: "keyless" | "gemini-key" | "firebase-ai";
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ */
/* Image generation (keyless, deterministic URL — persists forever)    */
/* ------------------------------------------------------------------ */

export function buildImageUrl(prompt: string, opts?: { width?: number; height?: number }): string {
  const seed = Math.floor(Math.random() * 1_000_000);
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 1024;
  const p = encodeURIComponent(prompt.replace(/\s+/g, " ").trim().slice(0, 900));
  return `https://image.pollinations.ai/prompt/${p}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;
}

const IMAGE_INTENT =
  /\b(draw|paint|generate|create|make|design|imagine|render|sketch)\b[^.?!]{0,100}\b(image|picture|photo|photograph|art|artwork|drawing|illustration|painting|logo|poster|wallpaper|icon|banner|sketch|portrait|scene|landscape|meme|character)\b/i;
const IMAGE_INTENT_2 = /\b(image|picture|photo|photograph|artwork|illustration|logo|drawing|painting|poster|wallpaper|portrait)\s+(of|showing|depicting|with)\b/i;
const IMAGE_INTENT_3 = /^\s*(please\s+)?(can you\s+|could you\s+|hey\s+|hi\s+)?(draw|paint|sketch|illustrate|doodle)\b/i;

/** Returns the image prompt if the user is asking for a generated image. */
export function extractImagePrompt(text: string): string | null {
  if (!IMAGE_INTENT.test(text) && !IMAGE_INTENT_2.test(text) && !IMAGE_INTENT_3.test(text)) return null;
  const cleaned = text
    .replace(/^(please\s+)?(can you\s+|could you\s+|hey\s+|hi\s+)?/i, "")
    .replace(
      /\b(generate|create|draw|paint|make|design|imagine|render|show)\s+(me\s+)?(an?|the|some)?\s*(image|picture|photo|photograph|artwork|art|drawing|illustration|painting|logo|poster|wallpaper|icon|banner|sketch|portrait|scene|landscape|meme|character)?\s*(of|showing|depicting|with|for|:)?\s*/i,
      "",
    )
    .trim();
  const out = cleaned.length > 2 ? cleaned : text.trim();
  return out.slice(0, 600);
}

/* ------------------------------------------------------------------ */
/* Low-level helpers                                                   */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const t = AbortSignal.timeout(ms);
  let signal = t;
  if (init.signal) {
    signal = typeof AbortSignal.any === "function" ? AbortSignal.any([init.signal, t]) : init.signal;
  }
  return fetch(url, { ...init, signal });
}

async function readSse(resp: Response, onEvent: (data: string) => void): Promise<void> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) onEvent(line.slice(5).trim());
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) onEvent(rest.slice(5).trim());
}

async function getSavedKey(): Promise<string | null> {
  try {
    const k = await fetchGeminiKey();
    if (k && k.trim()) return k.trim();
  } catch {
    /* Firestore rules may block — ignore */
  }
  const env =
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() ||
    (typeof process !== "undefined" && process.env?.GEMINI_API_KEY ? process.env.GEMINI_API_KEY : undefined);
  return env || null;
}

/* ------------------------------------------------------------------ */
/* Path 1 — keyless Pollinations (OpenAI-compatible)                   */
/* ------------------------------------------------------------------ */

const KEYLESS_GET = "https://text.pollinations.ai/";
const KEYLESS_URL = "https://text.pollinations.ai/openai";

function keylessModelParam(turn: AiTurn): string {
  if (turn.webSearch) return "gemini-search";
  if (turn.fast) return "openai-fast";
  return "openai";
}

/** Flatten the conversation into one prompt for the GET endpoint. */
function flattenTurn(turn: AiTurn): string {
  const parts: string[] = [];
  if (turn.system) parts.push(`[SYSTEM]\n${turn.system}`);
  const lastIdx = turn.history.length - 1;
  turn.history.forEach((m, i) => {
    let content = m.content;
    if (i === lastIdx && m.role === "user" && turn.attachments?.length) {
      const docs = turn.attachments!.filter((a) => a.text);
      if (docs.length) {
        content +=
          "\n\n" +
          docs.map((d) => `--- Attached file: ${d.name} ---\n${(d.text ?? "").slice(0, 24000)}`).join("\n\n");
      }
    }
    const who = m.role === "assistant" ? "RIVO" : m.role === "system" ? "SYSTEM" : "USER";
    parts.push(`[${who}]\n${content}`);
  });
  if (turn.attachments?.some((a) => a.dataUrl?.startsWith("data:image"))) {
    parts.push("[SYSTEM]\nThe user also attached image(s) this turn — acknowledge them.");
  }
  parts.push("[RIVO]");
  return parts.join("\n\n");
}

/**
 * GET is the PRIMARY path — it always answers with `access-control-allow-origin: *`,
 * so it works from every browser even where POST preflights fail.
 */
async function keylessGet(turn: AiTurn): Promise<string> {
  const primary = keylessModelParam(turn);
  const models = Array.from(new Set([primary, "openai", "mistral"]));
  const prompt = flattenTurn(turn).slice(0, 5500);
  let lastErr = "";
  for (const model of models) {
    const url =
      KEYLESS_GET +
      encodeURIComponent(prompt) +
      `?model=${encodeURIComponent(model)}&referrer=rivo.chat&seed=${Math.floor(Math.random() * 1_000_000)}`;
    try {
      console.info(`[RIVO] AI try: keyless GET · ${model}`);
      const resp = await fetchWithTimeout(url, { signal: turn.signal }, 110_000);
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        lastErr = `GET ${model} ${resp.status}: ${t.slice(0, 140) || resp.statusText}`;
        continue;
      }
      const text = (await resp.text()).trim();
      if (!text) {
        lastErr = `GET ${model}: empty body`;
        continue;
      }
      console.info(`[RIVO] AI answered via keyless GET · ${model}`);
      turn.onDelta?.(text);
      return text;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastErr = `GET ${model}: ${msg(e)}`;
    }
  }
  throw new Error(lastErr || "Pollinations GET failed");
}

async function keylessOnce(turn: AiTurn, model: string): Promise<string> {
  const msgs: unknown[] = [{ role: "system", content: turn.system ?? "You are RIVO, a helpful AI assistant." }];

  const lastIdx = turn.history.length - 1;
  turn.history.forEach((m, i) => {
    const isLastUser = i === lastIdx && m.role === "user" && turn.attachments?.length;
    if (isLastUser) {
      const docs = turn.attachments!.filter((a) => a.text);
      const images = turn.attachments!.filter((a) => a.dataUrl?.startsWith("data:image"));
      let content = m.content;
      if (docs.length) {
        content +=
          "\n\n" +
          docs
            .map((d) => `--- Attached file: ${d.name} ---\n${(d.text ?? "").slice(0, 60000)}`)
            .join("\n\n");
      }
      if (images.length) {
        const parts: unknown[] = [{ type: "text", text: content }];
        for (const img of images) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
        msgs.push({ role: "user", content: parts });
      } else {
        msgs.push({ role: "user", content });
      }
    } else {
      msgs.push({ role: m.role, content: m.content });
    }
  });

  const body: Record<string, unknown> = { model, messages: msgs, stream: false };
  if (turn.reasoning) body.reasoning_effort = "high";

  const resp = await fetchWithTimeout(
    KEYLESS_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: turn.signal,
    },
    120_000,
  );
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Pollinations ${resp.status}: ${t.slice(0, 200) || resp.statusText}`);
  }

  const ct = resp.headers.get("content-type") ?? "";
  let text = "";
  if (ct.includes("text/event-stream")) {
    await readSse(resp, (data) => {
      if (!data || data === "[DONE]") return;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          text += d;
          turn.onDelta?.(d);
        }
      } catch {
        /* ignore keepalive lines */
      }
    });
  } else {
    const raw = await resp.text();
    try {
      const j = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
      text = j.choices?.[0]?.message?.content ?? raw;
    } catch {
      text = raw;
    }
    if (text && turn.onDelta) turn.onDelta(text);
  }
  if (!text.trim()) throw new Error("Empty answer from keyless model");
  return text;
}

async function tryKeyless(turn: AiTurn): Promise<string> {
  const errors: string[] = [];
  // Long prompts (big files) don't fit a GET URL — try POST first in that case.
  const flatLen = flattenTurn(turn).length;
  const order: ("get" | "post")[] = flatLen > 4500 ? ["post", "get"] : ["get", "post"];
  for (const which of order) {
    try {
      return await (which === "get" ? keylessGet(turn) : keylessOnce(turn, keylessModelParam(turn)));
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      errors.push(`${which.toUpperCase()}: ${msg(e)}`);
    }
  }
  throw new Error(errors.join(" | ") || "Keyless provider failed");
}

/* ------------------------------------------------------------------ */
/* Path 2 — saved Gemini key (streaming)                               */
/* ------------------------------------------------------------------ */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.0-flash"];

function geminiPayload(turn: AiTurn, sys: string) {
  const lastIdx = turn.history.length - 1;
  const contents = turn.history.map((m, i) => {
    const isLastUser = i === lastIdx && m.role === "user" && turn.attachments?.length;
    if (isLastUser) {
      const parts: unknown[] = [{ text: m.content }];
      for (const a of turn.attachments!) {
        if (a.dataUrl?.startsWith("data:image")) {
          const comma = a.dataUrl.indexOf(",");
          const mime = a.dataUrl.slice(5, a.dataUrl.indexOf(";")) || "image/jpeg";
          parts.push({ inline_data: { mime_type: mime, data: a.dataUrl.slice(comma + 1) } });
        } else if (a.text) {
          parts.push({ text: `\n\n--- Attached file: ${a.name} ---\n${a.text.slice(0, 60000)}` });
        }
      }
      return { role: "user", parts };
    }
    return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
  });
  return { contents, systemInstruction: { parts: [{ text: sys }] }, generationConfig: { temperature: 0.7 } };
}

async function tryGeminiKey(turn: AiTurn, key: string): Promise<string> {
  const sys = turn.system ?? "You are RIVO, a helpful AI assistant.";
  let lastErr = "";
  for (const model of GEMINI_MODELS) {
    try {
      const resp = await fetchWithTimeout(
        `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(geminiPayload(turn, sys)),
          signal: turn.signal,
        },
        120_000,
      );
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        lastErr = `${model} ${resp.status}: ${t.slice(0, 250)}`;
        if (/404|not found|no longer available|not supported/i.test(t)) continue; // try next model
        throw new Error(`Gemini ${lastErr}`);
      }
      let text = "";
      await readSse(resp, (data) => {
        if (!data || data === "[DONE]") return;
        try {
          const j = JSON.parse(data) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            error?: { message?: string };
          };
          if (j.error?.message) throw new Error(`Gemini: ${j.error.message}`);
          const d = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (d) {
            text += d;
            turn.onDelta?.(d);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Gemini:")) throw e;
        }
      });
      if (text.trim()) return text;
      lastErr = `${model}: empty stream`;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastErr = msg(e);
      if (/API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|quota|ACCESS_TOKEN_TYPE/i.test(lastErr)) {
        throw new Error(`Gemini: ${lastErr.slice(0, 300)}`);
      }
    }
  }
  throw new Error(lastErr || "Gemini failed");
}

/* ------------------------------------------------------------------ */
/* Path 3 — Firebase AI Logic (last resort)                            */
/* ------------------------------------------------------------------ */

async function tryFirebaseAi(turn: AiTurn): Promise<string> {
  const { rivoAI } = await import("@/lib/firebase");
  const { getGenerativeModel } = await import("firebase/ai");
  const sys = turn.system ?? "You are RIVO, a helpful AI assistant.";
  let lastErr = "";
  for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
    try {
      const gen = getGenerativeModel(rivoAI, { model, systemInstruction: sys });
      const docs = (turn.attachments ?? []).filter((a) => a.text);
      const lastUser = [...turn.history].reverse().find((m) => m.role === "user");
      const parts = turn.history.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [
          {
            text:
              m === lastUser && docs.length
                ? `${m.content}\n\n${docs.map((d) => `--- Attached file: ${d.name} ---\n${(d.text ?? "").slice(0, 40000)}`).join("\n\n")}`
                : m.content,
          },
        ],
      }));
      const result = await gen.generateContent({ contents: parts } as never);
      const raw = (result?.response as { text?: () => string } | undefined)?.text?.() ?? "";
      if (!raw.trim()) throw new Error("Firebase AI: empty answer");
      turn.onDelta?.(raw);
      return raw;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastErr = msg(e);
      if (!/404|not found|no longer available|not supported/i.test(lastErr)) break;
    }
  }
  throw new Error(lastErr || "Firebase AI failed");
}

/* ------------------------------------------------------------------ */
/* Orchestrator — never silently fails                                 */
/* ------------------------------------------------------------------ */

export async function streamAi(turn: AiTurn): Promise<AiResult> {
  const errors: string[] = [];

  try {
    const r = { text: await tryKeyless(turn), via: "keyless" as const };
    console.info("[RIVO] AI path: keyless ✅");
    return r;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    errors.push("keyless: " + msg(e));
    console.warn("[RIVO] keyless failed:", msg(e));
  }

  const key = await getSavedKey();
  if (key) {
    try {
      const r = { text: await tryGeminiKey(turn, key), via: "gemini-key" as const };
      console.info("[RIVO] AI path: gemini-key ✅");
      return r;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      errors.push("gemini-key: " + msg(e));
      console.warn("[RIVO] gemini-key failed:", msg(e));
    }
  }

  try {
    const r = { text: await tryFirebaseAi(turn), via: "firebase-ai" as const };
    console.info("[RIVO] AI path: firebase-ai ✅");
    return r;
  } catch (e) {
    errors.push("firebase-ai: " + msg(e));
    console.warn("[RIVO] firebase-ai failed:", msg(e));
  }

  throw new Error(errors.join("  |  "));
}

/* ------------------------------------------------------------------ */
/* Smart follow-ups — 3 suggested next questions after each answer     */
/* ------------------------------------------------------------------ */

export async function getFollowUps(question: string): Promise<string[]> {
  try {
    const prompt = `A user just asked an AI assistant: "${question.replace(/\s+/g, " ").trim().slice(0, 300)}". Suggest 3 short natural follow-up questions they might ask next (max 6 words each). Reply with only the 3 questions, one per line, no numbering.`;
    const resp = await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai-fast&referrer=rivo.chat`,
      {},
      15_000,
    );
    if (!resp.ok) return [];
    const lines = (await resp.text())
      .split("\n")
      .map((l) => l.replace(/^[\d.\-\s"'\-*]+/, "").trim())
      .filter((l) => l.length > 3 && l.length < 90);
    return lines.slice(0, 3);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Admin: one-shot key test                                            */
/* ------------------------------------------------------------------ */

export async function testGeminiKey(key: string): Promise<boolean> {
  const resp = await fetchWithTimeout(
    `${GEMINI_BASE}/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }] }),
    },
    20_000,
  );
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(t.slice(0, 300) || `HTTP ${resp.status}`);
  }
  const j = (await resp.json()) as { candidates?: unknown[] };
  return !!j.candidates?.length;
}

/* ------------------------------------------------------------------ */
/* Auto chat titles (keyless, one-shot)                                */
/* ------------------------------------------------------------------ */

export async function generateAiTitle(firstMessage: string): Promise<string | null> {
  const prompt = `Write a short conversation title (3-6 words, Title Case, no quotes, no trailing punctuation) for a chat that starts with: "${firstMessage.replace(/\s+/g, " ").trim().slice(0, 300)}". Reply with the title only.`;
  try {
    const resp = await fetchWithTimeout(
      `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=openai-fast`,
      {},
      15_000,
    );
    if (!resp.ok) return null;
    let t = (await resp.text()).trim();
    t = t.replace(/^["'#\s*-]+/, "").replace(/["'.\s]+$/, "").split("\n")[0].trim();
    return t.length >= 3 && t.length <= 80 ? t : null;
  } catch {
    return null;
  }
}
