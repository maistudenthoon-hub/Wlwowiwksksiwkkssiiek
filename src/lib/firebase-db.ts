/**
 * Firebase Firestore database layer — replaces all Convex queries & mutations.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { STATIC_AI_URL } from "@/config";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface UserData {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  provider?: string;
  customInstructions?: { about?: string; respond?: string };
  role?: string;
  createdAt: number;
  lastLoginAt: number;
}

export interface ConversationData {
  id: string;
  userId: string;
  title: string;
  modelSlug?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  updatedAt: number;
  createdAt?: number;
}

export interface MessageData {
  id: string;
  conversationId: string;
  parentId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelSlug?: string;
  attachments?: { name: string; type: string; size: number; url?: string; dataUrl?: string; text?: string }[];
  status?: "sending" | "streaming" | "completed" | "error";
  feedback?: "up" | "down";
  isError?: boolean;
  stopRequested?: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Testing Mode toggle                                                 */
/* Set to true for open testing (unregistered messages & open admin).  */
/* When user says "testing done", set back to false.                   */
/* ------------------------------------------------------------------ */
export const TESTING_MODE = true;

/* ------------------------------------------------------------------ */
/* Current user helper                                                 */
/* ------------------------------------------------------------------ */

function uid(): string {
  const u = auth.currentUser;
  if (u) return u.uid;
  if (TESTING_MODE) {
    let guestId = typeof window !== "undefined" ? localStorage.getItem("rivo_testing_uid") : null;
    if (!guestId && typeof window !== "undefined") {
      guestId = "test_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("rivo_testing_uid", guestId);
    }
    return guestId || "testing_user";
  }
  throw new Error("Not authenticated");
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export function usersCol() {
  return collection(db, "users");
}

export function userDoc(userId: string) {
  return doc(db, "users", userId);
}

export async function getMyProfile(): Promise<UserData | null> {
  try {
    const snap = await getDoc(userDoc(uid()));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as UserData) : null;
  } catch {
    return null;
  }
}

export function watchMyProfile(cb: (data: UserData | null) => void): Unsubscribe {
  if (!auth.currentUser) {
    cb(null);
    return () => {};
  }
  return onSnapshot(
    userDoc(uid()),
    (snap) => {
      cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as UserData) : null);
    },
    (err) => {
      console.warn("[watchMyProfile] Firestore error:", err.message);
      cb(null);
    },
  );
}

