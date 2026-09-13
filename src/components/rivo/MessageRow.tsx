import { MessageContent } from "@/components/rivo/MessageContent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeDay, type Attachment, type ChatMessageT } from "@/lib/rivo";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sounds, haptic } from "@/lib/sound";

interface MessageRowProps {
  msg: ChatMessageT;
  isLast: boolean;
  streaming: boolean;
  sibling: { index: number; count: number };
  onSibling: (dir: -1 | 1) => void;
  onEdit: (msg: ChatMessageT, text: string) => void;
  onRegenerate: (msg: ChatMessageT) => void;
  onFeedback: (id: string, feedback: "up" | "down" | null) => void;
}

function speak(text: string) {
  if (typeof speechSynthesis === "undefined") { toast.error("Speech isn't supported in this browser"); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " code block ").replace(/[*_#`>]/g, ""));
  u.rate = 1.02;
  speechSynthesis.speak(u);
  sounds.tap();
}

export function MessageRow({ msg, isLast, streaming, sibling, onSibling, onEdit, onRegenerate, onFeedback }: MessageRowProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  const isStreamingThis = streaming && isLast && isAssistant;

  useEffect(() => {
    if (editing) {
      setDraft(msg.content);
      requestAnimationFrame(() => {
        editRef.current?.focus();
        editRef.current?.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
      });
    }
  }, [editing, msg.content]);

  const copy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      sounds.tap();
      haptic("light");
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  const submitEdit = () => {
    if (draft.trim() && draft.trim() !== msg.content.trim()) { sounds.send(); onEdit(msg, draft); }
    setEditing(false);
  };

  if (isUser) {
    if (editing) {
      return (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="px-4 md:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-2xl border border-border bg-card p-3 shadow-sm ring-1 ring-brand/10">
              <Textarea ref={editRef} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-20 resize-none border-0 bg-transparent p-1 text-[15px] shadow-none focus-visible:ring-0" rows={Math.min(10, draft.split("\n").length + 1)} />
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { sounds.tap(); setEditing(false); }} className="rounded-full">Cancel</Button>
                <Button size="sm" onClick={submitEdit} className="rivo-btn-brand rounded-full">Send</Button>
              </div>
            </div>
          </div>
        </motion.div>
      );
    }
    return (
      <motion.div layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease: "easeOut" }} className="group/msg px-4 md:px-6">
        <div className="mx-auto flex max-w-3xl justify-end">
          <div className="flex max-w-[86%] flex-col items-end gap-1.5">
            {!!msg.attachments?.length && <Attachments attachments={msg.attachments} />}
            {(msg.content || !msg.attachments?.length) && (
              <div className="rounded-[22px] rounded-br-md bg-primary px-4 py-3 text-[15px] leading-relaxed text-primary-foreground shadow-[0_2px_10px_oklch(0_0_0/8%)]">
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            )}
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 focus-within:opacity-100">
              <BranchNav sibling={sibling} onSibling={(d) => { sounds.switch(); onSibling(d); }} />
              <IconBtn label="Copy" onClick={copy}>{copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</IconBtn>
              <IconBtn label="Edit" onClick={() => { sounds.tap(); setEditing(true); }}><Pencil className="size-3.5" /></IconBtn>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }} className="group/msg px-4 md:px-6">
      <div className="mx-auto flex max-w-3xl gap-3.5 md:gap-4">
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] text-[11px] font-bold text-white shadow-sm">
          R
        </div>
        <div className="min-w-0 flex-1">
          {msg.isError || msg.status === "error" ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm leading-relaxed text-destructive">
              <MessageContent content={msg.content} className="rivo-prose-error" />
            </div>
          ) : msg.status === "sending" && !msg.content ? (
            <ThinkingDots />
          ) : (
            <div className="relative">
              <MessageContent content={msg.content} />
              {isStreamingThis && <span className="rivo-caret" aria-hidden />}
            </div>
          )}

          {!streaming && msg.content && (
            <div className="mt-2 flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 focus-within:opacity-100">
              <BranchNav sibling={sibling} onSibling={(d) => { sounds.switch(); onSibling(d); }} />
              <IconBtn label="Copy" onClick={copy}>{copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</IconBtn>
              <IconBtn label="Good response" active={msg.feedback === "up"} onClick={() => { sounds.tap(); haptic("light"); onFeedback(msg.id, msg.feedback === "up" ? null : "up"); }}><ThumbsUp className="size-3.5" /></IconBtn>
              <IconBtn label="Bad response" active={msg.feedback === "down"} onClick={() => { sounds.tap(); haptic("light"); onFeedback(msg.id, msg.feedback === "down" ? null : "down"); }}><ThumbsDown className="size-3.5" /></IconBtn>
              <IconBtn label="Read aloud" onClick={() => speak(msg.content)}><Volume2 className="size-3.5" /></IconBtn>
              <IconBtn label="Regenerate" onClick={() => { sounds.tap(); onRegenerate(msg); }}><RefreshCw className="size-3.5" /></IconBtn>
            </div>
          )}
          <AnimatePresence>
            {streaming && isLast && msg.content && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> {formatRelativeDay(msg.createdAt)} · generating…
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function BranchNav({ sibling, onSibling }: { sibling: { index: number; count: number }; onSibling: (dir: -1 | 1) => void }) {
  if (sibling.count <= 1) return null;
  return (
    <span className="mr-1 flex items-center gap-0.5 rounded-full border bg-card px-1 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
      <button className="rounded-full p-1 hover:bg-accent hover:text-foreground disabled:opacity-40" disabled={sibling.index <= 0} onClick={() => onSibling(-1)} aria-label="Previous branch"><ChevronLeft className="size-3.5" /></button>
      <span className="tabular-nums px-0.5">{sibling.index + 1}/{sibling.count}</span>
      <button className="rounded-full p-1 hover:bg-accent hover:text-foreground disabled:opacity-40" disabled={sibling.index >= sibling.count - 1} onClick={() => onSibling(1)} aria-label="Next branch"><ChevronRight className="size-3.5" /></button>
    </span>
  );
}

function IconBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={cn("rounded-full p-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground hover:scale-[1.06] active:scale-[0.96]", active && "bg-brand-soft text-brand hover:bg-brand-soft")}>
      {children}
    </button>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-2 py-3" aria-label="Thinking">
      <span className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 shadow-sm">
        <span className="size-1.5 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-brand/70 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-brand/50 [animation-delay:300ms]" />
        <span className="ml-1 text-xs font-medium text-muted-foreground">RIVO is thinking…</span>
      </span>
    </div>
  );
}

function Attachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {attachments.map((a, i) =>
        a.dataUrl ? (
          <a key={i} href={a.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border shadow-sm transition-transform hover:scale-[1.02]">
            <img src={a.dataUrl} alt={a.name} className="max-h-64 max-w-[280px] object-cover" draggable={false} />
          </a>
        ) : (
          <span key={i} className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm">
            <FileText className="size-3.5 text-brand" /> {a.name} <span className="text-[10px] text-muted-foreground">{formatSize(a.size)}</span>
          </span>
        ),
      )}
    </div>
  );
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
