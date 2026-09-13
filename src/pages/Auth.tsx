import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { RivoLogo } from "@/components/rivo/RivoLogo";
import { sounds, initSound, isSoundMuted, setSoundMuted } from "@/lib/sound";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" />
    </svg>
  );
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

interface AuthProps { redirectAfterAuth?: string; }

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => { initSound(); setMuted(isSoundMuted()); }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      sounds.success();
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleGoogle = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("google");
      sounds.success();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Google sign-in failed.";
      const friendly = raw.includes("popup-closed") ? "Sign-in popup was closed. Try again."
        : raw.includes("popup-blocked") ? "Pop-up was blocked. Please allow pop-ups for this site."
        : raw.includes("unauthorized-domain") ? "This domain isn't authorized for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains."
        : raw.includes("network") ? "Network error. Check your connection and try again."
        : raw;
      setError(friendly);
      sounds.error();
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--brand-soft)] via-transparent to-transparent opacity-[0.55]" />
        <div className="absolute -top-32 left-1/2 h-[640px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.18] blur-[80px]" style={{ background: "radial-gradient(closest-side, var(--brand) 0%, transparent 70%)" }} />
        <div className="absolute -top-10 right-[-120px] h-[480px] w-[480px] rounded-full opacity-[0.10] blur-[60px]" style={{ background: "radial-gradient(closest-side, var(--brand-2) 0%, transparent 70%)" }} />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")` }} />
      </div>

      <header className="relative z-10 mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
        <a href="/" className="flex items-center gap-2.5 rounded-xl px-1 py-1 transition-opacity hover:opacity-80" aria-label="RIVO home">
          <RivoLogo size={30} variant="mark" withWordmark wordmarkClassName="text-[15px]" />
        </a>
        <button
          onClick={() => { const v = !muted; setMuted(v); setSoundMuted(v); sounds.tap(); }}
          className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground backdrop-blur hover:text-foreground"
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </header>

      <div className="relative z-10 flex min-h-[calc(100vh-56px)] items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-[440px]"
        >
          <Card className="rivo-card overflow-hidden border shadow-[0_16px_50px_-20px_oklch(0_0_0/28%)] backdrop-blur">
            <CardHeader className="pb-4 text-center">
              <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08, duration: 0.4, ease: "easeOut" }} className="mx-auto flex justify-center">
                <span className="rivo-glow inline-flex items-center justify-center">
                  <RivoLogo size={72} variant="hero" />
                </span>
              </motion.div>
              <CardTitle className="mt-4 font-display text-[22px] tracking-tight">
                Welcome to RIVO
              </CardTitle>
              <CardDescription className="text-[13.5px] leading-relaxed">
                Sign in with your Google account to start chatting
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-0">
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.35 }}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-full border-border bg-card font-medium shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md active:translate-y-0"
                  onClick={handleGoogle}
                  disabled={isLoading}
                  onMouseEnter={() => sounds.hover()}
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon />}
                  {isLoading ? "Signing in…" : "Continue with Google"}
                </Button>

                {error && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
                    {error}
                  </motion.p>
                )}
              </motion.div>
            </CardContent>

            <div className="flex items-center justify-center gap-2 border-t bg-muted/40 px-6 py-3.5 text-center text-[11px] text-muted-foreground">
              <span>RIVO can make mistakes. Check important info.</span>
            </div>
          </Card>

          <p className="mx-auto mt-4 max-w-[440px] text-center text-xs leading-relaxed text-muted-foreground/80">
            By continuing you agree to our Terms of Service.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