export async function provisionUser(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error("Not authenticated");
  const ref = userDoc(u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const newProfile: Record<string, unknown> = {
      name: u.displayName ?? u.email?.split("@")[0] ?? "User",
      provider: u.providerData?.[0]?.providerId ?? "google",
      role: "user",
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    if (u.email) newProfile.email = u.email;
    if (u.photoURL) newProfile.image = u.photoURL;
    await setDoc(ref, newProfile);
  } else {
    await updateDoc(ref, { lastLoginAt: Date.now() });
  }
  return u.uid;
}

export async function saveProfile(data: { name?: string }) {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (Object.keys(patch).length > 0) {
    await updateDoc(userDoc(uid()), patch);
  }
}

export async function saveCustomInstructions(data: { about?: string; respond?: string }) {
  await updateDoc(userDoc(uid()), { customInstructions: data });
}

export async function fetchMyCustomInstructions(): Promise<{ about?: string; respond?: string } | null> {
  try {
    const p = await getMyProfile();
    return p?.customInstructions ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Local testing store (used when TESTING_MODE is active and user is  */
/* not signed in to Firebase Auth)                                    */
/* ------------------------------------------------------------------ */

const TEST_CONVS_KEY = "rivo_test_conversations";
const TEST_MSGS_KEY = "rivo_test_messages";
const testListeners = new Set<() => void>();

function notifyTestListeners() {
  for (const fn of testListeners) {
    try { fn(); } catch {}
  }
}

function getLocalTestConvs(): ConversationData[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TEST_CONVS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalTestConvs(convs: ConversationData[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TEST_CONVS_KEY, JSON.stringify(convs));
    notifyTestListeners();
  } catch {}
}

function getLocalTestMsgs(): MessageData[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TEST_MSGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalTestMsgs(msgs: MessageData[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TEST_MSGS_KEY, JSON.stringify(msgs));
    notifyTestListeners();
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export function convsCol() {
  return collection(db, "conversations");
}

export function convDoc(id: string) {
  return doc(db, "conversations", id);
}

export async function createConversation(modelSlug?: string): Promise<string> {
  if (TESTING_MODE && !auth.currentUser) {
    const id = "test_conv_" + Math.random().toString(36).slice(2, 9);
    const newConv: ConversationData = {
      id,
      userId: uid(),
      title: "New Chat",
      modelSlug: modelSlug ?? "rivo-4o",
      isArchived: false,
      isPinned: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    const current = getLocalTestConvs();
    saveLocalTestConvs([newConv, ...current]);
    return id;
  }
  const userId = uid();
  const ref = doc(convsCol());
  await setDoc(ref, {
    userId,
    title: "New Chat",
    modelSlug: modelSlug ?? "rivo-4o",
    isArchived: false,
    isPinned: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  });
  return ref.id;
}

export async function renameConversation(id: string, title: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const list = getLocalTestConvs();
    const item = list.find((c) => c.id === id);
    if (item) {
      item.title = title;
      item.updatedAt = Date.now();
      saveLocalTestConvs([...list]);
    }
    return;
  }
  try {
    await updateDoc(convDoc(id), { title, updatedAt: Date.now() });
  } catch (err) {
    console.warn("[renameConversation] error:", err);
  }
}

export async function setConversationModel(id: string, modelSlug: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const list = getLocalTestConvs();
    const item = list.find((c) => c.id === id);
    if (item) {
      item.modelSlug = modelSlug;
      saveLocalTestConvs([...list]);
    }
    return;
  }
  try {
    await updateDoc(convDoc(id), { modelSlug });
  } catch (err) {
    console.warn("[setConversationModel] error:", err);
  }
}

export async function setConversationArchived(id: string, isArchived: boolean) {
  if (TESTING_MODE && !auth.currentUser) {
    const list = getLocalTestConvs();
    const item = list.find((c) => c.id === id);
    if (item) {
      item.isArchived = isArchived;
      saveLocalTestConvs([...list]);
    }
    return;
  }
  try {
    await updateDoc(convDoc(id), { isArchived });
  } catch (err) {
    console.warn("[setConversationArchived] error:", err);
  }
}

export async function setConversationPinned(id: string, isPinned: boolean) {
  if (TESTING_MODE && !auth.currentUser) {
    const list = getLocalTestConvs();
    const item = list.find((c) => c.id === id);
    if (item) {
      item.isPinned = isPinned;
      saveLocalTestConvs([...list]);
    }
    return;
  }
  try {
    await updateDoc(convDoc(id), { isPinned });
  } catch (err) {
    console.warn("[setConversationPinned] error:", err);
  }
}

export async function deleteConversation(id: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const convs = getLocalTestConvs().filter((c) => c.id !== id);
    saveLocalTestConvs(convs);
    const msgs = getLocalTestMsgs().filter((m) => m.conversationId !== id);
    saveLocalTestMsgs(msgs);
    return;
  }
  const userId = uid();
  try {
    const msgsQ = query(
      collection(db, "messages"),
      where("conversationId", "==", id),
    );
    const msgsSnap = await getDocs(msgsQ);
    const batch = writeBatch(db);
    msgsSnap.forEach((d) => batch.delete(d.ref));
    batch.delete(convDoc(id));
    await batch.commit();
  } catch (err) {
    console.warn("[deleteConversation] error:", err);
  }
}

export async function deleteAllConversations() {
  if (TESTING_MODE && !auth.currentUser) {
    saveLocalTestConvs([]);
    saveLocalTestMsgs([]);
    return;
  }
  const userId = uid();
  try {
    const convsQ = query(convsCol(), where("userId", "==", userId));
    const convsSnap = await getDocs(convsQ);
    const batch = writeBatch(db);
    for (const conv of convsSnap.docs) {
      const msgsQ = query(
        collection(db, "messages"),
        where("conversationId", "==", conv.id),
      );
      const msgsSnap = await getDocs(msgsQ);
      msgsSnap.forEach((d) => batch.delete(d.ref));
      batch.delete(conv.ref);
    }
    await batch.commit();
  } catch (err) {
    console.warn("[deleteAllConversations] error:", err);
  }
}

/** Watch conversations for the current user (realtime). */
export function watchConversations(cb: (convs: ConversationData[]) => void): Unsubscribe {
  if (TESTING_MODE && !auth.currentUser) {
    cb(getLocalTestConvs());
    const handler = () => cb(getLocalTestConvs());
    testListeners.add(handler);
    return () => {
      testListeners.delete(handler);
    };
  }
  const userId = auth.currentUser?.uid;
  if (!userId) {
    cb(getLocalTestConvs());
    return () => {};
  }
  const q = query(
    convsCol(),
    where("userId", "==", userId),
    orderBy("updatedAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as ConversationData),
        ),
      );
    },
    (err) => {
      console.warn("[watchConversations] Snapshot error:", err.message);
      cb(getLocalTestConvs());
    },
  );
}

/** One-shot fetch of conversations (for sidebar search index). */
export async function fetchAllConversationsWithMessages(): Promise<
  {
    id: string;
    title: string;
    updatedAt: number;
    isPinned: boolean;
    snippet?: string;
    messageContents: string[];
  }[]
> {
  if (TESTING_MODE && !auth.currentUser) {
    const convs = getLocalTestConvs();
    const msgs = getLocalTestMsgs();
    return convs.map((c) => {
      const cMsgs = msgs.filter((m) => m.conversationId === c.id);
      return {
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        isPinned: c.isPinned ?? false,
        snippet: cMsgs.length ? cMsgs[cMsgs.length - 1].content.slice(0, 140) : undefined,
        messageContents: cMsgs.map((m) => m.content),
      };
    });
  }
  try {
    const userId = uid();
    const convsQ = query(
      convsCol(),
      where("userId", "==", userId),
      orderBy("updatedAt", "desc"),
    );
    const convsSnap = await getDocs(convsQ);
    const out: {
      id: string;
      title: string;
      updatedAt: number;
      isPinned: boolean;
      snippet?: string;
      messageContents: string[];
    }[] = [];

    for (const conv of convsSnap.docs) {
      const data = conv.data();
      const msgsQ = query(
        collection(db, "messages"),
        where("conversationId", "==", conv.id),
        orderBy("createdAt", "asc"),
      );
      const msgsSnap = await getDocs(msgsQ);
      const msgs = msgsSnap.docs.map((d) => d.data() as MessageData);
      out.push({
        id: conv.id,
        title: data.title ?? "New Chat",
        updatedAt: data.updatedAt ?? 0,
        isPinned: data.isPinned ?? false,
        snippet: msgs.length ? msgs[msgs.length - 1].content.slice(0, 140) : undefined,
        messageContents: msgs.map((m) => m.content),
      });
    }
    return out;
  } catch (err) {
    console.warn("[fetchAllConversationsWithMessages] error:", err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function msgsCol() {
  return collection(db, "messages");
}

export function msgDoc(id: string) {
  return doc(db, "messages", id);
}

export function watchMessages(
  conversationId: string,
  cb: (msgs: MessageData[]) => void,
): Unsubscribe {
  if (TESTING_MODE && !auth.currentUser) {
    const getMsgs = () => getLocalTestMsgs().filter((m) => m.conversationId === conversationId);
    cb(getMsgs());
    const handler = () => cb(getMsgs());
    testListeners.add(handler);
    return () => {
      testListeners.delete(handler);
    };
  }
  if (!conversationId) {
    cb([]);
    return () => {};
  }
  const q = query(
    msgsCol(),
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as MessageData)),
      );
    },
    (err) => {
      console.warn("[watchMessages] Snapshot error:", err.message);
      if (TESTING_MODE) {
        cb(getLocalTestMsgs().filter((m) => m.conversationId === conversationId));
      } else {
        cb([]);
      }
    },
  );
}

export async function appendMessage(data: {
  conversationId: string;
  parentId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: { name: string; type: string; size: number; url?: string }[];
  status?: string;
}): Promise<string> {
  if (TESTING_MODE && !auth.currentUser) {
    const id = "msg_" + Math.random().toString(36).slice(2, 10);
    const newMsg: MessageData = {
      id,
      conversationId: data.conversationId,
      parentId: data.parentId,
      role: data.role,
      content: data.content,
      attachments: data.attachments,
      status: data.status as MessageData["status"],
      createdAt: Date.now(),
    };
    const msgs = getLocalTestMsgs();
    saveLocalTestMsgs([...msgs, newMsg]);

    // Touch conversation
    const convs = getLocalTestConvs();
    const conv = convs.find((c) => c.id === data.conversationId);
    if (conv) {
      conv.updatedAt = Date.now();
      saveLocalTestConvs([...convs]);
    }
    return id;
  }
  try {
    const ref = doc(msgsCol());
    // Firestore rejects `undefined` field values — strip them out.
    const payload: Record<string, unknown> = {
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      createdAt: Date.now(),
    };
    if (data.parentId !== undefined) payload.parentId = data.parentId;
    if (data.attachments !== undefined) payload.attachments = data.attachments;
    if (data.status !== undefined) payload.status = data.status;
    await setDoc(ref, payload);
    // Touch conversation
    try {
      await updateDoc(convDoc(data.conversationId), { updatedAt: Date.now() });
    } catch {}
    return ref.id;
  } catch (err) {
    console.warn("[appendMessage] Firestore error, saving locally:", err);
    const id = "msg_" + Math.random().toString(36).slice(2, 10);
    const newMsg: MessageData = {
      id,
      conversationId: data.conversationId,
      parentId: data.parentId,
      role: data.role,
      content: data.content,
      attachments: data.attachments,
      status: data.status as MessageData["status"],
      createdAt: Date.now(),
    };
    const msgs = getLocalTestMsgs();
    saveLocalTestMsgs([...msgs, newMsg]);
    return id;
  }
}

export async function updateMessage(
  id: string,
  patch: Partial<MessageData>,
) {
  if (TESTING_MODE && !auth.currentUser) {
    const msgs = getLocalTestMsgs();
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx >= 0) {
      msgs[idx] = { ...msgs[idx], ...patch };
      saveLocalTestMsgs([...msgs]);
    }
    return;
  }
  try {
    await updateDoc(msgDoc(id), patch);
  } catch {
    const msgs = getLocalTestMsgs();
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx >= 0) {
      msgs[idx] = { ...msgs[idx], ...patch };
      saveLocalTestMsgs([...msgs]);
    }
  }
}

