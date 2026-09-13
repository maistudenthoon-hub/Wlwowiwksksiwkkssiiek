import { InputDock } from "@/components/rivo/InputDock";
import { MessageRow } from "@/components/rivo/MessageRow";
import { RivoLogo } from "@/components/rivo/RivoLogo";
import { SettingsDialog } from "@/components/rivo/SettingsDialog";
import { Sidebar } from "@/components/rivo/Sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createConversation as fbCreateConversation, TESTING_MODE } from "@/lib/firebase-db";
import { auth, signInAnonymously } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRivoChat, useSidebarConversations, type Attachment } from "@/lib/rivo";
import { Menu, Plus, Share2, Volume2, VolumeX, AlertCircle, X } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { sounds, initSound, isSoundMuted, setSoundMuted } from "@/lib/sound";

export default function ChatView() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const conversationId = id ?? null;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [muted, setMuted] = useState(false);
  const { convs } = useSidebarConversations();
  const { isAuthenticated } = useAuth();
  const chat = useRivoChat(conversationId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const lastScrollAtRef = useRef(0);

  useEffect(() => { initSound(); setMuted(isSoundMuted()); }, []);

  // Fluid, human-like auto-scroll — throttled during streaming so it glides
  const smoothScrollToBottom = useCallback((instant = false) => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      const now = Date.now();
      // Throttle to ~15fps during streaming so it glides, not jitters
      if (!instant && chat.streaming && now - lastScrollAtRef.current < 65) return;
      lastScrollAtRef.current = now;
      const target = el.scrollHeight - el.clientHeight;
      if (instant) {
        el.scrollTop = target;
        return;
      }
      // Smooth lerp — glide to target instead of snapping
      const current = el.scrollTop;
      const diff = target - current;
      if (Math.abs(diff) < 2) { el.scrollTop = target; return; }
      el.scrollTop = current + diff * 0.32;
    });
  }, [chat.streaming]);

  useEffect(() => {
    if (!chat.streaming) smoothScrollToBottom(false);
  }, [chat.visibleChain, chat.pendingUser, smoothScrollToBottom, chat.streaming]);
  // During streaming, follow the content growth smoothly
  useEffect(() => {
    if (chat.streaming) smoothScrollToBottom(false);
  }, [chat.pendingAssistant?.content, chat.streaming, smoothScrollToBottom]);

  useEffect(() => {
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, []);

  const prevLenRef = useRef(0);
  useEffect(() => {
    const len = chat.pendingAssistant?.content.length ?? 0;
    if (chat.streaming && len > prevLenRef.current && len < 40) sounds.typing();
    prevLenRef.current = len;
  }, [chat.pendingAssistant?.content, chat.streaming]);

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !chat.streaming && chat.pendingAssistant?.status === "completed") sounds.receive();
    prevStreamingRef.current = chat.streaming;
  }, [chat.streaming, chat.pendingAssistant?.status]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 160px threshold — if user scrolls up even a bit, stop auto-sticking
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); navigate("/"); sounds.tap(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); navigate("/"); sounds.tap(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const navigateToChat = useCallback((cid: string | null) => {
    setSidebarOpen(false);
    if (cid) navigate(`/c/${cid}`);
    else navigate("/");
  }, [navigate]);

  const isEmpty = !chat.visibleChain?.length && !chat.pendingUser && !chat.pendingAssistant;

  // Restore draft from localStorage on mount
  const draftKey = conversationId ? `rivo-draft-${conversationId}` : "rivo-draft-new";
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved && isEmpty) {
      setRestoredDraft(saved);
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, isEmpty]);

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    try {
      if (!auth.currentUser && TESTING_MODE) {
        await signInAnonymously(auth).catch(() => {});
      }
      const newId = await fbCreateConversation();
      navigate(`/c/${newId}`, { replace: true });
      return newId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't start a new chat";
      if (msg.includes("Not authenticated") && !TESTING_MODE) {
        toast.error("Please sign in again — your session expired.");
      } else {
        toast.error(msg);
      }
      return null;
    }
  }, [conversationId, navigate]);

  const handleSend = useCallback(async (text: string, attachments?: Attachment[]) => {
    // Auth gate: if not signed in, save draft and redirect to auth (bypassed in testing mode)
    if (!isAuthenticated && !TESTING_MODE) {
      localStorage.setItem(draftKey, text);
      toast.info("Sign in to send your message — we saved your draft.");
      const returnTo = conversationId ? `/c/${conversationId}` : "/";
      navigate(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    const cid = await ensureConversation();
    if (!cid) return;
    stickToBottomRef.current = true;
    requestAnimationFrame(() => smoothScrollToBottom(true));
    await chat.sendMessage(text, attachments, cid, { webSearch, reasoning });
  }, [isAuthenticated, draftKey, conversationId, ensureConversation, chat, webSearch, reasoning, smoothScrollToBottom, navigate]);

  const shareChat = useCallback(async () => {
    if (!conversationId) return;
    const url = `${window.location.origin}/c/${conversationId}`;
    try { await navigator.clipboard.writeText(url); toast.success("Share link copied"); sounds.tap(); } catch { toast.error("Couldn't copy the link"); }
  }, [conversationId]);

  const rows = chat.visibleChain ?? [];
  // Show pendingUser only when it hasn't appeared in the DB rows yet
  const showPendingUser = !!chat.pendingUser && !rows.some(
    (m) => m.role === "user" && m.content === chat.pendingUser!.content && Math.abs(m.createdAt - chat.pendingUser!.createdAt) < 2000,
  );
  // When streaming, the assistant is already in rows via the reactive query.
  // Only show a separate pendingAssistant if it's NOT already in the rows
  // (this covers the brief gap between appendMessage and the DB subscription update).
  const showPendingAssistant = !!chat.pendingAssistant && !rows.some(
    (m) => m.id === chat.pendingAssistant!.id,
  );

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      <Sidebar conversations={convs ?? []} activeId={conversationId} open={sidebarOpen} onOpenChange={setSidebarOpen} collapsed={!isMobile && collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} onNavigate={navigateToChat} onNewChat={() => navigateToChat(null)} onOpenSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-2 border-b border-border/40 bg-background/80 px-3 py-2 backdrop-blur-xl md:px-4">
          <div className="flex items-center gap-1">
            {isMobile && <Button variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground" onClick={() => { sounds.tap(); setSidebarOpen(true); }} aria-label="Open sidebar"><Menu className="size-5" /></Button>}
            {!isMobile && collapsed && (
              <>
                <Button variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground" onClick={() => { sounds.tap(); setCollapsed(false); }} aria-label="Expand sidebar"><Menu className="size-5" /></Button>
                <Button variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground" onClick={() => { sounds.tap(); navigateToChat(null); }} aria-label="New chat"><Plus className="size-5" /></Button>
              </>
            )}
            <span className="ml-1 text-[15px] font-semibold tracking-tight">RIVO</span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground" onClick={() => { const v = !muted; setMuted(v); setSoundMuted(v); sounds.tap(); }} aria-label={muted ? "Unmute" : "Mute"}>
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{muted ? "Unmute sounds" : "Mute sounds"}</TooltipContent>
            </Tooltip>
            {conversationId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground" onClick={() => { sounds.tap(); shareChat(); }} aria-label="Share chat"><Share2 className="size-4" /></Button>
                </TooltipTrigger>
                <TooltipContent>Share chat</TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="rivo-scroll-thin rivo-chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {isEmpty ? <EmptyState /> : (
            <div className="flex flex-col gap-6 py-6 pb-10">
              {rows.map((msg, i) => (
                <MessageRow key={msg.id} msg={msg} isLast={i === rows.length - 1 && !chat.pendingAssistant} streaming={chat.streaming} sibling={chat.siblingIndex(msg)} onSibling={(dir) => chat.goToSibling(msg, dir)} onEdit={chat.editMessage} onRegenerate={chat.regenerate} onFeedback={chat.setFeedback} />
              ))}
              {showPendingUser && chat.pendingUser && <MessageRow msg={chat.pendingUser} isLast={false} streaming={chat.streaming} sibling={{ index: 0, count: 1 }} onSibling={() => {}} onEdit={() => {}} onRegenerate={() => {}} onFeedback={() => {}} />}
              {showPendingAssistant && chat.pendingAssistant && <MessageRow msg={chat.pendingAssistant} isLast streaming={chat.streaming} sibling={{ index: 0, count: 1 }} onSibling={() => {}} onEdit={() => {}} onRegenerate={() => {}} onFeedback={() => {}} />}
            </div>
          )}
        </div>

        {!chat.streaming && !isEmpty && chat.followUps.length > 0 && (
          <div className="mx-auto flex max-w-3xl flex-wrap gap-1.5 px-4 pb-3 md:px-6">
            {chat.followUps.map((f, i) => (
              <button
                key={`${i}-${f.slice(0, 12)}`}
                onClick={() => void handleSend(f)}
                className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:border-brand/30 hover:text-foreground"
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {chat.localError && !chat.streaming && (
          <div className="pointer-events-auto sticky bottom-28 z-10 mx-auto max-w-3xl px-4 md:px-6">
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive shadow-sm backdrop-blur">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{chat.localError}</span>
              <button onClick={chat.dismissLocalError} className="shrink-0 rounded-full p-0.5 hover:bg-destructive/10" aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

          <InputDock onSend={handleSend} onStop={() => { sounds.tap(); chat.stopStreaming(); }} streaming={chat.streaming} webSearch={webSearch} onWebSearchChange={setWebSearch} reasoning={reasoning} onReasoningChange={setReasoning} autoFocus restoredDraft={restoredDraft} />
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 pb-16 pt-10 md:pt-8">
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.6, ease: "easeOut" }} className="rivo-glow will-change-transform">
        <RivoLogo size="display" variant="hero" />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.45, ease: "easeOut" }} className="mt-5 text-center font-display text-[26px] font-semibold tracking-tight md:text-3xl">What's on your mind?</motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.14, duration: 0.4 }} className="mt-2 text-center text-sm text-muted-foreground">Ask anything · attach files & images · say “draw a…” to create art</motion.p>
    </div>
  );
}
