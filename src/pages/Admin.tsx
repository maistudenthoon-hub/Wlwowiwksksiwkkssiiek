import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  watchAllUsers,
  banUser,
  unbanUser,
  fetchGeminiKey,
  saveGeminiKey,
  invalidateGeminiKeyCache,
  isAdminUser,
  ADMIN_EMAIL,
  TESTING_MODE,
  type AdminUserRow,
  fetchUsageStats,
  type UsageStats,
  fetchSystemPrompt,
  saveSystemPrompt,
  type SystemPromptDoc,
  exportAllData,
} from "@/lib/firebase-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Activity, KeyRound, Loader2, MessageSquare, Search, Settings, Users } from "lucide-react";
import { toast } from "sonner";

type TabId = "overview" | "users" | "content" | "ai";
const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "users", label: "Users", icon: Users },
  { id: "content", label: "AI behavior", icon: MessageSquare },
  { id: "ai", label: "AI key", icon: KeyRound },
];

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  if (isLoading && !TESTING_MODE) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!TESTING_MODE && (!user || !isAdminUser(user))) {
    return <Navigate to="/" replace />;
  }
  return <AdminPanel />;
}

function AdminPanel() {
  const [tab, setTab] = useState<TabId>("overview");
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex items-center gap-2 font-display text-[15px] font-semibold">
            <Settings className="size-4 text-brand" /> RIVO Admin
          </span>
          <nav className="ml-auto flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                  tab === t.id ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {TESTING_MODE && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-xs text-amber-500 font-medium">
          🧪 Testing Mode Active: Admin access is open to everyone. Reply &quot;testing done&quot; to restore security restrictions.
        </div>
      )}

      <div className="rivo-scroll-thin mx-auto max-w-5xl px-4 py-6">
        {tab === "overview" && <OverviewTab />}
        {tab === "users" && <UsersTab />}
        {tab === "content" && <ContentTab />}
        {tab === "ai" && <AiKeyTab />}
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------- */
/* Overview                                                          */
/* ---------------------------------------------------------------- */