export async function setMessageFeedback(
  id: string,
  feedback?: "up" | "down",
) {
  if (TESTING_MODE && !auth.currentUser) {
    const msgs = getLocalTestMsgs();
    const item = msgs.find((m) => m.id === id);
    if (item) {
      const current = item.feedback;
      item.feedback = feedback && current === feedback ? undefined : feedback;
      saveLocalTestMsgs([...msgs]);
    }
    return;
  }
  try {
    const snap = await getDoc(msgDoc(id));
    if (!snap.exists()) return;
    const current = snap.data().feedback;
    const next = feedback && current === feedback ? "" : (feedback ?? "");
    await updateDoc(msgDoc(id), { feedback: next });
  } catch {}
}

export async function requestStop(id: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const msgs = getLocalTestMsgs();
    const item = msgs.find((m) => m.id === id);
    if (item) {
      item.stopRequested = true;
      saveLocalTestMsgs([...msgs]);
    }
    return;
  }
  try {
    await updateDoc(msgDoc(id), { stopRequested: true });
  } catch {}
}

export async function deleteMessage(id: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const msgs = getLocalTestMsgs().filter((m) => m.id !== id);
    saveLocalTestMsgs(msgs);
    return;
  }
  try {
    await deleteDoc(msgDoc(id));
  } catch {}
}

