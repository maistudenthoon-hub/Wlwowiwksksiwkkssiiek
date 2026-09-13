import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { renameConversation as fbRename, setConversationArchived as fbArchive, setConversationPinned as fbPin, deleteConversation as fbDelete, TESTING_MODE, isAdminUser } from "@/lib/firebase-db";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { GROUP_ORDER, groupKeyFor, type HistoryGroup, type SidebarConversation } from "@/lib/rivo";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronsUpDown,
  Ellipsis,
  LogOut,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { sounds, haptic } from "@/lib/sound";
import { useEffect } from "react";

/** Local hook: one-shot fetch of all conversations+messages for search. */
function useSearchIndex(searchTerm: string) {
  const [index, setIndex] = useState<
    { id: string; title: string; updatedAt: number; isPinned: boolean; snippet?: string; messageContents: string[] }[] | null
  >(null);
  useEffect(() => {
    if (!searchTerm.trim()) { setIndex(null); return; }
    import("@/lib/firebase-db").then(({ fetchAllConversationsWithMessages }) => {
      fetchAllConversationsWithMessages().then(setIndex).catch(() => {});
    });
  }, [searchTerm]);
  return index;
}

interface SidebarProps {
  conversations: SidebarConversation[];
  activeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (id: string | null) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  open,
  onOpenChange,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onNewChat,
  onOpenSettings,
}: SidebarProps) {
  const { user, firebaseUser, signOut, isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const archivedConvs: SidebarConversation[] | null = null;
  const searchIndex = useSearchIndex(search);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    const titleMatches = conversations.filter((c) => c.title.toLowerCase().includes(q));
    const contentMatches: SidebarConversation[] = [];
    if (searchIndex) {
      const inTitles = new Set(titleMatches.map((c) => c.id));
      for (const entry of searchIndex) {
        if (inTitles.has(entry.id)) continue;
        if (entry.messageContents?.some((m) => m.toLowerCase().includes(q))) {
          contentMatches.push({ _id: entry.id as string, id: entry.id as string, title: entry.title, updatedAt: entry.updatedAt, isPinned: entry.isPinned });
        }
      }
    }
    return [...titleMatches, ...contentMatches];
  }, [conversations, search, searchIndex]);

  const grouped = useMemo(() => {
    const groups = new Map<HistoryGroup, SidebarConversation[]>();
    for (const conv of filtered) {
      const key = groupKeyFor(conv.updatedAt ?? 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conv);
    }
    for (const [, list] of groups) list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return groups;
  }, [filtered]);

  const pinned = useMemo(() => filtered.filter((c) => c.isPinned), [filtered]);

  const handleRename = async () => {
    if (!renameId) return;
    const title = renameValue.trim();
    if (title) {
      await fbRename(renameId, title);
      toast.success("Chat renamed");
      sounds.success();
    }
    setRenameId(null);
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    await fbDelete(deleteId);
    setDeleteId(null);
    toast.success("Chat deleted");
    sounds.tap();
    if (activeId === deleteId) onNavigate(null);
  };
  const shareChat = async (id: string, title: string) => {
    const url = `${window.location.origin}/c/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link to “${title}” copied`);
      sounds.tap();
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const content = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <button
          onClick={() => { sounds.tap(); onNavigate(null); }}
          className="flex items-center gap-2 rounded-xl px-1 py-1 transition-all hover:bg-sidebar-accent/60"
          aria-label="RIVO home"
          onMouseEnter={() => sounds.hover()}
        >
          <span className="rivo-wordmark text-[18px] tracking-[-0.04em] select-none">RIVO<span className="text-brand">.</span></span>
        </button>
        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:bg-sidebar-accent" onClick={() => { sounds.tap(); onToggleCollapsed(); }} aria-label="Collapse sidebar">
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="px-3 pb-2 pt-1">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => { sounds.tap(); haptic("light"); onNewChat(); }}
            onMouseEnter={() => sounds.hover()}
            className="flex-1 justify-start gap-2 rounded-xl bg-brand-soft px-2.5 py-2 text-sm font-semibold text-brand ring-1 ring-brand/10 hover:bg-brand hover:text-white hover:ring-brand"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-white/80 text-brand shadow-sm group-hover:bg-white"><Plus className="size-3.5" /></span>
            New chat
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-xl text-muted-foreground hover:bg-sidebar-accent"
                onClick={() => { sounds.tap(); setSearchOpen((s) => !s); if (!searchOpen) setTimeout(() => document.getElementById("rivo-search")?.focus(), 50); }}
                aria-label="Search chats"
              >
                <Search className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search chats</TooltipContent>
          </Tooltip>
        </div>
        <AnimatePresence>
          {searchOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="rivo-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="h-9 rounded-xl bg-background pl-8 pr-8 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-brand/20" autoFocus />
                <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => { setSearch(""); setSearchOpen(false); sounds.tap(); }} aria-label="Close search"><X className="size-4" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ScrollArea className="rivo-scroll-thin min-h-0 flex-1 px-2">
        <div className="pr-1.5 pb-2">
          {pinned.length > 0 && !search && (
            <SidebarSection title="Pinned" items={pinned} activeId={activeId} onNavigate={(id) => { sounds.tap(); onNavigate(id); }} onRename={(c) => { setRenameId(c.id); setRenameValue(c.title); }} onArchive={(c) => { sounds.tap(); fbArchive(c.id, true); }} onPin={(c) => { sounds.switch(); fbPin(c.id, !c.isPinned); }} onDelete={(c) => setDeleteId(c.id)} onShare={(c) => shareChat(c.id, c.title)} />
          )}
          {GROUP_ORDER.map((group) => {
            const items = grouped.get(group);
            if (!items || items.length === 0) return null;
            return (
              <SidebarSection
                key={group}
                title={group}
                items={items}
                activeId={activeId}
                onNavigate={(id) => { sounds.tap(); onNavigate(id); }}
                onRename={(c) => { setRenameId(c.id); setRenameValue(c.title); }}
                onArchive={(c) => { sounds.tap(); fbArchive(c.id, true); }}
                onPin={(c) => { sounds.switch(); fbPin(c.id, !c.isPinned); }}
                onDelete={(c) => setDeleteId(c.id)}
                onShare={(c) => shareChat(c.id, c.title)}
              />
            );
          })}
          {filtered.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-10 text-center">
              <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Search className="size-4" /></div>
              <p className="mt-3 text-xs text-muted-foreground">{search ? "No chats match your search." : "No chats yet — start one!"}</p>
            </motion.div>
          )}
          <button className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={() => { sounds.tap(); setShowArchived(true); }}>
            <Archive className="size-3.5" /> Archived chats
          </button>
        </div>
      </ScrollArea>

      <div className="p-2">
        <Separator className="mb-2 bg-sidebar-border" />
        <ProfileMenu user={user ?? null} firebaseUser={firebaseUser} isAuthenticated={isAuthenticated} onOpenSettings={() => { sounds.tap(); onOpenSettings(); }} onSignOut={async () => { sounds.tap(); await signOut(); }} />
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="left" className="w-[300px] border-sidebar-border bg-sidebar p-0 [&>button]:hidden">
            <SheetHeader className="sr-only"><SheetTitle>Chats</SheetTitle></SheetHeader>
            {content}
          </SheetContent>
        </Sheet>
        <RenameDialog open={renameId !== null} value={renameValue} onValueChange={setRenameValue} onOpenChange={(o) => !o && setRenameId(null)} onSubmit={handleRename} />
        <DeleteDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)} onConfirm={handleDelete} />
        <ArchivedDialog open={showArchived} onOpenChange={setShowArchived} archived={archivedConvs ?? []} onUnarchive={(id) => fbArchive(id, false)} onDelete={(id) => fbDelete(id)} />
      </>
    );
  }

  return (
    <>
      <aside className={cn("relative z-20 h-full shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]", collapsed ? "w-0 border-r-0" : "w-[280px]")}>{content}</aside>
      <RenameDialog open={renameId !== null} value={renameValue} onValueChange={setRenameValue} onOpenChange={(o) => !o && setRenameId(null)} onSubmit={handleRename} />
      <DeleteDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)} onConfirm={handleDelete} />
      <ArchivedDialog open={showArchived} onOpenChange={setShowArchived} archived={archivedConvs ?? []} onUnarchive={(id) => fbArchive(id, false)} onDelete={(id) => fbDelete(id)} />
    </>
  );
}

