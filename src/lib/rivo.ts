/**
 * RIVO chat logic — Firestore realtime + the zero-setup AI engine (src/lib/ai.ts).
 * The AI answers with NO setup (keyless), and auto-upgrades if a Gemini key is saved.
 * Real features: image generation, file understanding, vision, voice input,
 * auto chat titles, real stop, branches — no clutter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { buildImageUrl, extractImagePrompt, generateAiTitle, getFollowUps, streamAi, type AiAttachment, type AiTurn } from "@/lib/ai";
import {
  watchMessages,
  appendMessage as fbAppendMessage,
  updateMessage,
  setMessageFeedback as fbSetFeedback,
  deleteMessage as fbDeleteMessage,
  watchConversations,
  fetchAllConversationsWithMessages,
  fetchSystemPrompt,
  fetchMyCustomInstructions,
  saveCustomInstructions as fbSaveCustomInstructions,
  renameConversation,
  type MessageData,
  type ConversationData,
} from "@/lib/firebase-db";

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatRelativeDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayMs = 86_400_000;
  const startOfThatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfThatDay) / dayMs);
  if (diffDays <= 0) return `Today ${formatTime(ts)}`;
  if (diffDays === 1) return `Yesterday ${formatTime(ts)}`;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], {
    month: "short", day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

export interface Suggestion {
  title: string;
  sub: string;
  prompt: string;
}

export const SUGGESTIONS: Suggestion[] = [
  { title: "Debug some code", sub: "Paste an error and get a fix", prompt: "Here's an error I'm stuck on. Explain what's causing it and show me a fix:\n\n" },
  { title: "Draft a product update", sub: "Crisp changelog in your voice", prompt: "Draft a short, friendly product update announcing a new dark mode." },
  { title: "Compare two options", sub: "A table of trade-offs", prompt: "Compare Postgres and MongoDB for a mid-size SaaS app. Give me a markdown table of trade-offs." },
  { title: "Plan my week", sub: "Turn chaos into a schedule", prompt: "Help me plan a focused week: 3 deep-work blocks per day, one recurring meeting per day, and a Friday review." },
];

/* ------------------------------------------------------------------ */
/* Date grouping for sidebar                                           */
/* ------------------------------------------------------------------ */

export type HistoryGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Previous 30 Days" | "Older";

export function groupKeyFor(ts: number): HistoryGroup {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - dayMs) return "Yesterday";
  if (ts >= startOfToday - 7 * dayMs) return "Previous 7 Days";
  if (ts >= startOfToday - 30 * dayMs) return "Previous 30 Days";
  return "Older";
}

export const GROUP_ORDER: HistoryGroup[] = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older"];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Attachment = AiAttachment;

export interface SidebarConversation {
  _id?: string;
  id: string;
  title: string;
  updatedAt?: number;
  isPinned?: boolean;
}

export interface ChatMessageT {
  id: string;
  _id?: string;
  conversationId?: string;
  parentId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[];
  status?: "sending" | "streaming" | "completed" | "error";
  feedback?: "up" | "down";
  isError?: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function getFirebaseToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try {
    return await u.getIdToken();
  } catch {
    return null;
  }
}

