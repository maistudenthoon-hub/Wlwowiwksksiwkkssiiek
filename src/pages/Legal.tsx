import { useEffect, useState } from "react";
import { fetchLegalDoc, type LegalDoc } from "@/lib/firebase-db";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { useNavigate } from "react-router";

function LegalSection({ title, body }: { title: string; body: string }) {
  // Simple paragraph rendering: blank-line separated blocks
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      ) : (
        blocks.map((b, i) => (
          <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {b}
          </p>
        ))
      )}
    </section>
  );
}

export default function Legal() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchLegalDoc()
      .then(setDoc)
      .finally(() => setLoaded(true));
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">RIVO Legal</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-4 py-10">
        {doc?.updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Last updated {new Date(doc.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </p>
        ) : null}

        <LegalSection title="Privacy Policy" body={doc?.privacyPolicy ?? ""} />

        <div className="border-t border-border" />

        <LegalSection title="Terms of Use" body={doc?.termsOfUse ?? ""} />

        {loaded && !doc ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <FileText className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              The site owner hasn't published legal documents yet.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
