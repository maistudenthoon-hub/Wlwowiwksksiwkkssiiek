import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RequireAuth } from "@/components/RequireAuth";
import { initTheme } from "@/components/rivo/SettingsDialog";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import "katex/dist/katex.min.css";
import { initSound } from "@/lib/sound";

initTheme();
initSound();

const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const ChatView = lazy(() => import("./pages/ChatView.tsx"));
const AdminPage = lazy(() => import("./pages/Admin.tsx"));
const LegalPage = lazy(() => import("./pages/Legal.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-brand" />
        <span className="animate-pulse text-sm text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string; stack: string }> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) { return { hasError: true, message: error.message || "Unknown runtime error", stack: error.stack || "" }; }
  componentDidCatch(err: Error) { console.error("[Root crash]:", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">{this.state.message}</p>
            {this.state.stack && <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">{this.state.stack}</pre>}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => { window.parent?.postMessage?.({ type: "iframe-route-change", path: location.pathname }, "*"); }, [location.pathname]);
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <TooltipProvider delayDuration={250}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<ChatView />} />
              <Route path="/auth" element={<AuthPage redirectAfterAuth="/" />} />
              <Route path="/dashboard" element={<RequireAuth><ChatView /></RequireAuth>} />
              <Route path="/c/:id" element={<RequireAuth><ChatView /></RequireAuth>} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/legal" element={<LegalPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster richColors closeButton />
      </TooltipProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
