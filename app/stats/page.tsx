import Link from "next/link";
import Image from "next/image";
import { fetchFullCollection, primaryArtist } from "@/lib/discogs";
import type { CollectionRelease } from "@/lib/discogs";
import { listAllListens } from "@/lib/listens-store";
import { listAllRatings } from "@/lib/ratings-store";

// Listens and ratings change constantly; render fresh per request. The
// expensive Discogs collection fetch stays cached at the fetch layer (1h).
export const dynamic = "force-dynamic";

const TZ = "America/New_York";

// ─── Date helpers (all in EST so days/months match the user's calendar) ─────

function toEstDateString(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  // en-CA produces YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

// Last N month keys ending at the current month (EST).
function lastMonths(n: number): string[] {
  const todayKey = monthKey(toEstDateString(new Date().toISOString()));
  const [y0, m0] = todayKey.split("-").map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y0 * 12 + (m0 - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Streaks ────────────────────────────────────────────────────────────────

function computeStreaks(listenDates: Set<string>): {
  current: number;
  longest: number;
} {
  if (listenDates.size === 0) return { current: 0, longest: 0 };

  // Current streak: consecutive days ending today or yesterday (a streak
  // stays alive until a full day passes without a listen).
  const today = toEstDateString(new Date().toISOString());
  let cursor = listenDates.has(today) ? today : previousDay(today);
  let current = 0;
  while (listenDates.has(cursor)) {
    current++;
    cursor = previousDay(cursor);
  }

  // Longest streak: walk sorted unique dates.
  const sorted = [...listenDates].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (previousDay(sorted[i]) === sorted[i - 1]) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return { current, longest };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function StatsPage() {
  const [releases, listens, ratings] = await Promise.all([
    fetchFullCollection(),
    listAllListens(100000),
    listAllRatings(),
  ]);

  const byId = new Map<number, CollectionRelease>(
    releases.map((r) => [r.basic_information.id, r]),
  );

  // ── Top-line numbers ──
  const estDates = listens.map((l) => toEstDateString(l.listenedAt));
  const dateSet = new Set(estDates);
  const nowEst = toEstDateString(new Date().toISOString());
  const thisYear = nowEst.slice(0, 4);
  const thisMonth = monthKey(nowEst);
  const listensThisYear = estDates.filter((d) => d.startsWith(thisYear)).length;
  const listensThisMonth = estDates.filter(
    (d) => monthKey(d) === thisMonth,
  ).length;
  const distinctPlayed = new Set(listens.map((l) => l.releaseId)).size;
  const avgRating =
    ratings.length > 0
      ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length
      : null;
  const { current: currentStreak, longest: longestStreak } =
    computeStreaks(dateSet);

  // ── Listens by month (last 12) ──
  const monthKeys = lastMonths(12);
  const listensByMonth = new Map<string, number>();
  for (const d of estDates) {
    const k = monthKey(d);
    listensByMonth.set(k, (listensByMonth.get(k) ?? 0) + 1);
  }
  const monthSeries = monthKeys.map((k) => ({
    label: monthLabel(k),
    value: listensByMonth.get(k) ?? 0,
  }));

  // ── Most spun records & artists ──
  const countByRelease = new Map<number, number>();
  for (const l of listens) {
    countByRelease.set(l.releaseId, (countByRelease.get(l.releaseId) ?? 0) + 1);
  }
  const topRecords = [...countByRelease.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const countByArtist = new Map<string, number>();
  for (const [releaseId, count] of countByRelease) {
    const r = byId.get(releaseId);
    if (!r) continue;
    const artist = primaryArtist(r);
    countByArtist.set(artist, (countByArtist.get(artist) ?? 0) + count);
  }
  const topArtists = [...countByArtist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // ── Ratings distribution (1-10) ──
  const ratingBuckets = Array.from({ length: 10 }, (_, i) => ({
    label: String(i + 1),
    value: ratings.filter((r) => Math.round(r.rating) === i + 1).length,
  }));

  // ── Owned vs played by genre ──
  // Owned share: each release contributes 1 to each of its genres.
  // Played share: each LISTEN contributes 1 to each of its release's genres.
  const ownedByGenre = new Map<string, number>();
  for (const r of releases) {
    for (const g of r.basic_information.genres ?? []) {
      ownedByGenre.set(g, (ownedByGenre.get(g) ?? 0) + 1);
    }
  }
  const playedByGenre = new Map<string, number>();
  let playedGenreTotal = 0;
  for (const [releaseId, count] of countByRelease) {
    const r = byId.get(releaseId);
    if (!r) continue;
    for (const g of r.basic_information.genres ?? []) {
      playedByGenre.set(g, (playedByGenre.get(g) ?? 0) + count);
      playedGenreTotal += count;
    }
  }
  const ownedGenreTotal = [...ownedByGenre.values()].reduce((a, b) => a + b, 0);
  const topGenres = [...ownedByGenre.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([genre, owned]) => ({
      genre,
      ownedPct: ownedGenreTotal > 0 ? (owned / ownedGenreTotal) * 100 : 0,
      playedPct:
        playedGenreTotal > 0
          ? ((playedByGenre.get(genre) ?? 0) / playedGenreTotal) * 100
          : 0,
    }));

  // ── Collection growth (cumulative by month, all time) ──
  const addedByMonth = new Map<string, number>();
  for (const r of releases) {
    const k = monthKey(toEstDateString(r.date_added));
    addedByMonth.set(k, (addedByMonth.get(k) ?? 0) + 1);
  }
  const growthKeys = [...addedByMonth.keys()].sort();
  let growthSeries: { label: string; value: number }[] = [];
  if (growthKeys.length > 0) {
    // Fill in every month between first add and now.
    const first = growthKeys[0];
    const [fy, fm] = first.split("-").map(Number);
    const [ny, nm] = thisMonth.split("-").map(Number);
    const totalMonths = (ny * 12 + nm) - (fy * 12 + fm) + 1;
    let cumulative = 0;
    growthSeries = Array.from({ length: totalMonths }, (_, i) => {
      const total = fy * 12 + (fm - 1) + i;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      const k = `${y}-${String(m).padStart(2, "0")}`;
      cumulative += addedByMonth.get(k) ?? 0;
      return { label: k, value: cumulative };
    });
  }

  // ── Decades owned ──
  const byDecade = new Map<string, number>();
  for (const r of releases) {
    const y = r.basic_information.year;
    if (!y || y < 1900) continue;
    const dec = `${Math.floor(y / 10) * 10}s`;
    byDecade.set(dec, (byDecade.get(dec) ?? 0) + 1);
  }
  const decadeSeries = [...byDecade.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary/80 font-medium">
          Your life on vinyl
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Spin Stats
        </h1>
        <p className="text-sm text-muted-foreground">
          What you own, what you actually play, and how it&apos;s trending.
        </p>
      </div>

      {/* Top-line tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatTile label="Records" value={releases.length.toLocaleString()} />
        <StatTile label="Total listens" value={listens.length.toLocaleString()} />
        <StatTile
          label="Records played"
          value={distinctPlayed.toLocaleString()}
          sub={
            releases.length > 0
              ? `${Math.round((distinctPlayed / releases.length) * 100)}% of collection`
              : undefined
          }
        />
        <StatTile
          label="Avg rating"
          value={avgRating != null ? avgRating.toFixed(1) : "—"}
          sub={ratings.length > 0 ? `${ratings.length} rated` : undefined}
        />
        <StatTile
          label="This year"
          value={listensThisYear.toLocaleString()}
          sub={`${listensThisMonth} this month`}
        />
        <StatTile
          label="Streak"
          value={`${currentStreak}d`}
          sub={`best ${longestStreak}d`}
        />
      </div>

      {/* Listens by month */}
      <Section title="Listens by month" eyebrow="Last 12 months">
        <ChartCard>
          <BarChart data={monthSeries} height={160} />
        </ChartCard>
      </Section>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* Most spun records */}
        <Section title="Most spun" eyebrow="By listens">
          {topRecords.length === 0 ? (
            <EmptyNote>No listens logged yet.</EmptyNote>
          ) : (
            <ul className="space-y-2">
              {topRecords.map(([releaseId, count], i) => {
                const r = byId.get(releaseId);
                const info = r?.basic_information;
                return (
                  <li key={releaseId}>
                    <Link
                      href={`/album/${releaseId}`}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2.5 hover:bg-card/70 transition-colors"
                    >
                      <div className="text-xs text-muted-foreground tabular-nums w-4 text-center shrink-0">
                        {i + 1}
                      </div>
                      <div className="w-11 h-11 shrink-0 relative rounded overflow-hidden bg-muted ring-1 ring-white/5">
                        {info?.thumb && (
                          <Image
                            src={info.thumb}
                            alt={info.title}
                            fill
                            sizes="44px"
                            className="object-cover"
                            unoptimized
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {info?.title ?? `Release ${releaseId}`}
                        </div>
                        {r && (
                          <div className="text-xs text-muted-foreground truncate">
                            {primaryArtist(r)}
                          </div>
                        )}
                      </div>
                      <div className="text-sm tabular-nums text-primary shrink-0">
                        {count}×
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Most spun artists */}
        <Section title="Top artists" eyebrow="By listens">
          {topArtists.length === 0 ? (
            <EmptyNote>No listens logged yet.</EmptyNote>
          ) : (
            <HBarChart
              data={topArtists.map(([artist, count]) => ({
                label: artist,
                value: count,
              }))}
            />
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* Ratings distribution */}
        <Section title="Ratings" eyebrow="Distribution, 1–10">
          {ratings.length === 0 ? (
            <EmptyNote>No ratings yet.</EmptyNote>
          ) : (
            <ChartCard>
              <BarChart data={ratingBuckets} height={140} />
            </ChartCard>
          )}
        </Section>

        {/* Decades */}
        <Section title="By decade" eyebrow="Records owned">
          {decadeSeries.length === 0 ? (
            <EmptyNote>No release years available.</EmptyNote>
          ) : (
            <ChartCard>
              <BarChart data={decadeSeries} height={140} />
            </ChartCard>
          )}
        </Section>
      </div>

      {/* Owned vs played by genre */}
      <Section title="Owned vs played" eyebrow="Share by genre">
        {topGenres.length === 0 ? (
          <EmptyNote>No genre data.</EmptyNote>
        ) : (
          <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-3">
            <div className="flex items-center gap-4 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary/40 inline-block" />
                Owned
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />
                Played
              </span>
            </div>
            {topGenres.map((g) => (
              <div key={g.genre} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{g.genre}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {g.ownedPct.toFixed(0)}% owned · {g.playedPct.toFixed(0)}%
                    played
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/40"
                      style={{ width: `${Math.min(100, g.ownedPct)}%` }}
                    />
                  </div>
                  <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, g.playedPct)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Collection growth */}
      <Section title="Collection growth" eyebrow="Cumulative records">
        {growthSeries.length < 2 ? (
          <EmptyNote>Not enough history yet.</EmptyNote>
        ) : (
          <ChartCard>
            <AreaChart data={growthSeries} height={180} />
          </ChartCard>
        )}
      </Section>
    </div>
  );
}

// ─── UI bits ────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="font-semibold text-xl mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 font-medium">
            {eyebrow}
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground text-center">
      {children}
    </div>
  );
}

// ─── SVG charts (server-rendered, no client JS) ─────────────────────────────

function BarChart({
  data,
  height = 160,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const W = 600;
  const H = height;
  const PAD_BOTTOM = 18;
  const PAD_TOP = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const gap = 6;
  const barW = (W - gap * (n - 1)) / n;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const h = ((H - PAD_BOTTOM - PAD_TOP) * d.value) / max;
        const x = i * (barW + gap);
        const y = H - PAD_BOTTOM - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={3}
              fill="var(--primary)"
              opacity={0.85}
            />
            {d.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {d.value}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={H - 4}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5 space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="space-y-0.5">
          <div className="flex justify-between text-xs">
            <span className="truncate pr-3">{d.label}</span>
            <span className="text-muted-foreground tabular-nums shrink-0">
              {d.value}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AreaChart({
  data,
  height = 180,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const W = 600;
  const H = height;
  const PAD_BOTTOM = 18;
  const PAD_TOP = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const xFor = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const yFor = (v: number) =>
    H - PAD_BOTTOM - ((H - PAD_BOTTOM - PAD_TOP) * v) / max;

  const linePoints = data.map((d, i) => `${xFor(i)},${yFor(d.value)}`).join(" ");
  const areaPoints = `0,${H - PAD_BOTTOM} ${linePoints} ${W},${H - PAD_BOTTOM}`;

  // Sparse x-axis labels: first, ~quarter points, last.
  const labelIdx = new Set(
    [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].filter(
      (i) => i >= 0 && i < n,
    ),
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Area chart">
      <polygon points={areaPoints} fill="var(--primary)" opacity={0.15} />
      <polyline
        points={linePoints}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
      />
      {/* Final value marker */}
      <circle
        cx={xFor(n - 1)}
        cy={yFor(data[n - 1].value)}
        r={3.5}
        fill="var(--primary)"
      />
      <text
        x={Math.min(xFor(n - 1), W - 8)}
        y={yFor(data[n - 1].value) - 8}
        textAnchor="end"
        fontSize={12}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {data[n - 1].value}
      </text>
      {data.map((d, i) =>
        labelIdx.has(i) ? (
          <text
            key={i}
            x={Math.max(14, Math.min(xFor(i), W - 14))}
            y={H - 4}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {d.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