export async function touchConversation(id: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const convs = getLocalTestConvs();
    const conv = convs.find((c) => c.id === id);
    if (conv) {
      conv.updatedAt = Date.now();
      saveLocalTestConvs([...convs]);
    }
    return;
  }
  try {
    await updateDoc(convDoc(id), { updatedAt: Date.now() });
  } catch {}
}

/** Generate a title from the first user message. */
export async function maybeGenerateTitle(conversationId: string) {
  if (TESTING_MODE && !auth.currentUser) {
    const convs = getLocalTestConvs();
    const conv = convs.find((c) => c.id === conversationId);
    if (!conv || conv.title !== "New Chat") return;
    const msgs = getLocalTestMsgs().filter((m) => m.conversationId === conversationId && m.role === "user");
    if (!msgs.length) return;
    const raw = msgs[0].content.replace(/\s+/g, " ").trim();
    if (!raw) return;
    conv.title = raw.length > 48 ? `${raw.slice(0, 48).trimEnd()}…` : raw;
    saveLocalTestConvs([...convs]);
    return;
  }
  try {
    const convSnap = await getDoc(convDoc(conversationId));
    if (!convSnap.exists()) return;
    const data = convSnap.data();
    if (data.title !== "New Chat") return;

    const msgsQ = query(
      msgsCol(),
      where("conversationId", "==", conversationId),
      orderBy("createdAt", "asc"),
    );
    const msgsSnap = await getDocs(msgsQ);
    const firstUser = msgsSnap.docs
      .map((d) => d.data() as MessageData)
      .find((m) => m.role === "user");
    if (!firstUser) return;

    const raw = firstUser.content.replace(/\s+/g, " ").trim();
    if (!raw) return;
    const title = raw.length > 48 ? `${raw.slice(0, 48).trimEnd()}…` : raw;
    await updateDoc(convDoc(conversationId), { title });
  } catch {}
}

/** Update message content + status (used by Cloud Function). */
export async function updateMessageContent(
  id: string,
  content: string,
  status?: string,
) {
  const patch: Record<string, unknown> = { content };
  if (status) patch.status = status;
  await updateDoc(msgDoc(id), patch);
}

/* ------------------------------------------------------------------ */
/* Export all data (for settings > data controls)                      */
/* ------------------------------------------------------------------ */