function SidebarSection({ title, items, activeId, onNavigate, onRename, onArchive, onPin, onDelete, onShare }: { title: string; items: SidebarConversation[]; activeId: string | null; onNavigate: (id: string) => void; onRename: (c: SidebarConversation) => void; onArchive: (c: SidebarConversation) => void; onPin: (c: SidebarConversation) => void; onDelete: (c: SidebarConversation) => void; onShare: (c: SidebarConversation) => void; }) {
  return (
    <div className="mb-1.5">
      <div className="px-3 pb-1.5 pt-3 text-[11px] font-semibold tracking-widest text-muted-foreground/70">{title.toUpperCase()}</div>
      <div className="space-y-0.5">
        {items.map((c) => (
          <ChatListItem key={c.id} conv={c} active={c.id === activeId} onNavigate={onNavigate} onRename={onRename} onArchive={onArchive} onPin={onPin} onDelete={onDelete} onShare={onShare} />
        ))}
      </div>
    </div>
  );
}

function ChatListItem({ conv, active, onNavigate, onRename, onArchive, onPin, onDelete, onShare }: { conv: SidebarConversation; active: boolean; onNavigate: (id: string) => void; onRename: (c: SidebarConversation) => void; onArchive: (c: SidebarConversation) => void; onPin: (c: SidebarConversation) => void; onDelete: (c: SidebarConversation) => void; onShare: (c: SidebarConversation) => void; }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("group relative flex items-center rounded-xl border border-transparent", active ? "border-border bg-sidebar-accent shadow-sm" : "hover:border-border/60 hover:bg-sidebar-accent/50")}>
      <button onClick={() => onNavigate(conv.id)} className="flex-1 truncate px-3 py-2 text-left text-sm font-[450] text-sidebar-foreground/90" title={conv.title}>
        <span className="flex items-center gap-2">
          {conv.isPinned && <Pin className="size-3 shrink-0 text-brand" />}
          <span className="truncate">{conv.title}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("mr-1 size-7 shrink-0 rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-background focus-visible:opacity-100 group-hover:opacity-100", active && "opacity-100")} onClick={(e) => e.stopPropagation()} aria-label="Chat options"><Ellipsis className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-44 rounded-xl p-1 shadow-xl">
          <DropdownMenuItem onClick={() => onShare(conv)} className="rounded-lg"><Share2 className="size-4" /> Share</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPin(conv)} className="rounded-lg">{conv.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}{conv.isPinned ? "Unpin" : "Pin"}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(conv)} className="rounded-lg"><Pencil className="size-4" /> Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onArchive(conv)} className="rounded-lg"><Archive className="size-4" /> Archive</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDelete(conv)} className="rounded-lg text-destructive focus:text-destructive"><Trash2 className="size-4" /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  );
}

