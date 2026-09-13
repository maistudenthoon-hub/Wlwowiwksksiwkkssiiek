import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Attachment } from "@/lib/rivo";
import { cn } from "@/lib/utils";
import { ArrowUp, FileText, Globe, Lightbulb, Mic, Paperclip, Slash, Square, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { sounds, haptic } from "@/lib/sound";

interface InputDockProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  streaming: boolean;
  webSearch: boolean;
  onWebSearchChange: (v: boolean) => void;
  reasoning: boolean;
  onReasoningChange: (v: boolean) => void;
  autoFocus?: boolean;
  restoredDraft?: string | null;
}

const MAX_FILES = 4;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // downscale guard
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|scss|jsx?|tsx?|py|rb|go|rs|java|c|cpp|h|sh|sql|toml|ini|env|log|gitignore)$/i;

async function readFileSmart(file: File): Promise<Attachment> {
  const base: Attachment = { name: file.name, type: file.type || "file", size: file.size };
  if (file.type.startsWith("image/")) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Couldn't read image"));
      r.readAsDataURL(file);
    });
    // Downscale big images so AI + Firestore stay happy
    const small = await downscaleImage(dataUrl, file.size > MAX_IMAGE_BYTES ? 1024 : 1600);
    return { ...base, dataUrl: small, type: "image" };
  }
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name) || file.type === "application/json") {
    const text = await file.text();
    return { ...base, text: text.slice(0, 200_000), type: "text" };
  }
  // PDFs and unknown types: best-effort text extraction for text-ish files
  try {
    const text = await file.slice(0, 200_000).text();
    const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, "").trim();
    if (printable.length > 80) return { ...base, text: printable, type: "text" };
  } catch { /* binary — skip */ }
  return base;
}

function downscaleImage(dataUrl: string, maxEdge: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------------- Voice input (Web Speech API) ---------------- */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = navigator.language || "en-US";
  r.continuous = true;
  r.interimResults = true;
  return r;
}

/* ---------------- Slash commands (superpowers, zero clutter) ---------------- */

const SLASH_COMMANDS = [
  { cmd: "/image", args: "<description>", hint: "Generate an image" },
  { cmd: "/summarize", args: "<text>", hint: "Condense any text" },
  { cmd: "/explain", args: "<topic>", hint: "Explain simply, with examples" },
  { cmd: "/translate", args: "<text>", hint: "Detect + translate to English" },
  { cmd: "/code", args: "<task>", hint: "Write code with comments" },
  { cmd: "/brainstorm", args: "<topic>", hint: "10 fresh ideas" },
  { cmd: "/improve", args: "<text>", hint: "Rewrite clearer & sharper" },
  { cmd: "/plan", args: "<goal>", hint: "Step-by-step action plan" },
] as const;

const SLASH_PATTERNS: Record<string, (arg: string) => string> = {
  "/summarize": (a) => `Summarize the following in 3-5 crisp bullet points:\n\n${a}`,
  "/explain": (a) => `Explain \"${a}\" simply, with a real-world example and one analogy.`,
  "/translate": (a) => `Detect the language and translate the following to English (keep tone):\n\n${a}`,
  "/code": (a) => `Write clean, commented code for this task. Include a short usage example:\n\n${a}`,
  "/brainstorm": (a) => `Brainstorm 10 fresh, non-obvious ideas about: ${a}. Number them, one line each.`,
  "/improve": (a) => `Rewrite the following to be clearer and sharper while keeping my voice:\n\n${a}`,
  "/plan": (a) => `Create a concrete step-by-step plan for: ${a}. Number the steps with time estimates.`,
};