/** One-shot fetch of a conversation's messages (for AI context). */
async function fetchConversationMessages(conversationId: string): Promise<MessageData[]> {
  const { collection, query, where, orderBy, getDocs } = await import("firebase/firestore");
  const { db } = await import("@/lib/firebase");
  const q = query(collection(db, "messages"), where("conversationId", "==", conversationId), orderBy("createdAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MessageData));
}

/** Inline a message's text attachments into content so the AI keeps file context. */
function contentWithFiles(m: MessageData | ChatMessageT): string {
  const docs = (m.attachments ?? []).filter((a) => a.text);
  if (!docs.length) return m.content;
  return `${m.content}\n\n${docs.map((d) => `--- Attached file: ${d.name} ---\n${(d.text ?? "").slice(0, 30000)}`).join("\n\n")}`;
}

/* ------------------------------------------------------------------ */
/* useRivoChat — Firestore real-time + zero-setup AI engine            */
/* ------------------------------------------------------------------ */

export function useRivoChat(conversationId: string | null) {
  const [dbMessages, setDbMessages] = useState<MessageData[] | null>(null);

  useEffect(() => {
    if (!conversationId || !auth.currentUser) {
      setDbMessages(null);
      return;
    }
    return watchMessages(conversationId, (msgs) => setDbMessages(msgs));
  }, [conversationId]);

  const [isSending, setIsSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<ChatMessageT | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  // Clear pending user once the real DB message appears
  useEffect(() => {
    if (!dbMessages || !pendingUser) return;
    const found = dbMessages.some(
      (m) => m.role === "user" && m.content === pendingUser.content && Math.abs(m.createdAt - pendingUser.createdAt) < 8000,
    );
    if (found) setPendingUser(null);
  }, [dbMessages, pendingUser]);

  /* Branch navigation */
  const siblingsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!dbMessages) return map;
    const byParent = new Map<string, MessageData[]>();
    for (const m of dbMessages) {
      const key = m.parentId ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(m);
    }
    for (const [key, list] of byParent) {
      list.sort((a, b) => a.createdAt - b.createdAt);
      map.set(key, list.map((m) => m.id));
    }
    return map;
  }, [dbMessages]);

  const [leafOverride, setLeafOverride] = useState<string | null>(null);
  useEffect(() => {
    setLeafOverride(null);
    setLocalError(null);
    setFollowUps([]);
  }, [conversationId]);

  /** Pick the leaf of the newest branch: live > errored > newest. */
  const pickLeaf = useCallback((msgs: MessageData[]): MessageData | undefined => {
    if (!msgs.length) return undefined;
    const parents = new Set(msgs.map((m) => m.parentId ?? "__root__"));
    const leaves = msgs.filter((m) => !parents.has(m.id));
    const pool = leaves.length ? leaves : msgs;
    const sorted = [...pool].sort((a, b) => b.createdAt - a.createdAt);
    return sorted.find((m) => m.status === "sending" || m.status === "streaming")
      ?? sorted.find((m) => m.status === "error")
      ?? sorted[0];
  }, []);

  const visibleChain = useMemo<MessageData[]>(() => {
    if (!dbMessages?.length) return [];
    const byId = new Map(dbMessages.map((m) => [m.id, m]));
    const leaf = leafOverride && byId.has(leafOverride) ? byId.get(leafOverride)! : pickLeaf(dbMessages);
    if (!leaf) return [];
    const chain: MessageData[] = [];
    let cursor: MessageData | undefined = leaf;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return chain.reverse();
  }, [dbMessages, leafOverride, pickLeaf]);

  const siblingIndex = useCallback(
    (msg: MessageData): { index: number; count: number } => {
      const siblings = siblingsByParent.get(msg.parentId ?? "__root__") ?? [msg.id];
      const index = siblings.indexOf(msg.id);
      return { index: index < 0 ? 0 : index, count: siblings.length };
    },
    [siblingsByParent],
  );

  const goToSibling = useCallback(
    (msg: MessageData, dir: -1 | 1) => {
      const siblings = siblingsByParent.get(msg.parentId ?? "__root__") ?? [];
      const next = siblings[siblings.indexOf(msg.id) + dir];
      if (next) setLeafOverride(next);
    },
    [siblingsByParent],
  );

  /* ---------------------------------------------------------------- */
  /* AI run — writes into Firestore, streams deltas, real stop         */
  /* ---------------------------------------------------------------- */

  const runAssistantTurn = useCallback(
    async (convId: string, turnHistory: AiTurn["history"], attachments: AiAttachment[] | undefined, opts: { reasoning?: boolean; webSearch?: boolean } = {}) => {
      // Parent = the newest user turn that already has an id (from sendMessage),
      // else the latest user message in Firestore (edit/regenerate paths).
      let lastUserId = [...turnHistory].reverse().find((m) => "id" in m && typeof (m as { id?: string }).id === "string")?.id as string | undefined;
      if (!lastUserId) {
        try {
          const msgs = await fetchConversationMessages(convId);
          lastUserId = [...msgs].reverse().find((m) => m.role === "user")?.id;
        } catch { /* assistant becomes a root leaf */ }
      }
      let assistantId: string;
      try {
        assistantId = await fbAppendMessage({
          conversationId: convId,
          parentId: lastUserId,
          role: "assistant",
          content: "",
          status: "sending",
        });
      } catch (e) {
        setLocalError("Couldn't save the message: " + (e instanceof Error ? e.message : String(e)));
        setIsSending(false);
        return;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Real stop: if the user taps stop, abort; also honor stopRequested in DB.
      let stopped = false;
      const stopWatch = watchMessages(convId, (msgs) => {
        const m = msgs.find((x) => x.id === assistantId);
        if (m?.stopRequested && !stopped) {
          stopped = true;
          ctrl.abort();
        }
      });

      // System prompt: admin system prompt + user custom instructions
      const [sysDoc, custom] = await Promise.all([
        fetchSystemPrompt().catch(() => null),
        fetchMyCustomInstructions().catch(() => null),
      ]);
      const sysLines = [
        sysDoc?.content?.trim() ||
          "You are RIVO, a helpful, friendly AI assistant made by RIVO Labs. Format answers in clean markdown. Be concise but thorough.",
      ];
      if (custom?.about) sysLines.push(`About the user: ${custom.about}`);
      if (custom?.respond) sysLines.push(`How to respond: ${custom.respond}`);
      if (opts.webSearch) sysLines.push("Web search mode is on: answer with the most current info you have and note when info may be outdated.");

      let shown = "";
      let queue = "";
      let firstWriteDone = false;
      const flush = async (status: "streaming" | "completed" | "error") => {
        try {
          await updateMessage(assistantId, { content: shown, status });
          firstWriteDone = true;
        } catch {
          if (!firstWriteDone) setLocalError(`Streaming answer:\n\n${shown}`);
        }
      };

      // Local typewriter: the keyless GET returns the full text at once, so we
      // drip it into Firestore at a natural pace (also gives true cancel).
      const typer = window.setInterval(() => {
        if (!queue) return;
        const step = Math.max(3, Math.ceil(queue.length / 28));
        shown += queue.slice(0, step);
        queue = queue.slice(step);
        if (flushTimerRef.current === null) {
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            void flush("streaming");
          }, 300);
        }
      }, 40);

      try {
        await streamAi({
          history: turnHistory,
          system: sysLines.join("\n"),
          attachments,
          reasoning: opts.reasoning,
          webSearch: opts.webSearch,
          signal: ctrl.signal,
          onDelta: (d) => {
            queue += d;
          },
        });
        window.clearInterval(typer);
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        shown = (shown + queue).trim() || "_(empty response)_";
        await flush("completed");
      } catch (e) {
        window.clearInterval(typer);
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (e instanceof Error && e.name === "AbortError") {
          shown = (shown + queue).trim() ? shown + queue : "_(stopped)_";
          await flush("completed");
        } else {
          const m = (e instanceof Error ? e.message : String(e)).slice(0, 800);
          shown = `**RIVO couldn't get a response.**\n\n\`\`\`\n${m}\n\`\`\``;
          await flush("error");
          setLocalError(m);
        }
      } finally {
        stopWatch();
        abortRef.current = null;
        setIsSending(false);
      }

      // Auto-title + smart follow-up suggestions
      const first = [...turnHistory].reverse().find((m) => m.role === "user")?.content ?? "";
      void generateAiTitle(first).then((t) => {
        if (t) renameConversation(convId, t).catch(() => {});
      });
      getFollowUps(first).then(setFollowUps).catch(() => {});
    },
    [],
  );

  const appendAssistantDirect = useCallback(
    async (convId: string, content: string, parentId?: string) => {
      try {
        await fbAppendMessage({ conversationId: convId, parentId, role: "assistant", content, status: "completed" });
      } catch (e) {
        setLocalError("Couldn't save the message: " + (e instanceof Error ? e.message : String(e)));
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      attachments?: AiAttachment[],
      convIdOverride?: string,
      opts?: { reasoning?: boolean; webSearch?: boolean },
    ) => {
      const target = convIdOverride ?? conversationId;
      if (!target || isSending) return;
      setLocalError(null);
      const trimmed = text.trim();
      if (!trimmed && !(attachments && attachments.length)) return;

      const fbReady = await getFirebaseToken();
      if (!fbReady) {
        try {
          localStorage.setItem("rivo-draft", JSON.stringify({ text: trimmed, createdAt: Date.now() }));
        } catch { /* ignore */ }
        window.location.href = `/auth?returnTo=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      const last = visibleChain[visibleChain.length - 1];
      const parentId = last?.id;

      const now = Date.now();
      setPendingUser({
        id: `temp-user-${now}`,
        _id: `temp-user-${now}`,
        parentId,
        role: "user",
        content: trimmed,
        attachments,
        status: "completed",
        createdAt: now,
      });

      try {
        await fbAppendMessage({ conversationId: target, parentId, role: "user", content: trimmed, attachments, status: "completed" });
      } catch (err) {
        setPendingUser(null);
        const msg = err instanceof Error ? err.message : "Failed to send";
        alert(msg.includes("Not authenticated") ? "Please sign in again." : `Couldn't send: ${msg}`);
        return;
      }

      // AI history from the current chain + the new message (files inlined for context)
      const history: AiTurn["history"] = [
        ...visibleChain.map((m) => ({ role: m.role, content: contentWithFiles(m), id: m.id })),
        { role: "user" as const, content: trimmed },
      ];

      // Image generation intent — keyless, deterministic URL, instant
      const imgPrompt = extractImagePrompt(trimmed);
      if (imgPrompt && !(attachments && attachments.length)) {
        const url = buildImageUrl(imgPrompt);
        await appendAssistantDirect(
          target,
          `![generated image](${url})\n\nWant a different style? Say "draw it again, but …" and I'll make another.`,
          last?.id,
        );
        void generateAiTitle(trimmed).then((t) => {
          if (t) renameConversation(target, t).catch(() => {});
        });
        return;
      }

      setIsSending(true);
      await runAssistantTurn(target, history, attachments, opts);
    },
    [conversationId, isSending, visibleChain, runAssistantTurn, appendAssistantDirect],
  );

  const editMessage = useCallback(
    async (msg: ChatMessageT, newText: string) => {
      if (!conversationId || isSending) return;
      const trimmed = newText.trim();
      if (!trimmed) return;
      // Fork: append a sibling user message under the same parent
      try {
        await fbAppendMessage({ conversationId, parentId: msg.parentId, role: "user", content: trimmed, status: "completed" });
      } catch {
        return;
      }
      const idx = visibleChain.findIndex((m) => m.id === msg.id);
      const history: AiTurn["history"] = visibleChain
        .slice(0, idx < 0 ? visibleChain.length : idx)
        .map((m) => ({ role: m.role, content: contentWithFiles(m) }));
      history.push({ role: "user", content: trimmed });
      setIsSending(true);
      await runAssistantTurn(conversationId, history, undefined, {});
    },
    [conversationId, isSending, visibleChain, runAssistantTurn],
  );

  const regenerate = useCallback(
    async (assistantMsg: ChatMessageT) => {
      if (!conversationId || isSending) return;
      const idx = visibleChain.findIndex((m) => m.id === assistantMsg.id);
      const upto = idx > 0 ? idx : visibleChain.length;
      const history: AiTurn["history"] = visibleChain
        .slice(0, upto)
        .filter((m) => !(m.role === "assistant" && m.id === assistantMsg.id))
        .map((m) => ({ role: m.role, content: contentWithFiles(m) }));
      setIsSending(true);
      await runAssistantTurn(conversationId, history, undefined, {});
    },
    [conversationId, isSending, visibleChain, runAssistantTurn],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsSending(false);
  }, []);

  const setFeedback = useCallback(async (id: string, feedback: "up" | "down" | null) => {
    await fbSetFeedback(id, feedback ?? undefined);
  }, []);

  const removeMessage = useCallback(async (id: string) => {
    await fbDeleteMessage(id);
  }, []);

  const lastMsg = visibleChain[visibleChain.length - 1];
  const lastIsAssistant = lastMsg?.role === "assistant";
  const streaming = isSending && !!lastIsAssistant;
  const streamingId = streaming ? lastMsg.id : null;
  const pendingAssistant: ChatMessageT | null = streaming ? (lastMsg as ChatMessageT) : null;

  return {
    visibleChain,
    pendingUser,
    pendingAssistant,
    localError,
    followUps,
    dismissLocalError: () => setLocalError(null),
    streaming,
    streamingId,
    leafOverride,
    setLeafOverride,
    siblingIndex,
    goToSibling,
    sendMessage,
    editMessage,
    regenerate,
    stopStreaming,
    setFeedback,
    removeMessage,
  };
}

