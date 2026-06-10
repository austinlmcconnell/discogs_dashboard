"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Heart, Hourglass, Sparkles } from "lucide-react";
import {
  comfortPool,
  dustyPool,
  pickSurprise,
  pickUniform,
  type SpinCandidate,
  DUSTY_DAYS,
} from "@/lib/spin";

// The three Smart Spin modes. Picks happen client-side (the candidate list
// is tiny — just {id, daysSince, rating} per record) so every press is
// instant, then we route to the chosen album.

export function SpinModes({ candidates }: { candidates: SpinCandidate[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const dusty = dustyPool(candidates);
  const comfort = comfortPool(candidates);
  const neverPlayed = candidates.filter((c) => c.daysSince == null).length;

  function go(pick: SpinCandidate | null) {
    if (!pick) return;
    startTransition(() => {
      router.push(`/album/${pick.id}?from=spin`);
    });
  }

  const months = Math.round(DUSTY_DAYS / 30);

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <ModeCard
        icon={<Sparkles className="w-5 h-5" />}
        title="Surprise me"
        blurb="Weighted toward records you haven't played in a while — anything can come up, but the neglected get priority."
        count={`${candidates.length} records in play`}
        onSpin={() => go(pickSurprise(candidates))}
        disabled={pending || candidates.length === 0}
      />
      <ModeCard
        icon={<Hourglass className="w-5 h-5" />}
        title="Dusty corner"
        blurb={`Records untouched for ${months}+ months — or never played at all.`}
        count={
          dusty.length > 0
            ? `${dusty.length} dusty · ${neverPlayed} never played`
            : "Nothing's dusty — impressive"
        }
        onSpin={() => go(pickUniform(dusty))}
        disabled={pending || dusty.length === 0}
      />
      <ModeCard
        icon={<Heart className="w-5 h-5" />}
        title="Comfort spin"
        blurb={
          comfort.minRating != null && comfort.minRating >= 7
            ? `A guaranteed good time — only records you rated ${comfort.minRating}+.`
            : "Your rated records. Rate more albums to sharpen this mode."
        }
        count={
          comfort.pool.length > 0
            ? `${comfort.pool.length} qualify`
            : "No ratings yet"
        }
        onSpin={() => go(pickUniform(comfort.pool))}
        disabled={pending || comfort.pool.length === 0}
      />
    </div>
  );
}

function ModeCard({
  icon,
  title,
  blurb,
  count,
  onSpin,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  count: string;
  onSpin: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSpin}
      disabled={disabled}
      className="group flex flex-col items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-5 text-left transition-all hover:border-primary/40 hover:bg-card/70 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border/60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <div className="text-primary">{icon}</div>
      <div className="font-semibold tracking-tight">{title}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{blurb}</p>
      <div className="mt-auto pt-2 text-[11px] uppercase tracking-wider text-muted-foreground/80 tabular-nums">
        {count}
      </div>
    </button>
  );
}
