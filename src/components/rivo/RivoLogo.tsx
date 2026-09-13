import rivoLogoPng from "@/assets/rivo-logo.png";
import { cn } from "@/lib/utils";

/**
 * RIVO mark — photographic R with transparent padding.
 * Letter R is optically enlarged (crop the transparent padding) and rendered
 * without any white card so it floats cleanly. Includes crisp filtering,
 * soft drop shadow, and a slow float for hero.
 */
const sizeMap = {
  xs: 22,
  sm: 30,
  md: 40,
  lg: 56,
  xl: 68,
  hero: 96,
  display: 120,
} as const;

type LogoSize = keyof typeof sizeMap | number;

function resolveSize(size: LogoSize): number {
  return typeof size === "number" ? size : sizeMap[size];
}

export function RivoLogo({
  className,
  size = "md",
  withWordmark = false,
  wordmarkClassName,
  variant = "mark",
}: {
  className?: string;
  size?: LogoSize;
  withWordmark?: boolean;
  wordmarkClassName?: string;
  variant?: "mark" | "hero" | "plain" | "card";
}) {
  const px = resolveSize(size);
  const isHero = variant === "hero" || size === "hero" || size === "display";

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)} aria-hidden>
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center overflow-visible",
          isHero && "rivo-logo-hero",
        )}
        style={{ width: px, height: px }}
      >
        {/* Glow only for hero — ultra soft, behind the R */}
        {isHero && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-[26px]"
            style={{
              background:
                "radial-gradient(closest-side, var(--brand-soft) 0%, color-mix(in oklch, var(--brand) 8%, transparent) 55%, transparent 72%)",
            }}
          />
        )}
        <img
          src={rivoLogoPng}
          alt=""
          width={px}
          height={px}
          className={cn(
            "h-full w-full object-contain will-change-transform",
            isHero
              ? "scale-[1.46] drop-shadow-[0_10px_28px_oklch(0_0_0/14%)] drop-shadow-[0_2px_10px_oklch(0_0_0/10%)] contrast-[1.06] saturate-[1.08]"
              : variant === "plain"
                ? "scale-[1.14] drop-shadow-[0_4px_12px_oklch(0_0_0/10%)] contrast-[1.04]"
                : "scale-[1.30] drop-shadow-[0_6px_16px_oklch(0_0_0/12%)] contrast-[1.05]",
          )}
          draggable={false}
          decoding="async"
          style={{
            imageRendering: "auto" as const,
            filter: isHero
              ? "drop-shadow(0 12px 32px color-mix(in oklch, var(--brand) 18%, transparent)) saturate(1.06) contrast(1.06)"
              : undefined,
          }}
        />
      </span>
      {withWordmark && (
        <span className={cn("rivo-wordmark leading-none tracking-[-0.04em]", wordmarkClassName)}>
          RIVO<span className="text-brand">.</span>
        </span>
      )}
    </span>
  );
}

export function RivoOrb({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[oklch(0.74_0.13_192)] via-[oklch(0.62_0.12_205)] to-[oklch(0.52_0.11_235)] opacity-[0.96] shadow-[0_6px_22px_-6px_var(--brand-soft),inset_0_1px_0_oklch(1_0_0/22%)]" />
      <span className="absolute inset-[1px] rounded-full bg-gradient-to-br from-white/18 to-transparent" />
      <img
        src={rivoLogoPng}
        alt=""
        // Fill the circle: 70% + 1.22 scale = letter edge-to-edge
        className="relative z-10 h-[70%] w-[70%] scale-[1.22] object-contain opacity-[0.98] drop-shadow-[0_1px_3px_oklch(0_0_0/22%)]"
        draggable={false}
      />
    </span>
  );
}

export function RivoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("rivo-wordmark inline-flex items-center gap-1.5", className)}>
      <span className="relative inline-flex size-[22px] shrink-0 items-center justify-center overflow-visible">
        <img src={rivoLogoPng} alt="" className="h-full w-full scale-[1.24] object-contain" draggable={false} />
      </span>
      <span className="text-[18px] tracking-[-0.04em]">
        RIVO<span className="text-brand">.</span>
      </span>
    </span>
  );
}

export { sizeMap };
