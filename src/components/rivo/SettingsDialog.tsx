import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  deleteAllConversations as fbDeleteAll,
  getMyProfile as fbGetProfile,
  saveCustomInstructions as fbSaveInstructions,
  saveProfile as fbSaveProfile,
  exportAllData as fbExport,
  type ThemeChoice,
} from "@/lib/firebase-db";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Download, Monitor, Moon, Sun, Trash2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isSoundMuted, setSoundMuted } from "@/lib/sound";

/* ---------------- Theme (kept for main.tsx) ---------------- */
function applyThemeToDom(choice: ThemeChoice) {
  const root = document.documentElement;
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}
export function initTheme() {
  const stored = localStorage.getItem("rivo-theme");
  const choice: ThemeChoice = stored === "light" || stored === "dark" ? stored : "system";
  applyThemeToDom(choice);
  if (choice === "system") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", () => applyThemeToDom("system"));
  }
}

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [respond, setRespond] = useState("");
  const [muted, setMuted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) return;
    const stored = localStorage.getItem("rivo-theme");
    setTheme(stored === "light" || stored === "dark" ? stored : "system");
    setMuted(isSoundMuted());
    fbGetProfile().then((p) => {
      setName(p?.name ?? "");
      setAbout(p?.customInstructions?.about ?? "");
      setRespond(p?.customInstructions?.respond ?? "");
    }).catch(() => {});
    setConfirmClear(false);
  }, [open]);

  const pickTheme = (t: ThemeChoice) => {
    setTheme(t);
    localStorage.setItem("rivo-theme", t);
    applyThemeToDom(t);
  };

  const savePersonal = async () => {
    try {
      if (name.trim()) await fbSaveProfile({ name: name.trim() });
      await fbSaveInstructions({ about: about.trim(), respond: respond.trim() });
      toast.success("Saved");
    } catch {
      toast.error("Couldn't save — check your connection");
    }
  };

  const exportData = async () => {
    try {
      const data = await fbExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rivo-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Couldn't export");
    }
  };

  const clearAll = async () => {
    try {
      await fbDeleteAll();
      toast.success("All chats deleted");
      setConfirmClear(false);
    } catch {
      toast.error("Couldn't delete chats");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold">Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {user?.email ?? "Your account"}
          </DialogDescription>
        </DialogHeader>

        <div className="rivo-scroll-thin max-h-[62vh] space-y-5 overflow-y-auto px-5 py-5">
          {/* Appearance */}
          <section>
            <h3 className="text-[13px] font-semibold">Appearance</h3>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTheme(t.id)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-all",
                    theme === t.id ? "border-brand/40 bg-brand-soft text-brand" : "border-border bg-card text-muted-foreground hover:border-border hover:bg-accent",
                  )}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Profile + custom instructions */}
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold">Personalization</h3>
            <div>
              <Label htmlFor="set-name" className="text-xs text-muted-foreground">Name</Label>
              <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="set-about" className="text-xs text-muted-foreground">What should RIVO know about you?</Label>
              <Textarea id="set-about" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. I'm a designer; prefer concise answers" className="mt-1.5 min-h-16" />
            </div>
            <div>
              <Label htmlFor="set-respond" className="text-xs text-muted-foreground">How should RIVO respond?</Label>
              <Textarea id="set-respond" value={respond} onChange={(e) => setRespond(e.target.value)} placeholder="e.g. Friendly, with short paragraphs" className="mt-1.5 min-h-16" />
            </div>
            <Button size="sm" onClick={savePersonal} className="rivo-btn-brand rounded-full">Save</Button>
          </section>

          <Separator />

          {/* Sound */}
          <section className="flex items-center justify-between rounded-xl border bg-card px-3.5 py-3">
            <div>
              <p className="text-sm font-medium">Sounds</p>
              <p className="text-xs text-muted-foreground">Subtle ticks while chatting</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => { import("@/lib/sound").then(({ sounds }) => sounds.send()); }} aria-label="Test sound">
                <Volume2 className="size-4" />
              </Button>
              <Switch
                checked={!muted}
                onCheckedChange={(v) => { setMuted(!v); setSoundMuted(!v); }}
                aria-label="Toggle sounds"
              />
              {muted && <VolumeX className="size-4 text-muted-foreground" />}
            </div>
          </section>

          <Separator />

          {/* Data */}
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold">Data</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={exportData}>
                <Download className="size-4" /> Export my data
              </Button>
              {!confirmClear ? (
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmClear(true)}>
                  <Trash2 className="size-4" /> Clear all chats
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="destructive" onClick={clearAll}>Delete everything</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Exports include all conversations and messages as JSON.</p>
          </section>

          <Separator />

          <section className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Signed in as {user?.email ?? "—"}</p>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => signOut().then(() => (window.location.href = "/"))}>
              Sign out
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