export async function exportAllData() {
  const userId = uid();
  const convsQ = query(convsCol(), where("userId", "==", userId));
  const convsSnap = await getDocs(convsQ);
  const result: Record<string, unknown>[] = [];
  for (const conv of convsSnap.docs) {
    const msgsQ = query(
      msgsCol(),
      where("conversationId", "==", conv.id),
      orderBy("createdAt", "asc"),
    );
    const msgsSnap = await getDocs(msgsQ);
    result.push({
      conversation: conv.data(),
      messages: msgsSnap.docs.map((d) => d.data()),
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Admin — user management, bans, legal docs                           */
/* ------------------------------------------------------------------ */

export const ADMIN_EMAILS = [
  "contactrealrivo@gmail.com",
  "explainerhindi13@gmail.com",
];
export const ADMIN_EMAIL = ADMIN_EMAILS[0];

export interface AdminUserRow {
  id: string;
  email?: string;
  name?: string;
  image?: string;
  role?: string;
  isBanned?: boolean;
  banReason?: string;
  banUntil?: number | null;
  createdAt?: number;
  lastLoginAt?: number;
  welcomeEmailSent?: boolean;
}

/** Promote the admin email to role: "admin" (called on admin sign-in). */
export async function ensureAdminRole() {
  const u = auth.currentUser;
  if (!u || !u.email || !ADMIN_EMAILS.includes(u.email.toLowerCase())) return;
  const ref = userDoc(u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().role !== "admin") {
    await setDoc(ref, { email: u.email, role: "admin" }, { merge: true });
  }
}

export function isAdminUser(user: { email?: string } | null): boolean {
  if (TESTING_MODE) return true;
  return !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
}

/** Watch all user docs (admin only per security rules). */
export function watchAllUsers(cb: (users: AdminUserRow[]) => void): Unsubscribe {
  return onSnapshot(
    usersCol(),
    (snap) => {
      cb(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AdminUserRow))
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
    },
    (err) => {
      console.warn("[watchAllUsers] Permission or snapshot error:", err.message);
      if (TESTING_MODE) {
        cb([
          {
            id: auth.currentUser?.uid ?? "testing_admin",
            email: auth.currentUser?.email ?? "tester@rivo.app",
            name: auth.currentUser?.displayName ?? "Testing Administrator",
            role: "admin",
            createdAt: Date.now() - 86400000,
            lastLoginAt: Date.now(),
          },
        ]);
      } else {
        cb([]);
      }
    },
  );
}

export async function banUser(
  userId: string,
  opts: { reason: string; days?: number | null },
) {
  const banUntil = opts.days && opts.days > 0 ? Date.now() + opts.days * 86400_000 : null;
  await updateDoc(userDoc(userId), {
    isBanned: true,
    banReason: opts.reason,
    banUntil,
    bannedAt: Date.now(),
  });
}

export async function unbanUser(userId: string) {
  await updateDoc(userDoc(userId), {
    isBanned: false,
    banReason: "",
    banUntil: null,
  });
}

/** Check whether the signed-in user is currently banned. */
export async function getMyBanStatus(): Promise<{ banned: boolean; reason?: string; until: number | null }> {
  try {
    const snap = await getDoc(userDoc(uid()));
    if (!snap.exists()) return { banned: false, until: null };
    const d = snap.data();
    if (!d.isBanned) return { banned: false, until: null };
    const until = (d.banUntil as number | null | undefined) ?? null;
    if (until !== null && until <= Date.now()) {
      // Ban expired — auto-clear
      await updateDoc(userDoc(uid()), { isBanned: false, banReason: "", banUntil: null });
      return { banned: false, until: null };
    }
    return { banned: true, reason: d.banReason, until };
  } catch {
    return { banned: false, until: null };
  }
}

/* ----------------------------- Legal docs ------------------------------ */

export interface LegalDoc {
  privacyPolicy: string;
  termsOfUse: string;
  updatedAt: number;
}

export function legalDocRef() {
  return doc(db, "config", "legal");
}

export function watchLegalDoc(cb: (docData: LegalDoc | null) => void): Unsubscribe {
  return onSnapshot(
    legalDocRef(),
    (snap) => {
      cb(snap.exists() ? (snap.data() as LegalDoc) : null);
    },
    (err) => {
      console.warn("[watchLegalDoc] Snapshot error:", err.message);
      cb(null);
    },
  );
}

export async function fetchLegalDoc(): Promise<LegalDoc | null> {
  try {
    const snap = await getDoc(legalDocRef());
    return snap.exists() ? (snap.data() as LegalDoc) : null;
  } catch {
    return null;
  }
}

export async function saveLegalDoc(data: { privacyPolicy: string; termsOfUse: string }) {
  await setDoc(legalDocRef(), { ...data, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* AI proxy URL (config/ai) — editable from Admin panel                */
/* ------------------------------------------------------------------ */

export function aiConfigRef() {
  return doc(db, "config", "ai");
}

export async function fetchAiUrl(): Promise<string | null> {
  try {
    const snap = await getDoc(aiConfigRef());
    return snap.exists() ? ((snap.data().url as string) ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveAiUrl(url: string) {
  await setDoc(aiConfigRef(), { url, updatedAt: Date.now() }, { merge: true });
}

/* ------------------------------------------------------------------ */
/* Gemini API key (config/ai.key) — browser calls Gemini DIRECTLY.     */
/* No proxy needed: generativelanguage.googleapis.com allows CORS.     */
/* ------------------------------------------------------------------ */

export async function fetchGeminiKey(): Promise<string | null> {
  try {
    const snap = await getDoc(aiConfigRef());
    const key = snap.exists() ? (snap.data().key as string | undefined) : undefined;
    return key && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export async function saveGeminiKey(key: string) {
  await setDoc(aiConfigRef(), { key: key.trim(), updatedAt: Date.now() }, { merge: true });
}

let _geminiKeyCache: string | null = null;
let _geminiKeyFetched = false;

/** One-shot cached read of the Gemini API key (admin-editable). */
export async function getGeminiKey(): Promise<string | null> {
  if (_geminiKeyFetched) return _geminiKeyCache;
  _geminiKeyCache = await fetchGeminiKey();
  _geminiKeyFetched = true;
  return _geminiKeyCache;
}

export function invalidateGeminiKeyCache() {
  _geminiKeyFetched = false;
  _geminiKeyCache = null;
}

/**
 * One-shot, cached read of the AI proxy URL.
 * Falls back to the static config URL when Firestore has none.
 */
let _aiUrlCache: string | null = null;
let _aiUrlFetched = false;

export async function getAiUrl(): Promise<string> {
  if (_aiUrlFetched) return _aiUrlCache ?? STATIC_AI_URL;
  try {
    const url = await fetchAiUrl();
    _aiUrlCache = url;
  } catch {
    /* ignore — use fallback */
  }
  _aiUrlFetched = true;
  return _aiUrlCache ?? STATIC_AI_URL;
}

export function invalidateAiUrlCache() {
  _aiUrlFetched = false;
  _aiUrlCache = null;
}

/* ------------------------------------------------------------------ */
/* User settings (per-user, Firestore + localStorage fallback)        */
/* ------------------------------------------------------------------ */

export type ThemeChoice = "system" | "light" | "dark";
export type AccentChoice = "rivo" | "violet" | "emerald" | "amber" | "slate";
export type DensityChoice = "comfortable" | "compact" | "cozy";
export type FontChoice = "system" | "inter" | "geist" | "mono";

export interface UserSettings {
  theme: ThemeChoice;
  accent: AccentChoice;
  density: DensityChoice;
  font: FontChoice;
  fontScale: number;
  reduceMotion: boolean;
  showAnimations: boolean;
  compactSidebar: boolean;
  defaultModel: string;
  streamingChunk: number;
  showTokenCount: boolean;
  codeWrap: boolean;
  latexEnabled: boolean;
  autoTitle: boolean;
  keepHistory: boolean;
  memoryEnabled: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  desktopNotifications: boolean;
  emailDigest: "off" | "daily" | "weekly";
  pushEnabled: boolean;
  retentionDays: number | null;
  telemetryEnabled: boolean;
  showArchived: boolean;
  focusMode: boolean;
  highContrast: boolean;
  keyboardHints: boolean;
  betaFeatures: Record<string, boolean>;
  debugMode: boolean;
  updatedAt?: number;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "system", accent: "rivo", density: "comfortable", font: "system", fontScale: 100,
  reduceMotion: false, showAnimations: true, compactSidebar: false,
  defaultModel: "rivo-4o", streamingChunk: 220, showTokenCount: true, codeWrap: false, latexEnabled: true,
  autoTitle: true, keepHistory: true, memoryEnabled: true,
  soundEnabled: true, hapticsEnabled: true, desktopNotifications: false, emailDigest: "off", pushEnabled: false,
  retentionDays: null, telemetryEnabled: false, showArchived: true,
  focusMode: false, highContrast: false, keyboardHints: true,
  betaFeatures: {}, debugMode: false,
};

function uidOrThrow(): string { const u = auth.currentUser; if (!u) throw new Error("Not authenticated"); return u.uid; }
export function userSettingsRef(uid?: string) { const id = uid ?? uidOrThrow(); return doc(db, "userSettings", id); }
export async function fetchUserSettings(): Promise<UserSettings> {
  try { const snap = await getDoc(userSettingsRef()); if (!snap.exists()) return { ...DEFAULT_USER_SETTINGS }; return { ...DEFAULT_USER_SETTINGS, ...(snap.data() as Partial<UserSettings>) } as UserSettings; } catch { return { ...DEFAULT_USER_SETTINGS }; }
}
export function watchUserSettings(cb: (s: UserSettings) => void): Unsubscribe {
  try {
    const ref = userSettingsRef(auth.currentUser?.uid ?? uid());
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) cb({ ...DEFAULT_USER_SETTINGS });
        else cb({ ...DEFAULT_USER_SETTINGS, ...(snap.data() as Partial<UserSettings>) } as UserSettings);
      },
      (err) => {
        console.warn("[watchUserSettings] Snapshot error:", err.message);
        cb({ ...DEFAULT_USER_SETTINGS });
      },
    );
  } catch {
    cb({ ...DEFAULT_USER_SETTINGS });
    return () => {};
  }
}
export async function saveUserSettings(patch: Partial<UserSettings>) {
  try {
    const ref = userSettingsRef(auth.currentUser?.uid ?? uid());
    await setDoc(ref, { ...patch, updatedAt: Date.now() }, { merge: true });
  } catch {}
}

/* ------------------------------------------------------------------ */
/* App-wide config (admin editable)                                   */
/* ------------------------------------------------------------------ */

export interface AppConfig {
  maintenanceMode: boolean; readOnlyMode: boolean; allowSignup: boolean; allowAnonymous: boolean;
  requireEmailVerification: boolean; maxChatsPerUser: number; maxMessagesPerChat: number; rateLimitPerMinute: number;
  allowedOrigins: string[]; announcement: { enabled: boolean; text: string; tone: "info" | "warn" | "success" };
  featureFlags: Record<string, boolean>; defaultModel: string; modelAllowList: string[]; welcomeEmailEnabled: boolean;
  moderationEnabled: boolean; exportRetentionDays: number; supportEmail: string;
  branding: { appName: string; primaryColor: string }; updatedAt?: number;
}
export const DEFAULT_APP_CONFIG: AppConfig = {
  maintenanceMode: false, readOnlyMode: false, allowSignup: true, allowAnonymous: false,
  requireEmailVerification: false, maxChatsPerUser: 200, maxMessagesPerChat: 500, rateLimitPerMinute: 60,
  allowedOrigins: [], announcement: { enabled: false, text: "RIVO is running smoothly.", tone: "info" },
  featureFlags: { branching: true, fileUploads: true, webSearchToggle: true, reasoningToggle: true, voiceInput: false, imageGen: false, codeInterpreter: false },
  defaultModel: "rivo-4o", modelAllowList: ["rivo-4o","rivo-fast","rivo-reasoning"],
  welcomeEmailEnabled: true, moderationEnabled: true, exportRetentionDays: 30,
  supportEmail: "support@rivo.app", branding: { appName: "RIVO", primaryColor: "oklch(0.55 0.17 250)" },
};

export function appConfigRef() { return doc(db, "config", "app"); }
export async function fetchAppConfig(): Promise<AppConfig> {
  try { const snap = await getDoc(appConfigRef()); if (!snap.exists()) return { ...DEFAULT_APP_CONFIG }; return { ...DEFAULT_APP_CONFIG, ...(snap.data() as Partial<AppConfig>) } as AppConfig; } catch { return { ...DEFAULT_APP_CONFIG }; }
}
export function watchAppConfig(cb: (c: AppConfig) => void): Unsubscribe {
  return onSnapshot(
    appConfigRef(),
    (snap) => {
      if (!snap.exists()) cb({ ...DEFAULT_APP_CONFIG });
      else cb({ ...DEFAULT_APP_CONFIG, ...(snap.data() as Partial<AppConfig>) } as AppConfig);
    },
    (err) => {
      console.warn("[watchAppConfig] Snapshot error:", err.message);
      cb({ ...DEFAULT_APP_CONFIG });
    },
  );
}
export async function saveAppConfig(patch: Partial<AppConfig>) {
  try {
    await setDoc(appConfigRef(), { ...patch, updatedAt: Date.now() }, { merge: true });
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Prompts & templates (admin)                                         */
/* ------------------------------------------------------------------ */

export interface PromptTemplate { id: string; title: string; prompt: string; category: string; pinned?: boolean; createdAt: number; updatedAt: number; }
export function promptsCol() { return collection(db, "prompts"); }
export async function fetchPromptTemplates(): Promise<PromptTemplate[]> {
  try { const q = query(promptsCol(), orderBy("createdAt","desc")); const snap = await getDocs(q); return snap.docs.map(d=>({id:d.id, ...d.data()} as PromptTemplate)); } catch { return []; }
}
export function watchPromptTemplates(cb: (p: PromptTemplate[]) => void): Unsubscribe {
  return onSnapshot(
    query(promptsCol(), orderBy("createdAt","desc")),
    (snap)=> cb(snap.docs.map(d=>({id:d.id, ...d.data()} as PromptTemplate))),
    (err) => {
      console.warn("[watchPromptTemplates] Snapshot error:", err.message);
      cb([]);
    },
  );
}
export async function savePromptTemplate(data: Omit<PromptTemplate,"id"|"createdAt"|"updatedAt"> & { id?: string }) {
  if (data.id) { await updateDoc(doc(db,"prompts", data.id), { ...data, updatedAt: Date.now() }); return data.id; }
  const ref = doc(promptsCol()); await setDoc(ref, { ...data, createdAt: Date.now(), updatedAt: Date.now() }); return ref.id;
}
export async function deletePromptTemplate(id: string) { await deleteDoc(doc(db,"prompts", id)); }

/* ------------------------------------------------------------------ */
/* System prompts (admin)                                              */
/* ------------------------------------------------------------------ */
export interface SystemPromptDoc { content: string; presets: { id: string; label: string; content: string }[]; updatedAt: number; }
export function systemPromptRef() { return doc(db, "config", "systemPrompt"); }
export async function fetchSystemPrompt(): Promise<SystemPromptDoc | null> {
  try { const s = await getDoc(systemPromptRef()); return s.exists() ? s.data() as SystemPromptDoc : null; } catch { return null; }
}
export function watchSystemPrompt(cb: (d: SystemPromptDoc | null) => void): Unsubscribe {
  return onSnapshot(
    systemPromptRef(),
    (s)=> cb(s.exists() ? s.data() as SystemPromptDoc : null),
    (err) => {
      console.warn("[watchSystemPrompt] Snapshot error:", err.message);
      cb(null);
    },
  );
}
export async function saveSystemPrompt(data: { content: string; presets?: SystemPromptDoc["presets"] }) {
  await setDoc(systemPromptRef(), { ...data, updatedAt: Date.now() }, { merge: true });
}

/* ------------------------------------------------------------------ */
/* Analytics & usage (admin, aggregated client-side for now)           */
/* ------------------------------------------------------------------ */
export interface UsageStats { totalUsers: number; totalConversations: number; totalMessages: number; activeToday: number; modelUsage: Record<string, number>; lastComputedAt: number; }
export async function fetchUsageStats(): Promise<UsageStats> {
  try {
    const [usersSnap, convsSnap, msgsSnap] = await Promise.all([
      getDocs(collection(db,"users")), getDocs(collection(db,"conversations")), getDocs(collection(db,"messages"))
    ]);
    const now = Date.now(); const dayAgo = now - 86400000;
    let activeToday = 0; usersSnap.forEach(d=>{ if ((d.data().lastLoginAt ?? 0) > dayAgo) activeToday++; });
    const modelUsage: Record<string,number> = {}; convsSnap.forEach(d=>{ const m = d.data().modelSlug ?? "rivo-4o"; modelUsage[m]=(modelUsage[m]??0)+1; });
    return { totalUsers: usersSnap.size, totalConversations: convsSnap.size, totalMessages: msgsSnap.size, activeToday, modelUsage, lastComputedAt: now };
  } catch { return { totalUsers:0, totalConversations:0, totalMessages:0, activeToday:0, modelUsage:{}, lastComputedAt: Date.now()}; }
}

/* ------------------------------------------------------------------ */
/* Ops: invites, audit log                                             */
/* ------------------------------------------------------------------ */
export interface InviteDoc { id: string; email: string; role: string; createdAt: number; redeemedAt?: number | null; }
export function invitesCol(){ return collection(db,"invites"); }
export async function fetchInvites(): Promise<InviteDoc[]> { try{const s=await getDocs(query(invitesCol(), orderBy("createdAt","desc"))); return s.docs.map(d=>({id:d.id, ...d.data()} as InviteDoc));}catch{return [];} }
export function watchInvites(cb:(d:InviteDoc[])=>void): Unsubscribe {
  return onSnapshot(
    query(invitesCol(), orderBy("createdAt","desc")),
    (s)=> cb(s.docs.map(d=>({id:d.id,...d.data()} as InviteDoc))),
    (err) => {
      console.warn("[watchInvites] Snapshot error:", err.message);
      cb([]);
    },
  );
}
export async function createInvite(email: string, role="user"){ const ref=doc(invitesCol()); await setDoc(ref,{ email: email.toLowerCase(), role, createdAt: Date.now(), redeemedAt: null }); return ref.id; }
export async function deleteInvite(id: string){ await deleteDoc(doc(db,"invites",id)); }

export interface AuditEntry { id: string; actorEmail?: string; action: string; target?: string; detail?: string; createdAt: number; }
export function auditCol(){ return collection(db,"auditLog"); }
export async function fetchAuditLog(limitN=50): Promise<AuditEntry[]> { try{ const s=await getDocs(query(auditCol(), orderBy("createdAt","desc"))); return s.docs.slice(0,limitN).map(d=>({id:d.id, ...d.data()} as AuditEntry)); }catch{return [];} }
export function watchAuditLog(cb:(a:AuditEntry[])=>void): Unsubscribe {
  return onSnapshot(
    query(auditCol(), orderBy("createdAt","desc")),
    (s)=> cb(s.docs.map(d=>({id:d.id,...d.data()} as AuditEntry))),
    (err) => {
      console.warn("[watchAuditLog] Snapshot error:", err.message);
      cb([]);
    },
  );
}
export async function pushAudit(action: string, target?: string, detail?: string){
  try{ const u = auth.currentUser; const ref = doc(auditCol()); await setDoc(ref, { actorEmail: u?.email ?? "system", action, target: target ?? "", detail: detail ?? "", createdAt: Date.now() }); }catch{}
}

/* ------------------------------------------------------------------ */
/* Moderation                                                          */
/* ------------------------------------------------------------------ */
export interface FlaggedItem { id: string; conversationId?: string; messageId?: string; reason: string; status: "open" | "resolved" | "dismissed"; createdAt: number; }
export function flagsCol(){ return collection(db,"flags"); }
export async function fetchFlags(): Promise<FlaggedItem[]> { try{ const s=await getDocs(query(flagsCol(), orderBy("createdAt","desc"))); return s.docs.map(d=>({id:d.id,...d.data()} as FlaggedItem)); }catch{return [];} }
export function watchFlags(cb:(f:FlaggedItem[])=>void): Unsubscribe {
  return onSnapshot(
    query(flagsCol(), orderBy("createdAt","desc")),
    (s)=> cb(s.docs.map(d=>({id:d.id,...d.data()} as FlaggedItem))),
    (err) => {
      console.warn("[watchFlags] Snapshot error:", err.message);
      cb([]);
    },
  );
}
export async function resolveFlag(id: string, status: FlaggedItem["status"]){ await updateDoc(doc(db,"flags", id), { status }); }

/* ------------------------------------------------------------------ */
/* Chats admin helpers                                                 */
/* ------------------------------------------------------------------ */
export async function fetchRecentConversationsAdmin(limitN=30){
  try{ const s=await getDocs(query(collection(db,"conversations"), orderBy("updatedAt","desc"))); return s.docs.slice(0,limitN).map(d=>({id:d.id, ...d.data()} as ConversationData)); }catch{return [];}
}
export async function adminDeleteConversation(id: string){ await deleteConversation(id); await pushAudit("delete_conversation", id); }
export async function adminArchiveAllForUser(userId: string){
  const qs = query(collection(db,"conversations"), where("userId","==", userId)); const snap=await getDocs(qs);
  const batch=writeBatch(db); snap.forEach(d=> batch.update(d.ref, { isArchived: true })); await batch.commit();
}