function OverviewTab() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchUsageStats().then(setStats).catch(() => {});
  }, []);

  const cards = [
    { label: "Users", value: stats?.totalUsers ?? "—" },
    { label: "Active today", value: stats?.activeToday ?? "—" },
    { label: "Conversations", value: stats?.totalConversations ?? "—" },
    { label: "Messages", value: stats?.totalMessages ?? "—" },
  ];

  const exportAll = async () => {
    setExporting(true);
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rivo-admin-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch {
      toast.error("Couldn't export");
    }
    setExporting(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{c.value}</p>
          </div>
        ))}
      </div>

      {stats && Object.keys(stats.modelUsage ?? {}).length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Conversations by model</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(stats.modelUsage).map(([m, n]) => (
              <span key={m} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
                {m} · <span className="font-semibold">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Backup</p>
          <p className="text-xs text-muted-foreground">Download every conversation and message as JSON.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void exportAll()} disabled={exporting}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : "Download backup"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Signed in as {user?.email || ADMIN_EMAIL}. Chat works with zero setup — the AI key tab is only needed if you want to use your own Gemini quota.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Users                                                             */
/* ---------------------------------------------------------------- */

function UsersTab() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [q, setQ] = useState("");
  const [banning, setBanning] = useState<AdminUserRow | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    try {
      const unsub = watchAllUsers((u) => setUsers(u));
      return () => unsub();
    } catch {
      return () => {};
    }
  }, []);

  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          !q.trim() ||
          (u.email ?? "").toLowerCase().includes(q.toLowerCase()) ||
          (u.name ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
    [users, q],
  );

  const doBan = async () => {
    if (!banning) return;
    try {
      await banUser(banning.id, { reason: reason.trim() || "Violation of terms", days: 7 });
      toast.success(`${banning.email ?? "User"} banned for 7 days`);
    } catch {
      toast.error("Couldn't ban user");
    }
    setBanning(null);
    setReason("");
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" className="pl-9" />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {filtered.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No users found.</p>}
        {filtered.slice(0, 100).map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {u.name ?? "Unnamed"} {u.role === "admin" && <span className="ml-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">admin</span>}
                {u.isBanned && <span className="ml-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">banned</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">{u.email ?? u.id}</p>
            </div>
            {u.role !== "admin" &&
              (u.isBanned ? (
                <Button size="sm" variant="outline" onClick={() => unbanUser(u.id).then(() => toast.success("User unbanned")).catch(() => toast.error("Couldn't unban"))}>
                  Unban
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setBanning(u)}>
                  Ban
                </Button>
              ))}
          </div>
        ))}
      </div>

      {banning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBanning(null)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">Ban {banning.email ?? "user"}?</p>
            <Label className="mt-3 block text-xs text-muted-foreground">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Violation of terms" className="mt-1.5" />
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setBanning(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={() => void doBan()}>Ban for 7 days</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* AI behavior (system prompt)                                       */
/* ---------------------------------------------------------------- */

function ContentTab() {
  const [doc, setDoc] = useState<SystemPromptDoc | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSystemPrompt().then((d) => {
      setDoc(d);
      setContent(d?.content ?? "");
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await saveSystemPrompt({ content: content.trim(), presets: doc?.presets ?? [] });
      toast.success("AI behavior saved");
    } catch {
      toast.error("Couldn't save");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">System prompt</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to every conversation. Leave empty for the default RIVO behavior.
        </p>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="You are RIVO…" className="mt-2 min-h-44 font-mono text-[13px]" />
      </div>
      <Button size="sm" onClick={() => void save()} disabled={saving} className="rivo-btn-brand rounded-full">
        {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* AI key (optional upgrade — chat works without it)                 */
/* ---------------------------------------------------------------- */

function AiKeyTab() {
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetchGeminiKey().then((k) => {
      setSavedKey(k);
      setKey(k ?? "");
    }).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await saveGeminiKey(key.trim());
      invalidateGeminiKeyCache();
      setSavedKey(key.trim() || null);
      toast.success(key.trim() ? "Key saved" : "Key removed");
    } catch {
      toast.error("Couldn't save key");
    }
  };

  const testKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { testGeminiKey } = await import("@/lib/ai");
      const ok = await testGeminiKey(key.trim());
      setTestResult(ok ? "✅ Key works — Gemini replied" : "❌ Key rejected by Google");
    } catch (e) {
      setTestResult("❌ " + (e instanceof Error ? e.message : String(e)).slice(0, 200));
    }
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand/20 bg-brand-soft/50 p-4">
        <p className="text-sm font-medium">Chat already works without a key</p>
        <p className="mt-1 text-xs text-muted-foreground">
          RIVO answers using a free built-in provider. Adding a Gemini key switches chat to your own quota — nothing else changes.
        </p>
      </div>

      <div>
        <Label className="text-sm font-medium">Gemini API key (optional)</Label>
        <p className="mt-1 text-xs text-muted-foreground">Free at aistudio.google.com/apikey — starts with AIza or AQ.</p>
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste key to use your own quota, or clear to remove"
          className="mt-2 font-mono"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} className="rivo-btn-brand rounded-full">Save</Button>
        <Button size="sm" variant="outline" onClick={() => void testKey()} disabled={testing || !key.trim()}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : "Test key"}
        </Button>
        {savedKey && <span className="text-xs text-muted-foreground">Saved: ••••{savedKey.slice(-4)}</span>}
      </div>

      {testResult && (
        <p className={cn("rounded-xl border px-3.5 py-3 text-sm", testResult.startsWith("✅") ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" : "border-destructive/30 bg-destructive/5 text-destructive")}>
          {testResult}
        </p>
      )}

      <hr className="border-border" />
      <p className="text-xs text-muted-foreground">
        If a key is saved but rejected by Google, RIVO automatically falls back to the built-in free provider — chat never goes silent.
      </p>
    </div>
  );
}
