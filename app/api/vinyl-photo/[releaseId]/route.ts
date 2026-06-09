import { fetchRelease } from "@/lib/discogs";
import { expectedVinylColors, ringCheckColors } from "@/lib/vinyl-color";
import { detectDiscInOverride, findVinylShot } from "@/lib/vinyl-image";
import { processVinylImage } from "@/lib/vinyl-process";
import { getVinylOverride } from "@/lib/vinyl-overrides";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await ctx.params;
  const id = Number(releaseId);
  if (!Number.isFinite(id)) {
    return new Response("Bad id", { status: 400 });
  }

  try {
    // Hand-picked override path: when the sheet has a row for this release we
    // skip detection entirely.
    //   - kind "photo" → process the user's chosen image as the vinyl preview.
    //   - kind "svg"   → return 404 so the album page falls back to its SVG
    //     fallback (which samples the color from the override image itself).
    const override = await getVinylOverride(id);
    if (override) {
      if (override.kind !== "photo") {
        return new Response(null, { status: 404 });
      }

      // Pull just enough of the release to know its expected color(s), so the
      // processor's background-keying step preserves the vinyl's own color
      // instead of treating it as background.
      const release = await fetchRelease(id).catch(() => null);
      const explicit = release
        ? expectedVinylColors(
            release.formats
              ?.flatMap((f) => [...(f.descriptions ?? []), f.text])
              .filter((s): s is string => Boolean(s)) ?? [],
          )
        : null;

      // Run real disc detection on the user-picked image: find the outer
      // vinyl boundary (NOT the inner label) by walking inward from the
      // background corners. Falls back to color-based detection if the bg is
      // ambiguous, then to centered-frame if both fail. Discogs's named
      // color (explicit) tunes both passes.
      const detected = await detectDiscInOverride(override.imageUrl, explicit);
      if (!detected) return new Response(null, { status: 500 });

      const processed = await processVinylImage(
        {
          url: override.imageUrl,
          sourceWidth: detected.sourceWidth,
          sourceHeight: detected.sourceHeight,
          cx: detected.cx,
          cy: detected.cy,
          radius: detected.radius,
          score: 0,
          ringColor: { r: 0, g: 0, b: 0 },
        },
        explicit,
      );
      if (!processed) return new Response(null, { status: 500 });

      return new Response(new Uint8Array(processed), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // No override — run normal detection across all secondary images.
    const release = await fetchRelease(id);
    const secondaryImages = (release.images ?? []).filter((img) => img.type !== "primary");
    const colorDescriptors =
      release.formats
        ?.flatMap((f) => [...(f.descriptions ?? []), f.text])
        .filter((s): s is string => Boolean(s)) ?? [];
    const explicit = expectedVinylColors(colorDescriptors);
    const ringColors = ringCheckColors(explicit);

    const shot = await findVinylShot(
      secondaryImages.map((img) => img.uri),
      ringColors,
      explicit,
    );
    if (!shot) return new Response(null, { status: 404 });

    const processed = await processVinylImage(shot, explicit);
    if (!processed) return new Response(null, { status: 500 });

    return new Response(new Uint8Array(processed), {
      headers: {
        "Content-Type": "image/png",
        // No immutable / no long cache — during active tuning the detection
        // can change at any time and we want fresh photos on refresh.
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
