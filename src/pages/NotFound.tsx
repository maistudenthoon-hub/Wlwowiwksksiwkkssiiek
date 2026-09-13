import { Link } from "react-router";
import { RivoOrb } from "@/components/rivo/MessageContent";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col"
    >
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
            <div className="rivo-glow">
              <RivoOrb className="size-12" />
            </div>
            <h1 className="mt-6 text-6xl font-bold tracking-tight">404</h1>
            <p className="mt-3 text-lg text-muted-foreground">Page not found.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              That conversation moved or doesn't exist.
            </p>
            <div className="mt-8 flex gap-3">
              <Button asChild size="lg" className="rivo-btn-brand rounded-full">
                <Link to="/">Back to RIVO</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full">
                <Link to="/">New chat</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
