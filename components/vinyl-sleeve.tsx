"use client";

import Image from "next/image";
import { useId, useMemo } from "react";
import type { Vinyl } from "@/lib/vinyl-color";

type Props = {
  cover: string;
  alt: string;
  vinyl: Vinyl;
  photoUrl?: string | null;
};

export function VinylSleeve({ cover, alt, vinyl, photoUrl }: Props) {
  return (
    <div className="group relative w-full" style={{ paddingRight: "25%" }}>
      <div className="relative aspect-square w-full">
        <div
          className="absolute inset-0 z-0"
          style={{ transform: "translateX(33%)" }}
        >
          <div className="absolute inset-0 [animation:vinyl-spin_10s_linear_infinite] [animation-play-state:paused] group-hover:[animation-play-state:running] motion-reduce:[animation:none]">
            <VinylDisc vinyl={vinyl} cover={cover} photoUrl={photoUrl} />
          </div>
        </div>
        <div className="relative z-10 aspect-square overflow-hidden rounded-[2px] ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
          <Image
            src={cover}
            alt={alt}
            fill
            sizes="(max-width: 1024px) 100vw, 420px"
            className="object-cover"
            priority
            unoptimized
          />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-black/55 via-black/15 to-transparent" />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5" />
        </div>
      </div>
    </div>
  );
}

