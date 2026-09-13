import { cn } from "@/lib/utils";
import { Check, Copy, Download, ImageIcon, Loader2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rivoLogo from "@/assets/rivo-logo.png";

const LANG_LABELS: Record<string, string> = {
  js: "JavaScript", jsx: "JSX", javascript: "JavaScript",
  ts: "TypeScript", tsx: "TSX", typescript: "TypeScript",
  py: "Python", python: "Python",
  sh: "Shell", bash: "Bash", shell: "Shell",
  json: "JSON", yaml: "YAML", yml: "YAML",
  html: "HTML", css: "CSS", sql: "SQL",
  go: "Go", rust: "Rust", rs: "Rust",
  java: "Java", cpp: "C++", c: "C", cs: "C#",
  ruby: "Ruby", php: "PHP", swift: "Swift", kotlin: "Kotlin",
  markdown: "Markdown", md: "Markdown",
};

function prettyLang(lang: string): string {
  return LANG_LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as { props?: { children?: React.ReactNode } })) {
    return extractText((node as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const langMatch = /language-([\w-]+)/.exec(className ?? "");
  const lang = langMatch?.[1] ?? "text";
  const handleCopy = useCallback(() => {
    const text = extractText(children);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  }, [children]);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 py-1.5 pl-3.5 pr-1.5 backdrop-blur">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/90">{prettyLang(lang)}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:border-border hover:bg-card hover:text-foreground">
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={cn("rivo-code-light dark:rivo-code-dark")}>{children}</pre>
    </div>
  );
}

function GeneratedImage({ url, alt }: { url: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rivo-image-${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch {
      window.open(url, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-border shadow-sm">
      <div className="relative bg-muted/30">
        {state === "loading" && (
          <div className="flex aspect-square w-full max-w-md items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">Painting your image…</span>
            </div>
          </div>
        )}
        {state === "error" ? (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-4 text-sm text-brand hover:underline">
            <ImageIcon className="size-4" /> Open generated image
          </a>
        ) : (
          <img
            src={url}
            alt={alt}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            className={cn("block max-w-md w-full object-cover transition-opacity duration-500", state === "ok" ? "opacity-100" : "hidden")}
            draggable={false}
          />
        )}
        {state === "ok" && (
          <button
            onClick={download}
            disabled={downloading}
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover/msg:opacity-100 [figure:hover>&]:opacity-100"
          >
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Download
          </button>
        )}
      </div>
    </figure>
  );
}

const markdownComponents: Components = {
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    let codeClass = "";
    if (child && typeof child === "object" && "props" in (child as { props?: { className?: string } })) {
      codeClass = (child as { props?: { className?: string } }).props?.className ?? "";
    }
    return <CodeBlock className={codeClass}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : undefined;
    if (!url) return null;
    if (/^https:\/\//.test(url)) return <GeneratedImage url={url} alt={alt ?? ""} />;
    return null;
  },
};

interface MessageContentProps { content: string; className?: string; }
export const MessageContent = memo(function MessageContent({ content, className }: MessageContentProps) {
  return (
    <div className={cn("rivo-prose", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export function RivoOrb({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-[0_2px_10px_-2px_var(--brand-soft)] ring-1 ring-border/20", className ?? "size-7")} aria-hidden>
      <img src={rivoLogo} alt="" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}