export function InputDock({
  onSend,
  onStop,
  streaming,
  webSearch,
  onWebSearchChange,
  reasoning,
  onReasoningChange,
  autoFocus,
  restoredDraft,
}: InputDockProps) {
  const [value, setValue] = useState(restoredDraft ?? "");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseValueRef = useRef("");

  // Slash command autocomplete — /image is forced image generation
  const slashMatch = /^\/(\w*)(\s+(.*))?$/s.exec(value.trimStart());
  const slashActive = !!slashMatch && value.trimStart().startsWith("/") && !value.includes("\n");
  const slashPrefix = slashMatch?.[1] ?? "";
  const slashArg = slashMatch?.[3] ?? "";
  const slashMatches = slashActive
    ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashPrefix.toLowerCase()))
    : [];

  useEffect(() => {
    if (restoredDraft && restoredDraft !== value) {
      setValue(restoredDraft);
      requestAnimationFrame(resize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredDraft]);

  const canSend = !streaming && (value.trim().length > 0 || files.length > 0);

  const resize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  };
  useEffect(resize, [value]);
  useEffect(() => { if (autoFocus) taRef.current?.focus(); }, [autoFocus]);

  const submit = () => {
    if (!canSend) return;
    stopListening();
    sounds.send();
    haptic("medium");
    let text = value;
    // Expand known slash commands (except /image which RIVO detects natively)
    const m = /^\/(\w+)(\s+([\s\S]+))?$/.exec(value.trim());
    if (m && SLASH_PATTERNS[`/${m[1]}`]) {
      const arg = (m[3] ?? "").trim();
      text = SLASH_PATTERNS[`/${m[1]}`](arg || "(no input given — ask me for the text)");
    }
    onSend(text, files.length ? files : undefined);
    setValue("");
    setFiles([]);
    requestAnimationFrame(resize);
  };

  const applySlash = (cmd: string) => {
    setValue(`${cmd} `);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0 && e.key === "Tab" && slashMatches[0]) {
      e.preventDefault();
      applySlash(slashMatches[0].cmd);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const addFiles = useCallback(async (list: FileList | File[] | null) => {
    if (!list) return;
    const picked = Array.from(list).slice(0, MAX_FILES);
    const loaded = await Promise.all(picked.map(readFileSmart));
    setFiles((prev) => [...prev, ...loaded].slice(0, MAX_FILES));
    if (loaded.length) sounds.tap();
  }, []);

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); };
  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => { void addFiles(e.target.files); e.target.value = ""; };
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
  };

  const startListening = () => {
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    baseValueRef.current = value ? value + " " : "";
    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setValue((baseValueRef.current + final + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    setListening(true);
    sounds.tap();
  };
  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };
  useEffect(() => () => stopListening(), []);

  return (
    <div className="pointer-events-none sticky bottom-0 z-10">
      <div className="pointer-events-none h-6 bg-gradient-to-t from-background via-background/80 to-transparent" />
      <div className="pointer-events-auto bg-background/90 px-4 pb-4 backdrop-blur-xl md:px-6">
        <div className="mx-auto max-w-3xl">
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <motion.span key={`${f.name}-${i}`} layout initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-1.5 rounded-full border bg-card py-1 pl-1 pr-2 text-xs shadow-sm">
                    {f.dataUrl ? (
                      <img src={f.dataUrl} alt="" className="size-7 rounded-full object-cover" />
                    ) : (
                      <span className="flex size-7 items-center justify-center rounded-full bg-muted"><FileText className="size-3.5 text-brand" /></span>
                    )}
                    <span className="max-w-32 truncate font-medium">{f.name}</span>
                    <button onClick={() => { sounds.tap(); setFiles((p) => p.filter((_, j) => j !== i)); }} className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label={`Remove ${f.name}`}>
                      <X className="size-3.5" />
                    </button>
                  </motion.span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "relative flex flex-col rounded-[28px] border bg-card/90 shadow-[0_8px_32px_-16px_oklch(0_0_0/22%),0_1px_2px_oklch(0_0_0/6%)] backdrop-blur transition-all",
              dragging ? "border-brand shadow-[0_8px_32px_-12px_var(--brand-soft)] ring-2 ring-brand/15" : "border-border/70",
              "focus-within:border-brand/40 focus-within:shadow-[0_8px_32px_-12px_var(--brand-soft)] focus-within:ring-2 focus-within:ring-brand/10"
            )}
            animate={dragging ? { scale: 1.01 } : { scale: 1 }}
          >
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[28px] bg-brand-soft">
                <span className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold shadow">Drop files here</span>
              </div>
            )}
            {slashMatches.length > 0 && slashActive && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-2xl border bg-popover p-1 shadow-xl">
                {slashMatches.map((c) => (
                  <button
                    key={c.cmd}
                    onClick={() => applySlash(c.cmd)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <Slash className="size-3.5 shrink-0 text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{c.cmd} <span className="text-muted-foreground">{c.args}</span></span>
                      <span className="block truncate text-[11px] text-muted-foreground">{c.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKey}
              onPaste={onPaste}
              placeholder={listening ? "Listening…" : "Message RIVO — / for commands, or “draw a…” for art"}
              className="max-h-60 min-h-[52px] resize-none border-0 bg-transparent px-5 pb-1 pt-4 text-[15px] leading-relaxed shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
              rows={1}
            />
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => { sounds.tap(); fileRef.current?.click(); }} className="rounded-full p-2.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground hover:rotate-3" aria-label="Attach files or images" onMouseEnter={() => sounds.hover()}>
                    <Paperclip className="size-[18px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach files or images</TooltipContent>
              </Tooltip>
              <input ref={fileRef} type="file" multiple hidden accept="image/*,.txt,.md,.csv,.json,.pdf,.js,.ts,.tsx,.py,.html,.css,.xml,.yml,.yaml,.sql,.log,.sh" onChange={onFileInput} />

              <ToggleChip active={webSearch} onClick={() => { sounds.switch(); haptic("light"); onWebSearchChange(!webSearch); }} icon={<Globe className="size-4" />} label="Search" />
              <ToggleChip active={reasoning} onClick={() => { sounds.switch(); haptic("light"); onReasoningChange(!reasoning); }} icon={<Lightbulb className="size-4" />} label="Think" />

              <div className="flex-1" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => (listening ? stopListening() : startListening())}
                    className={cn("rounded-full p-2.5 transition-all", listening ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
                    aria-label={listening ? "Stop voice input" : "Voice input"}
                  >
                    <Mic className={cn("size-[18px]", listening && "animate-pulse")} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{listening ? "Stop voice input" : "Voice input"}</TooltipContent>
              </Tooltip>

              <AnimatePresence mode="wait" initial={false}>
                {streaming ? (
                  <motion.button
                    key="stop"
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => { sounds.tap(); haptic("medium"); onStop(); }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-md transition-all hover:scale-[1.04] active:scale-[0.97]"
                    aria-label="Stop generating"
                  >
                    <Square className="size-3.5 fill-current" />
                  </motion.button>
                ) : (
                  <motion.button
                    key="send"
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={submit}
                    disabled={!canSend}
                    className={cn("flex size-9 shrink-0 items-center justify-center rounded-full shadow-md transition-all", canSend ? "rivo-btn-brand hover:scale-[1.04] active:scale-[0.97]" : "bg-muted text-muted-foreground")}
                    aria-label="Send message"
                    onMouseEnter={() => canSend && sounds.hover()}
                  >
                    <ArrowUp className="size-[18px]" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          <p className="flex items-center justify-center pt-2.5 text-center text-[11px] text-muted-foreground/80">
            RIVO can make mistakes. Check important info.
          </p>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={onClick} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[13px] font-medium transition-all", active ? "border-brand/20 bg-brand text-white shadow-sm hover:brightness-[0.98]" : "border-transparent bg-muted/60 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground")} aria-pressed={active} onMouseEnter={() => sounds.hover()}>
          {icon}
          <span className="hidden md:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