function ProfileMenu({ user, firebaseUser, isAuthenticated, onOpenSettings, onSignOut }: { user: { name?: string; email?: string; image?: string; provider?: string } | null; firebaseUser: import("firebase/auth").User | null; isAuthenticated: boolean; onOpenSettings: () => void; onSignOut: () => void; }) {
  const [open, setOpen] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <button
          onClick={() => { sounds.tap(); window.location.href = "/auth"; }}
          className="flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-sidebar-accent/50 px-3 py-2 text-left text-sm font-medium text-sidebar-foreground transition-all hover:border-border hover:bg-sidebar-accent"
          onMouseEnter={() => sounds.hover()}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LogOut className="size-3" />
          </span>
          Sign in
        </button>
        {(TESTING_MODE || isAdminUser(user)) && (
          <button
            onClick={() => { sounds.tap(); window.location.href = "/admin"; }}
            className="flex w-full items-center gap-2 rounded-xl border border-border/40 bg-sidebar-accent/30 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-all hover:border-border hover:bg-sidebar-accent hover:text-foreground"
          >
            <ShieldCheck className="size-3.5 text-brand" />
            Admin panel {TESTING_MODE ? "(Open)" : ""}
          </button>
        )}
      </div>
    );
  }

  const name = user?.name ?? firebaseUser?.displayName ?? firebaseUser?.email?.split("@")[0] ?? "Guest";
  const email = user?.email ?? firebaseUser?.email ?? "";
  const image = user?.image ?? firebaseUser?.photoURL ?? undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2 text-left transition-all hover:border-border hover:bg-sidebar-accent/60">
          <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand to-brand-2 text-[12px] font-bold text-white shadow-sm ring-1 ring-border/20">
            {image ? <img src={image} alt="" className="size-full object-cover" /> : name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-none">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 rounded-2xl p-1 shadow-xl">
        <div className="flex gap-3 px-3 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand to-brand-2 text-sm font-bold text-white shadow">
            {image ? <img src={image} alt="" className="size-full object-cover" /> : name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <Separator />
        <div className="p-1">
          <ProfileMenuItem icon={Settings} label="Settings" onClick={() => { setOpen(false); onOpenSettings(); }} />
          {(TESTING_MODE || isAdminUser({ email })) ? (
            <ProfileMenuItem icon={ShieldCheck} label={`Admin panel ${TESTING_MODE ? "(Open)" : ""}`} onClick={() => { setOpen(false); window.location.href = "/admin"; }} />
          ) : null}
        </div>
        <Separator />
        <div className="p-1">
          <ProfileMenuItem icon={LogOut} label="Sign out" onClick={() => { setOpen(false); onSignOut(); }} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProfileMenuItem({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium hover:bg-accent">
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </button>
  );
}

function RenameDialog({ open, value, onValueChange, onOpenChange, onSubmit }: { open: boolean; value: string; onValueChange: (v: string) => void; onOpenChange: (o: boolean) => void; onSubmit: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle>Rename chat</DialogTitle><DialogDescription>Choose a new name for this conversation.</DialogDescription></DialogHeader>
        <Input ref={inputRef} value={value} onChange={(e) => onValueChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} autoFocus className="rounded-xl" />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">Cancel</Button><Button onClick={onSubmit} className="rivo-btn-brand rounded-full">Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle>Delete chat?</DialogTitle><DialogDescription>This will permanently delete the conversation and all messages. This cannot be undone.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full">Cancel</Button><Button variant="destructive" onClick={onConfirm} className="rounded-full">Delete</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchivedDialog({ open, onOpenChange, archived, onUnarchive, onDelete }: { open: boolean; onOpenChange: (o: boolean) => void; archived: SidebarConversation[]; onUnarchive: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader><DialogTitle>Archived chats</DialogTitle><DialogDescription>Archived chats are hidden from your history but not deleted.</DialogDescription></DialogHeader>
        <ScrollArea className="max-h-72">
          {archived.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing archived yet.</p> : (
            <div className="space-y-1 pr-2">
              {archived.map((c) => (
                <div key={c.id} className="flex items-center gap-1 rounded-xl px-2 py-1.5 hover:bg-accent">
                  <span className="flex-1 truncate text-sm">{c.title}</span>
                  <Button variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground" onClick={() => onUnarchive(c.id)} aria-label="Unarchive"><ArchiveRestore className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-7 rounded-full text-destructive" onClick={() => onDelete(c.id)} aria-label="Delete"><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
