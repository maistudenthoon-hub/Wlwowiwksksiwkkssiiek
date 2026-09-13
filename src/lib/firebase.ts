import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  signInWithRedirect,
  signInAnonymously,
  signInWithCustomToken,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";


const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || "AIzaSyBK8WvBQ5vgI9U_IgmsCcohkTC1DWRzRp8",
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || "ai-rivo.firebaseapp.com",
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || "ai-rivo",
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || "ai-rivo.firebasestorage.app",
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || "952590689022",
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || "1:952590689022:web:ec576b0e76d91de1657baf",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

/** Firebase Auth instance — shared across the app. */
export const auth = getAuth(app);

/** Firestore database instance. */
export const db = getFirestore(app);

/** Firebase AI Logic — Gemini Developer API (no billing, no Agent Platform). */
let _rivoAI: any = null;
try {
  _rivoAI = getAI(app, { backend: new GoogleAIBackend() });
} catch (e) {
  console.warn("[RIVO] AI init skipped:", e);
}
export const rivoAI = _rivoAI;

/** App Check with reCAPTCHA Enterprise (if site key is set). */
let _appCheck: ReturnType<typeof initializeAppCheck> | null = null;
try {
  const siteKey = (import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined)?.trim();
  if (siteKey && !siteKey.startsWith("encrypted:") && typeof document !== "undefined") {
    _appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (e) {
  console.warn("[RIVO] App Check init skipped:", e);
}
export const appCheck = _appCheck;



/** Google sign-in provider — branded as RIVO. */
export const googleProvider = new GoogleAuthProvider();
// Show account chooser every time and brand the consent screen.
// The title "Sign in to continue with ai-rivo.firebaseapp.com" is controlled
// by the OAuth consent screen's App name in Google Cloud Console
// (APIs & Services → OAuth consent screen → App name = RIVO, add rivo logo).
// This prompt ensures the user sees "Choose an account to continue to RIVO"
googleProvider.setCustomParameters({ prompt: "select_account" });
googleProvider.addScope("profile");
googleProvider.addScope("email");

/** GitHub sign-in provider. */
export const githubProvider = new GithubAuthProvider();

export async function setConvexToken(user: User | null): Promise<string | null> {
  if (!user) return null;
  const token = await user.getIdToken();
  return token;
}

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  signInWithRedirect,
  signInAnonymously,
  signInWithCustomToken,
};