function darken(hex: string, amount = 0.25): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function brighten(hex: string, addAmount = 30): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + addAmount);
  const g = Math.min(255, ((n >> 8) & 0xff) + addAmount);
  const b = Math.min(255, (n & 0xff) + addAmount);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function isDarkColor(hex: string): boolean {
  if (!hex.startsWith("#") || hex.length !== 7) return false;
  const n = parseInt(hex.slice(1), 16);
  return Math.max((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff) < 60;
}

function VinylDisc({
  vinyl,
  cover,
  photoUrl,
}: {
  vinyl: Vinyl;
  cover: string;
  photoUrl?: string | null;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-z0-9]/gi, "");

  const splatter = useMemo(() => {
    if (vinyl.variant !== "splatter") return [] as { x: number; y: number; r: number }[];
    let seed = id.length || 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const dots: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < 50; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 30 + rand() * 65;
      dots.push({
        x: 100 + Math.cos(angle) * radius,
        y: 100 + Math.sin(angle) * radius,
        r: 0.8 + rand() * 3,
      });
    }
    return dots;
  }, [vinyl.variant, id]);

  const hasPhoto = Boolean(photoUrl);
  const isDark = isDarkColor(vinyl.primary);
  const isPicture = vinyl.variant === "picture";
  // Inner label radius. Real 12" vinyl labels span roughly 24% of disc radius.
  const LABEL_R = 24;

  // Generate groove rings — dense, slightly varied to look like actual lathe-
  // cut grooves rather than 8 perfectly-spaced circles. Skipped for photos
  // (the photo already has real grooves).
  const grooves = useMemo(() => {
    if (hasPhoto) return [];
    const out: { r: number; opacity: number }[] = [];
    // ~28 rings between just outside the label (r≈26) and just inside the
    // outer rim (r≈97). Sub-pixel spacing variation breaks the perfectly-
    // even cadence that read as fake.
    let r = 26;
    let i = 0;
    while (r < 97) {
      // Wobble the spacing slightly per ring (0.05× sin) so the bands don't
      // look procedurally perfect.
      const step = 2.55 + 0.4 * Math.sin(i * 1.7);
      // Every ~5 rings, a slightly darker/heavier band — mimics the visible
      // section transitions on a real LP.
      const isBand = i % 5 === 0;
      out.push({
        r,
        opacity: isBand ? 0.14 : 0.06,
      });
      r += step;
      i++;
    }
    return out;
  }, [hasPhoto]);

  return (
    <svg
      viewBox="0 0 200 200"
      className="h-full w-full drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)]"
      aria-hidden
    >
      <defs>
        {/* Body gradient. For black vinyl: stay genuinely dark — the previous
            brightened-center looked plastic. Use a deep-gray subtle gradient
            with the highlight handled by the separate shine + specular
            overlays. */}
        <radialGradient id={`body-${id}`} cx="50%" cy="50%" r="50%">
          {vinyl.variant === "clear" ? (
            <>
              <stop offset="0%" stopColor={vinyl.primary} stopOpacity="0.22" />
              <stop offset="60%" stopColor={vinyl.primary} stopOpacity="0.4" />
              <stop offset="100%" stopColor={vinyl.primary} stopOpacity="0.55" />
            </>
          ) : isDark ? (
            <>
              <stop offset="0%" stopColor="#1c1c1f" />
              <stop offset="55%" stopColor="#101013" />
              <stop offset="100%" stopColor="#050506" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor={brighten(vinyl.primary, 8)} />
              <stop offset="55%" stopColor={vinyl.primary} />
              <stop offset="100%" stopColor={darken(vinyl.primary, 0.42)} />
            </>
          )}
        </radialGradient>

        {vinyl.variant === "marbled" && vinyl.secondary && (
          <>
            <radialGradient id={`marble-a-${id}`} cx="28%" cy="32%" r="55%">
              <stop offset="0%" stopColor={vinyl.secondary} stopOpacity="0.85" />
              <stop offset="55%" stopColor={vinyl.secondary} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`marble-b-${id}`} cx="72%" cy="68%" r="50%">
              <stop offset="0%" stopColor={vinyl.secondary} stopOpacity="0.7" />
              <stop offset="60%" stopColor={vinyl.secondary} stopOpacity="0" />
            </radialGradient>
          </>
        )}

        <clipPath id={`disc-${id}`}>
          <circle cx="100" cy="100" r="100" />
        </clipPath>

        {/* Cover-thumbnail label clip — used for non-photo, non-picture
            vinyls. The center 24-radius area shows the album cover as if it
            were a printed paper label, with the spindle hole on top. */}
        <clipPath id={`label-${id}`}>
          <circle cx="100" cy="100" r={LABEL_R} />
        </clipPath>

        {/* Soft top-left highlight (existing). Subtler for black so it
            doesn't fight the specular sweep. */}
        <radialGradient id={`shine-${id}`} cx="30%" cy="20%" r="68%">
          <stop
            offset="0%"
            stopColor="white"
            stopOpacity={hasPhoto ? "0.10" : isDark ? "0.16" : "0.20"}
          />
          <stop offset="55%" stopColor="white" stopOpacity="0" />
        </radialGradient>

        {/* Specular sweep — a diagonal band of light catching the disc, like
            an overhead lamp reflecting across a slightly tilted record. The
            single most-effective realism cue. Skewed and oblong, NOT radial. */}
        <linearGradient
          id={`spec-${id}`}
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="32%" stopColor="white" stopOpacity="0" />
          <stop
            offset="44%"
            stopColor="white"
            stopOpacity={isDark ? "0.22" : "0.16"}
          />
          <stop offset="56%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        {/* Counter-specular (faint warm reflection from below, like the disc
            picking up light bounced from the table). Adds depth. */}
        <linearGradient
          id={`spec2-${id}`}
          x1="100%"
          y1="100%"
          x2="0%"
          y2="0%"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="44%" stopColor="white" stopOpacity="0" />
          <stop
            offset="52%"
            stopColor="white"
            stopOpacity={isDark ? "0.06" : "0.04"}
          />
          <stop offset="60%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#disc-${id})`}>
        {photoUrl ? (
          <image
            href={photoUrl}
            x="0"
            y="0"
            width="200"
            height="200"
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <>
            <circle cx="100" cy="100" r="100" fill={`url(#body-${id})`} />

            {vinyl.variant === "marbled" && vinyl.secondary && (
              <>
                <circle cx="100" cy="100" r="100" fill={`url(#marble-a-${id})`} />
                <circle cx="100" cy="100" r="100" fill={`url(#marble-b-${id})`} />
              </>
            )}

            {vinyl.variant === "splatter" &&
              splatter.map((d, i) => (
                <circle
                  key={i}
                  cx={d.x}
                  cy={d.y}
                  r={d.r}
                  fill={vinyl.secondary}
                  opacity="0.85"
                />
              ))}

            {isPicture && (
              <image
                href={cover}
                x="0"
                y="0"
                width="200"
                height="200"
                preserveAspectRatio="xMidYMid slice"
              />
            )}

            {/* Grooves — dense, varied opacity. Light strokes on dark vinyl
                (we can see them as faint highlights catching light) and dark
                strokes on light vinyl (groove shadows). */}
            <g fill="none" strokeWidth="0.28">
              {grooves.map((g, i) => (
                <circle
                  key={i}
                  cx="100"
                  cy="100"
                  r={g.r}
                  stroke={isDark ? "rgba(255,255,255,1)" : "rgba(0,0,0,1)"}
                  strokeOpacity={g.opacity}
                />
              ))}
            </g>

            {/* Lead-out groove area — the smooth shiny band near the outer
                edge that doesn't have music grooves. Faint inner ring marks
                where the grooves stop. */}
            <circle
              cx="100"
              cy="100"
              r="95"
              fill="none"
              stroke={isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.12)"}
              strokeWidth="0.5"
            />
          </>
        )}

        {/* Specular highlights — applied over EVERYTHING (photo or SVG) so
            both rendering paths get the same lighting cue. */}
        <circle cx="100" cy="100" r="100" fill={`url(#spec-${id})`} />
        <circle cx="100" cy="100" r="100" fill={`url(#spec2-${id})`} />
        <circle cx="100" cy="100" r="100" fill={`url(#shine-${id})`} />

        {/* Inner edge bevel — a single dark ring just inside the outer edge
            sells the depth. */}
        <circle
          cx="100"
          cy="100"
          r="99.5"
          fill="none"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="0.6"
        />
      </g>

      {/* Center label + spindle (skip for photo and for picture-disc, both of
          which already cover the center). */}
      {!hasPhoto && !isPicture && (
        <>
          {/* Cover thumbnail as the label */}
          <g clipPath={`url(#label-${id})`}>
            <image
              href={cover}
              x={100 - LABEL_R}
              y={100 - LABEL_R}
              width={LABEL_R * 2}
              height={LABEL_R * 2}
              preserveAspectRatio="xMidYMid slice"
            />
            {/* Label highlight — subtle radial sheen across the paper. */}
            <circle
              cx={100 - LABEL_R * 0.35}
              cy={100 - LABEL_R * 0.45}
              r={LABEL_R * 0.9}
              fill="rgba(255,255,255,0.18)"
            />
          </g>
          {/* Label paper edge — a soft ring where the label sits on the
              vinyl, casting a tiny shadow. */}
          <circle
            cx="100"
            cy="100"
            r={LABEL_R}
            fill="none"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth="0.5"
          />
          <circle
            cx="100"
            cy="100"
            r={LABEL_R + 0.5}
            fill="none"
            stroke="rgba(0,0,0,0.18)"
            strokeWidth="0.4"
          />
          {/* Spindle hole — dark center with a tiny rim highlight. */}
          <circle cx="100" cy="100" r="2.4" fill="#050505" />
          <circle
            cx="100"
            cy="100"
            r="2.4"
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="0.3"
          />
        </>
      )}

      {/* For picture discs, still add the spindle hole on top. */}
      {!hasPhoto && isPicture && (
        <>
          <circle cx="100" cy="100" r="2.4" fill="#050505" />
          <circle
            cx="100"
            cy="100"
            r="2.4"
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="0.3"
          />
        </>
      )}
    </svg>
  );
}
