import { useAuth } from "@/hooks/use-auth";
import { TESTING_MODE } from "@/lib/firebase-db";
import { Loader2, ShieldBan } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

function BannedScreen({
  email,
  reason,
  until,
}: {
  email?: string;
  reason?: string;
  until: number | null;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-8 text-center shadow-xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10">
          <ShieldBan className="size-7 text-destructive" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Account suspended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {email ? (
            <>
              <span className="font-medium text-foreground">{email}</span> has been banned from
              RIVO.
            </>
          ) : (
            "This account has been banned from RIVO."
          )}
        </p>
        {reason ? (
          <p className="mt-3 rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
            <span className="font-medium">Reason:</span> {reason}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">
          {until
            ? `This ban is temporary and lifts on ${new Date(until).toLocaleString()}.`
            : "This ban is permanent."}
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Think this is a mistake? Contact contactrealrivo@gmail.com
        </p>
      </div>
    </main>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, banInfo } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-7 animate-spin rounded-full border-2 border-border border-t-brand" />
        </div>
      </main>
    );
  }

  if (banInfo && !TESTING_MODE) {
    return <BannedScreen email={banInfo.email} reason={banInfo.reason} until={banInfo.until} />;
  }

  if (!isAuthenticated && !TESTING_MODE) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return children;
}