/* ------------------------------------------------------------------ */
/* Sidebar data — Firestore                                            */
/* ------------------------------------------------------------------ */

export function useSidebarConversations() {
  const [convsRaw, setConvsRaw] = useState<ConversationData[] | null>(null);
  const convs = convsRaw?.map((c) => ({ _id: c.id, id: c.id, title: c.title, updatedAt: c.updatedAt, isPinned: c.isPinned })) ?? null;

  useEffect(() => {
    if (!auth.currentUser) {
      setConvsRaw(null);
      return;
    }
    return watchConversations((c) => setConvsRaw(c));
  }, []);

  const [searchIndex, setSearchIndex] = useState<
    { id: string; title: string; updatedAt: number; isPinned: boolean; snippet?: string; messageContents: string[] }[] | null
  >(null);

  useEffect(() => {
    if (!auth.currentUser) {
      setSearchIndex(null);
      return;
    }
    fetchAllConversationsWithMessages().then(setSearchIndex).catch(() => setSearchIndex(null));
  }, [convs?.length]);

  return { convs, archived: null as null, searchIndex };
}

/* ------------------------------------------------------------------ */
/* Custom instructions hook                                            */
/* ------------------------------------------------------------------ */

export function useCustomInstructions() {
  const [custom, setCustom] = useState<{ about: string; respond: string }>({ about: "", respond: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;
    fetchMyCustomInstructions()
      .then((c) => setCustom({ about: c?.about ?? "", respond: c?.respond ?? "" }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (data: { about: string; respond: string }) => {
    setCustom(data);
    await fbSaveCustomInstructions(data).catch(() => {});
  }, []);

  return { custom, save, loaded };
}
