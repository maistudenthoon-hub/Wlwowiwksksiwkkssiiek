/**
 * useAuth — pure Firebase authentication, no Convex.
 */
import { useCallback, useEffect, useState } from "react";
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInAnonymously,
} from "@/lib/firebase";
import {
  type User as FirebaseUser,
  onAuthStateChanged,
  signOut as fbSignOut,
} from "firebase/auth";
import {
  provisionUser,
  ensureAdminRole,
  getMyBanStatus,
  getAiUrl,
} from "@/lib/firebase-db";
import { STATIC_AI_URL } from "@/config";
import { getDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/* ------------------------------------------------------------------ */
/* Singleton auth state                                                */
/* ------------------------------------------------------------------ */

export interface BanInfo {
  email?: string;
  reason?: string;
  until: number | null;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  firebaseUser: FirebaseUser | null;
  banInfo: BanInfo | null;
}

let _state: AuthState = {
  isLoading: true,
  isAuthenticated: false,
  firebaseUser: null,
  banInfo: null,
};
const _listeners = new Set<() => void>();
let _unsubAuth: (() => void) | null = null;

function emit() {
  for (const fn of _listeners) fn();
}

function ensureListener() {
  if (_unsubAuth) return;
  _unsubAuth = onAuthStateChanged(auth, (user) => {
    _state = {
      isLoading: false,
      isAuthenticated: !!user,
      firebaseUser: user,
      banInfo: null,
    };
    emit();
    // Auto-provision Firestore user doc on sign-in
    if (user) {
      ensureAdminRole().catch(() => {});
      provisionUser().catch(() => {});
      sendWelcomeEmailOnce(user).catch(() => {});
      // Enforce bans: kick the user out if banned
      getMyBanStatus()
        .then((status) => {
          if (status.banned && auth.currentUser) {
            _state = {
              ..._state,
              banInfo: {
                email: auth.currentUser.email ?? undefined,
                reason: status.reason,
                until: status.until,
              },
            };
            emit();
            return fbSignOut(auth);
          }
        })
        .catch(() => {});
    }
  });
}

/* ------------------------------------------------------------------ */
/* Welcome email — sent ONLY on first successful login                 */
/* ------------------------------------------------------------------ */

const WELCOME_KEY = "rivo-welcome-sent";

export async function sendWelcomeRequest(email: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const url = await getAiUrl();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "welcome",
      email,
      name,
      origin: window.location.origin,
    }),
  });
  const raw = await resp.text();
  // Google login page => deployment access is wrong
  if (/<\s*(!doctype|html|head|body)/i.test(raw.slice(0, 500))) {
    return { ok: false, error: "Proxy returned a login page — set 'Who has access: Anyone' in Apps Script and save the NEW URL in Admin → AI Setup." };
  }
  try {
    const result = JSON.parse(raw);
    return { ok: !!result?.ok, error: result?.error };
  } catch {
    return { ok: false, error: "Proxy returned a non-JSON response" };
  }
}

async function sendWelcomeEmailOnce(user: FirebaseUser) {
  if (!user.email) return;

  // 1) Session guard — don't retry within the same browser session
  const sessionFlag = sessionStorage.getItem(WELCOME_KEY);
  if (sessionFlag === user.uid) return;

  // 2) Durable guard — check Firestore user doc for a permanent flag
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().welcomeEmailSent) return;

    // Provision first so the doc exists, then send
    await provisionUser();

    const result = await sendWelcomeRequest(
      user.email,
      user.displayName ?? user.email.split("@")[0],
    );

    if (result.ok) {
      // Mark permanently in Firestore so it never sends again
      await updateDoc(ref, { welcomeEmailSent: true }).catch(() => {});
      sessionStorage.setItem(WELCOME_KEY, user.uid);
    }
  } catch (err) {
    console.warn("[welcome email] failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/* useAuth                                                             */
/* ------------------------------------------------------------------ */

export function useAuth() {
  const [, rerender] = useState(0);

  useEffect(() => {
    ensureListener();
    const listener = () => rerender((n) => n + 1);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  const { isLoading, isAuthenticated, firebaseUser, banInfo } = _state;

  // Lightweight user profile (name, email, image from Firebase)
  const user = firebaseUser
    ? {
        name: firebaseUser.displayName ?? firebaseUser.email?.split("@")[0] ?? "User",
        email: firebaseUser.email ?? undefined,
        image: firebaseUser.photoURL ?? undefined,
      }
    : null;

  const signIn = useCallback(
    async (method: string) => {
      switch (method) {
        case "google": {
          await signInWithPopup(auth, googleProvider);
          break;
        }
        case "anonymous": {
          await signInAnonymously(auth);
          break;
        }
        default:
          throw new Error(`Unknown sign-in method: ${method}`);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
  }, []);

  return { isLoading, isAuthenticated, user, firebaseUser, banInfo, signIn, signOut };
}
