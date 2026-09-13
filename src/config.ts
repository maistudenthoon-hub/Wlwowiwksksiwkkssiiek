/**
 * RIVO configuration — AI proxy URL.
 *
 * The AI proxy is a Google Apps Script Web App that proxies Gemini API calls
 * and sends welcome emails. The live URL is stored in Firestore (config/ai)
 * and editable from the Admin panel; this constant is only the fallback.
 */
export const STATIC_AI_URL =
  "https://script.google.com/macros/s/AKfycbyq-zYsACSpYfK87IvgizzQn0oauUeZJynXUyamgNokG2L0PdQ8jTcHwLKjpGeSkYBZ/exec";

/** @deprecated Use getAiUrl() from firebase-db — reads the live URL from Firestore. */
export const AI_WORKER_URL = STATIC_AI_URL;
