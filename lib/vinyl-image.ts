import sharp from "sharp";
import type { RGB as ColorRGB } from "./vinyl-color";

export type VinylShot = {
  url: string;
  sourceWidth: number;
  sourceHeight: number;
  cx: number;
  cy: number;
  radius: number;
  score: number;
  ringColor: { r: number; g: number; b: number };
  // tier 3 = partial color-region pick; processing should preserve the
  // matched region without bg keying (the "bg" is just other image content).
  partialColor?: boolean;
};

const SAMPLE = 100;
const CORNER = 14;

const CACHE_VERSION = 36;
const cache = new Map<string, VinylShot | null>();
// version tag forces a fresh cache after threshold changes: v${CACHE_VERSION}

type RGB = { r: number; g: number; b: number };

function dist(a: RGB, b: RGB) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sampleArea(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { mean: RGB; variance: number } {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * channels;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  const mr = r / n,
    mg = g / n,
    mb = b / n;
  let varSum = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * channels;
      const dr = data[i] - mr;
      const dg = data[i + 1] - mg;
      const db = data[i + 2] - mb;
      varSum += dr * dr + dg * dg + db * db;
    }
  }
  return { mean: { r: mr, g: mg, b: mb }, variance: Math.sqrt(varSum / n) };
}

function pickBackground(corners: { mean: RGB; variance: number }[]): {
  bg: RGB;
  agreement: number;
} {
  let bestCluster: { mean: RGB; variance: number }[] = [];
  for (let i = 0; i < corners.length; i++) {
    const cluster = [corners[i]];
    for (let j = 0; j < corners.length; j++) {
      if (j === i) continue;
      if (dist(corners[i].mean, corners[j].mean) < 45) cluster.push(corners[j]);
    }
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }
  const bg: RGB = {
    r: bestCluster.reduce((a, c) => a + c.mean.r, 0) / bestCluster.length,
    g: bestCluster.reduce((a, c) => a + c.mean.g, 0) / bestCluster.length,
    b: bestCluster.reduce((a, c) => a + c.mean.b, 0) / bestCluster.length,
  };
  return { bg, agreement: bestCluster.length / corners.length };
}

// Vinyl-shot structural fingerprint: a real vinyl photo has a smaller circular
// LABEL of distinct color inside the disc. Walks outward from the disc center
// at 16 angles, looking for a consistent transition from the center color
// (label) to a different color (vinyl body). Rejects label-only close-ups,
// liner notes, back covers — none of which have this concentric structure.
function hasConcentricLabel(
  data: Buffer,
  width: number,
  channels: number,
  cx: number,
  cy: number,
  outerRadius: number,
): boolean {
  // Center color: sample 6x6 at the very middle
  const cxi = Math.round(cx);
  const cyi = Math.round(cy);
  if (cxi - 3 < 0 || cxi + 3 >= width || cyi - 3 < 0 || cyi + 3 >= width) return false;
  let cr = 0,
    cg = 0,
    cb = 0;
  for (let yy = cyi - 3; yy < cyi + 3; yy++) {
    for (let xx = cxi - 3; xx < cxi + 3; xx++) {
      const i = (yy * width + xx) * channels;
      cr += data[i];
      cg += data[i + 1];
      cb += data[i + 2];
    }
  }
  const center: RGB = { r: cr / 36, g: cg / 36, b: cb / 36 };

  const angles = 16;
  const labelRadii: number[] = [];
  const transitionThreshold = 35;
  const barrier = 3;

  for (let a = 0; a < angles; a++) {
    const angle = (a / angles) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let transition = -1;
    for (let r = 2; r < outerRadius; r++) {
      const x = Math.round(cx + r * cos);
      const y = Math.round(cy + r * sin);
      if (x < 0 || x >= width || y < 0 || y >= width) break;
      const i = (y * width + x) * channels;
      const px: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (dist(px, center) <= transitionThreshold) continue;
      // Confirm the transition is sustained (not a single text pixel)
      let confirmed = true;
      for (let k = 1; k < barrier; k++) {
        const x2 = Math.round(cx + (r + k) * cos);
        const y2 = Math.round(cy + (r + k) * sin);
        if (x2 < 0 || x2 >= width || y2 < 0 || y2 >= width) {
          confirmed = false;
          break;
        }
        const i2 = (y2 * width + x2) * channels;
        const p2: RGB = { r: data[i2], g: data[i2 + 1], b: data[i2 + 2] };
        if (dist(p2, center) <= transitionThreshold) {
          confirmed = false;
          break;
        }
      }
      if (confirmed) {
        transition = r;
        break;
      }
    }
    if (transition > 0) labelRadii.push(transition);
  }

  if (labelRadii.length < angles * 0.7) return false;

  const sorted = [...labelRadii].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Most transitions should cluster around the label edge — use MAD-style
  // tolerance instead of percentile spread (which is fragile with text/art
  // on the label creating outlier transitions).
  let withinTolerance = 0;
  for (const r of labelRadii) {
    if (Math.abs(r - median) / median < 0.30) withinTolerance++;
  }
  if (withinTolerance / labelRadii.length < 0.65) return false;

  // Label / center-feature size — anywhere from a tiny spindle (3 px) up to
  // a label that takes ~55% of the disc. We allow tiny centers because some
  // vinyl photos (e.g., Wonka gold) just show a spindle hole with no label
  // artwork. Body-color match handles false positives downstream.
  const labelRatio = median / outerRadius;
  if (labelRatio < 0.06 || labelRatio > 0.55) return false;
  if (median < 3) return false;

  return true;
}

async function analyzeOne(url: string): Promise<VinylShot | null> {
  const cacheKey = `v${CACHE_VERSION}|${url}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  let meta: { width?: number; height?: number };
  let data: Buffer;
  let info: { width: number; height: number; channels: number };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      cache.set(cacheKey, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf);
    meta = await img.metadata();
    const out = await img
      .resize(SAMPLE, SAMPLE, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    info = out.info;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }

  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight) {
    cache.set(cacheKey, null);
    return null;
  }

  const corners = [
    sampleArea(data, info.width, info.channels, 0, 0, CORNER, CORNER),
    sampleArea(data, info.width, info.channels, SAMPLE - CORNER, 0, CORNER, CORNER),
    sampleArea(data, info.width, info.channels, 0, SAMPLE - CORNER, CORNER, CORNER),
    sampleArea(data, info.width, info.channels, SAMPLE - CORNER, SAMPLE - CORNER, CORNER, CORNER),
  ];
  const { bg, agreement } = pickBackground(corners);
  if (agreement < 0.75) {
    cache.set(cacheKey, null);
    return null;
  }

  const cx = SAMPLE / 2;
  const cy = SAMPLE / 2;
  const maxRadius = SAMPLE / 2 - 1;

  // Vinyl labels can be off-center in user-uploaded photos — skip per-pixel
  // uniformity at the geometric center. The solidness check below validates
  // that the disc area is filled with vinyl, and aspect/circularity checks
  // catch rectangles. Contrast still required so center isn't just background.
  const center = sampleArea(
    data,
    info.width,
    info.channels,
    Math.round(cx - 4),
    Math.round(cy - 4),
    8,
    8,
  );
  if (dist(center.mean, bg) < 22) {
    cache.set(cacheKey, null);
    return null;
  }

  // Walk edge → inward with barrier-of-3, but start at maxR-2 to skip resize/JPEG edge artifacts.
  const angles = 36;
  const bgTolerance = 30;
  const barrier = 3;
  const walkStart = maxRadius - 2;

  const radii: number[] = [];
  for (let a = 0; a < angles; a++) {
    const angle = (a / angles) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let edge = -1;
    for (let r = walkStart; r > 6; r--) {
      const x = Math.round(cx + r * cos);
      const y = Math.round(cy + r * sin);
      if (x < 0 || x >= SAMPLE || y < 0 || y >= SAMPLE) continue;
      const i = (y * info.width + x) * info.channels;
      const px: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (dist(px, bg) <= bgTolerance) continue;
      let ok = true;
      for (let k = 1; k < barrier; k++) {
        const x2 = Math.round(cx + (r - k) * cos);
        const y2 = Math.round(cy + (r - k) * sin);
        if (x2 < 0 || x2 >= SAMPLE || y2 < 0 || y2 >= SAMPLE) {
          ok = false;
          break;
        }
        const i2 = (y2 * info.width + x2) * info.channels;
        const p2: RGB = { r: data[i2], g: data[i2 + 1], b: data[i2 + 2] };
        if (dist(p2, bg) <= bgTolerance) {
          ok = false;
          break;
        }
      }
      if (ok) {
        edge = r;
        break;
      }
    }
    if (edge > 0) radii.push(edge);
  }

  // 80% threshold lets low-contrast cases (deep blue vinyl on black bg) through.
  // Other checks (circularity, ring uniformity, concentric label) will catch
  // false positives.
  if (radii.length < angles * 0.80) {
    cache.set(cacheKey, null);
    return null;
  }

  const sorted = [...radii].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];

  if (median < SAMPLE * 0.28) {
    cache.set(cacheKey, null);
    return null;
  }
  if (p90 / p10 > 1.12) {
    cache.set(cacheKey, null);
    return null;
  }

  const card = [radii[0], radii[9], radii[18], radii[27]];
  const diag = [radii[4], radii[13], radii[22], radii[31]];
  const cardMean = card.reduce((a, r) => a + r, 0) / 4;
  const diagMean = diag.reduce((a, r) => a + r, 0) / 4;
  const aspectError = Math.abs(diagMean - cardMean) / Math.max(cardMean, diagMean);
  if (aspectError > 0.08) {
    cache.set(cacheKey, null);
    return null;
  }

  // Ring-uniformity check: sample 8 points at 65% of median radius. For a real
  // vinyl, those points are all in the vinyl body — one color (or smooth marble),
  // so max pairwise distance stays bounded. For a sticker with text, the ring
  // crosses text and sticker-bg, so the spread is huge.
  const ringR = Math.round(median * 0.65);
  const ringSamples: RGB[] = [];
  for (let a = 0; a < 8; a++) {
    const angle = (a / 8) * 2 * Math.PI;
    const px = Math.round(cx + ringR * Math.cos(angle));
    const py = Math.round(cy + ringR * Math.sin(angle));
    if (px - 3 < 0 || px + 3 >= SAMPLE || py - 3 < 0 || py + 3 >= SAMPLE) continue;
    const s = sampleArea(data, info.width, info.channels, px - 3, py - 3, 6, 6);
    ringSamples.push(s.mean);
  }
  if (ringSamples.length < 6) {
    cache.set(cacheKey, null);
    return null;
  }
  let maxRingDist = 0;
  for (let i = 0; i < ringSamples.length; i++) {
    for (let j = i + 1; j < ringSamples.length; j++) {
      const d = dist(ringSamples[i], ringSamples[j]);
      if (d > maxRingDist) maxRingDist = d;
    }
  }
  if (maxRingDist > 110) {
    cache.set(cacheKey, null);
    return null;
  }
  // Also: no ring sample should be close to bg (would indicate a hole/gap in the disc)
  let bgLikeCount = 0;
  for (const s of ringSamples) {
    if (dist(s, bg) < 25) bgLikeCount++;
  }
  if (bgLikeCount > 1) {
    cache.set(cacheKey, null);
    return null;
  }

  // Center (label) must visibly differ from mid-radius (vinyl body). For a
  // close-up of just a label, the entire disc is one color so they match.
  const ringMean: RGB = {
    r: ringSamples.reduce((a, s) => a + s.r, 0) / ringSamples.length,
    g: ringSamples.reduce((a, s) => a + s.g, 0) / ringSamples.length,
    b: ringSamples.reduce((a, s) => a + s.b, 0) / ringSamples.length,
  };
  if (dist(center.mean, ringMean) < 25) {
    cache.set(cacheKey, null);
    return null;
  }

  // Concentric structure: must have a circular inner label of different color.
  // Rejects label-only close-ups, liner notes, back covers, inserts.
  if (!hasConcentricLabel(data, info.width, info.channels, cx, cy, median)) {
    cache.set(cacheKey, null);
    return null;
  }

  // p25 with a 5% trim — tight crop, no halo.
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const tightRadius = p25 * 0.95;
  const radius = tightRadius / SAMPLE;

  const centerContrast = dist(center.mean, bg);
  const score =
    centerContrast / 255 +
    (1 - p90 / p10) +
    Math.min(radius * 2, 1) +
    (1 - aspectError) +
    Math.max(0, 1 - maxRingDist / 110);

  const shot: VinylShot = {
    url,
    sourceWidth,
    sourceHeight,
    cx: 0.5,
    cy: 0.5,
    radius,
    score,
    ringColor: ringMean,
  };
  cache.set(cacheKey, shot);
  return shot;
}

function colorMatches(ringColor: { r: number; g: number; b: number }, expected: ColorRGB[]): boolean {
  for (const exp of expected) {
    const d = Math.sqrt(
      (ringColor.r - exp.r) * (ringColor.r - exp.r) +
        (ringColor.g - exp.g) * (ringColor.g - exp.g) +
        (ringColor.b - exp.b) * (ringColor.b - exp.b),
    );
    if (d < 110) return true;
    // "Black" expectation: also accept any sufficiently dark ring (vinyl body
    // is rarely pitch-black under photography lighting).
    if (exp.r < 40 && exp.g < 40 && exp.b < 40) {
      const maxChannel = Math.max(ringColor.r, ringColor.g, ringColor.b);
      if (maxChannel < 95) return true;
    }
  }
  return false;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rN = r / 255,
    gN = g / 255,
    bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN:
        h = (gN - bN) / d + (gN < bN ? 6 : 0);
        break;
      case gN:
        h = (bN - rN) / d + 2;
        break;
      case bN:
        h = (rN - gN) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hueDistance(h1: number, h2: number) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

// Permissive per-pixel color match used by the color-blob fallback.
// For saturated expected colors (red, blue, green, etc.) we match by HUE so a
// "Deep Blue Vinyl" (lightness 20%) still matches the bright blue specification.
// For black/white/gray we fall back to RGB distance.
// Returns a continuous score 0-1 for how closely a pixel matches any of the
// expected colors. 1 = exact match. 0 = no match. Used by the "most matching
// color wins" picker so that bright, true-color pixels (real vinyl) outweigh
// dim same-hue pixels (paper, wood, cardboard tinted by lighting).
function pixelMatchQuality(
  px: { r: number; g: number; b: number },
  expected: ColorRGB[],
): number {
  const pxHsl = rgbToHsl(px.r, px.g, px.b);
  let best = 0;
  for (const exp of expected) {
    const expHsl = rgbToHsl(exp.r, exp.g, exp.b);

    // White case: very light, low-chroma expected. Strict gates — most photo
    // highlights are l>0.82 but real WHITE vinyl is l>0.90 with near-zero
    // saturation. Loose gates here cause light album art / inserts to score
    // higher than the actual white vinyl photo.
    if (expHsl.l > 0.85 && expHsl.s < 0.45) {
      if (pxHsl.l > 0.90 && pxHsl.s < 0.12) {
        const lightnessFit = Math.max(0, 1 - Math.abs(pxHsl.l - expHsl.l) * 2.5);
        const lowChromaBonus = Math.max(0, 1 - pxHsl.s * 5);
        best = Math.max(best, lightnessFit * lowChromaBonus);
      }
      continue;
    }

    // Black case: very dark.
    if (exp.r < 40 && exp.g < 40 && exp.b < 40) {
      const maxCh = Math.max(px.r, px.g, px.b);
      if (maxCh < 100) {
        best = Math.max(best, 1 - maxCh / 100);
      }
      continue;
    }

    // Saturated colored. Stricter hue + sat than before — narrow hue band
    // (40° vs 55°) and higher saturation floor (0.25 vs 0.15) so warm photo
    // lighting / brick / wood / cardboard don't read as "red"/"yellow".
    if (expHsl.s > 0.35) {
      const hueDist = hueDistance(pxHsl.h, expHsl.h);
      if (pxHsl.s > 0.25 && hueDist < 40) {
        // Three sub-scores combined multiplicatively:
        //   - hue closeness (1 if exact, 0 at 40° away)
        //   - saturation closeness — penalize desaturated pixels masquerading
        //     as the color (wood, cardboard)
        //   - lightness closeness — penalize pixels much darker or lighter
        //     than the named color
        const hueQ = 1 - hueDist / 40;
        const satQ = Math.min(1, pxHsl.s / Math.max(0.3, expHsl.s));
        const lightnessQ = Math.max(0, 1 - Math.abs(pxHsl.l - expHsl.l) * 1.5);
        best = Math.max(best, hueQ * satQ * lightnessQ);
      }
    }
  }
  return best;
}

function pixelMatchesExpected(
  px: { r: number; g: number; b: number },
  expected: ColorRGB[],
): boolean {
  const pxHsl = rgbToHsl(px.r, px.g, px.b);
  for (const exp of expected) {
    const expHsl = rgbToHsl(exp.r, exp.g, exp.b);

    // White case: very light expected. Match by lightness + low saturation.
    if (expHsl.l > 0.85 && expHsl.s < 0.45) {
      if (pxHsl.l > 0.82 && pxHsl.s < 0.18) return true;
      continue;
    }

    // Black case: very dark expected. Match by lightness only.
    if (exp.r < 40 && exp.g < 40 && exp.b < 40) {
      if (Math.max(px.r, px.g, px.b) < 90) return true;
      continue;
    }

    // Saturated colored expected → hue + saturation match
    if (expHsl.s > 0.35) {
      if (pxHsl.s > 0.15 && hueDistance(pxHsl.h, expHsl.h) < 55) return true;
    }

    // Mid-saturation expected (browns, grays): RGB distance only
    const d = Math.sqrt(
      (px.r - exp.r) ** 2 + (px.g - exp.g) ** 2 + (px.b - exp.b) ** 2,
    );
    if (d < 60) return true;
  }
  return false;
}

// Sample the actual vinyl color across all images by finding pixels in the
// expected hue family and computing their median RGB. Works even when no full
// vinyl photo exists — e.g. a label close-up showing a corner of the vinyl
// will contribute the real vinyl shade. Used to override the generic
// color-map default when rendering the SVG fallback.
export async function sampleVinylShade(
  urls: string[],
  expected: ColorRGB[],
): Promise<ColorRGB | null> {
  const SHADE_SIZE = 80;
  const matches: ColorRGB[] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "DiscogsDashboard/0.1" },
          next: { revalidate: 86400 },
        });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const { data, info } = await sharp(buf)
          .resize(SHADE_SIZE, SHADE_SIZE, { fit: "cover" })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        for (let i = 0; i < data.length; i += info.channels) {
          const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
          if (pixelMatchesExpected(px, expected)) {
            matches.push(px);
          }
        }
      } catch {
        // Skip image
      }
    }),
  );

  if (matches.length < 200) return null;

  const sortedR = matches.map((p) => p.r).sort((a, b) => a - b);
  const sortedG = matches.map((p) => p.g).sort((a, b) => a - b);
  const sortedB = matches.map((p) => p.b).sort((a, b) => a - b);
  const mid = Math.floor(matches.length / 2);
  return { r: sortedR[mid], g: sortedG[mid], b: sortedB[mid] };
}

// Detect the full disc (outer vinyl edge, not the label) in a single
// user-chosen override image. The user has vouched for the image, so we don't
// reject — we just find where the disc is. Strategy:
//   1. Walk inward from each of 36 angles, find the first sustained non-bg
//      pixel — that's the outer vinyl boundary. Finds the WHOLE disc whether
//      or not the label is centered, because we always walk from the bg edge.
//   2. Median the boundary radii from the centroid → disc radius.
//   3. If bg detection is shaky (low corner agreement / few boundary points)
//      AND the Discogs format text gave us a saturated expected color, fall
//      back to color-based detection: find the bounding box of expected-color
//      pixels.
//   4. If both fail, assume the disc fills the frame (no detection needed).
const overrideDetectCache = new Map<string, {
  sourceWidth: number;
  sourceHeight: number;
  cx: number;
  cy: number;
  radius: number;
} | null>();
const OVERRIDE_DETECT_VERSION = 1;

export async function detectDiscInOverride(
  url: string,
  expectedColors?: ColorRGB[] | null,
): Promise<{
  sourceWidth: number;
  sourceHeight: number;
  cx: number;
  cy: number;
  radius: number;
} | null> {
  const expectedKey = expectedColors
    ? expectedColors.map((c) => `${c.r},${c.g},${c.b}`).join(";")
    : "none";
  const cacheKey = `v${OVERRIDE_DETECT_VERSION}|${url}|${expectedKey}`;
  if (overrideDetectCache.has(cacheKey)) {
    return overrideDetectCache.get(cacheKey) ?? null;
  }

  const SZ_MAX = 100;
  let meta: { width?: number; height?: number };
  let data: Buffer;
  let info: { width: number; height: number; channels: number };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      overrideDetectCache.set(cacheKey, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf);
    meta = await img.metadata();
    // fit:"inside" preserves aspect ratio — non-square images come back as
    // a non-square buffer (e.g. 503×386 source → 100×77 buffer). Crucial:
    // returning cx/cy as fractions of THIS buffer's W/H is identical to
    // returning them as fractions of the original W/H, so the downstream
    // processVinylImage call lands on the right pixels.
    const out = await img
      .resize(SZ_MAX, SZ_MAX, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    info = out.info;
  } catch {
    overrideDetectCache.set(cacheKey, null);
    return null;
  }

  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight) {
    overrideDetectCache.set(cacheKey, null);
    return null;
  }

  const W = info.width;
  const H = info.height;
  const SHORT = Math.min(W, H);

  // Sample 4 image corners (8×8) to estimate the background.
  const CORNER = 8;
  const corners = [
    sampleArea(data, W, info.channels, 0, 0, CORNER, CORNER),
    sampleArea(data, W, info.channels, W - CORNER, 0, CORNER, CORNER),
    sampleArea(data, W, info.channels, 0, H - CORNER, CORNER, CORNER),
    sampleArea(data, W, info.channels, W - CORNER, H - CORNER, CORNER, CORNER),
  ];
  const { bg, agreement } = pickBackground(corners);

  // Default fallback: disc fills the frame, centered.
  const filledFrame = {
    sourceWidth,
    sourceHeight,
    cx: 0.5,
    cy: 0.5,
    radius: 0.48,
  };

  // ── BG-contrast detection ────────────────────────────────────────────────
  // Walk inward from each of 36 angles; require a 3-pixel-deep sustained
  // contrast so a single text/scratch/sample of bg-colored content doesn't
  // mark the boundary prematurely. Skips the "white label on white bg" trap
  // because we ALWAYS start from the image edge, never from center.
  let detected: { cx: number; cy: number; radius: number } | null = null;
  if (agreement >= 0.5) {
    const cx0 = W / 2;
    const cy0 = H / 2;
    const maxR = SHORT / 2 - 1;
    const ANGLES = 36;
    const BG_TOL = 35;
    const BARRIER = 3;
    const points: { x: number; y: number }[] = [];

    for (let a = 0; a < ANGLES; a++) {
      const ang = (a / ANGLES) * 2 * Math.PI;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      for (let r = maxR; r > 5; r--) {
        const x = Math.round(cx0 + r * cos);
        const y = Math.round(cy0 + r * sin);
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * info.channels;
        const px: RGB = { r: data[i], g: data[i + 1], b: data[i + 2] };
        if (dist(px, bg) <= BG_TOL) continue;
        let confirmed = true;
        for (let k = 1; k < BARRIER; k++) {
          const x2 = Math.round(cx0 + (r - k) * cos);
          const y2 = Math.round(cy0 + (r - k) * sin);
          if (x2 < 0 || x2 >= W || y2 < 0 || y2 >= H) {
            confirmed = false;
            break;
          }
          const i2 = (y2 * W + x2) * info.channels;
          const p2: RGB = { r: data[i2], g: data[i2 + 1], b: data[i2 + 2] };
          if (dist(p2, bg) <= BG_TOL) {
            confirmed = false;
            break;
          }
        }
        if (confirmed) {
          points.push({ x, y });
          break;
        }
      }
    }

    if (points.length >= ANGLES * 0.7) {
      const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
      const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
      const dists = points
        .map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2))
        .sort((a, b) => a - b);
      // p60 (slightly past median) — gives a touch more padding so we don't
      // shave the outer vinyl. processVinylImage's bg keying handles any
      // residual halo cleanly.
      const r60 = dists[Math.floor(dists.length * 0.6)];
      detected = { cx, cy, radius: r60 * 0.98 };
    }
  }

  // ── Color-based fallback ─────────────────────────────────────────────────
  // If bg detection failed and Discogs gave us a saturated color, find the
  // bounding region of expected-color pixels. Helps with full-bleed images
  // (no bg visible) of brightly-colored vinyl.
  if (!detected && expectedColors && expectedColors.length > 0) {
    const hasSaturated = expectedColors.some((c) => {
      const hsl = rgbToHsl(c.r, c.g, c.b);
      return hsl.s > 0.35;
    });
    if (hasSaturated) {
      let minX = W,
        maxX = -1,
        minY = H,
        maxY = -1,
        sumX = 0,
        sumY = 0,
        count = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * info.channels;
          const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
          if (pixelMatchQuality(px, expectedColors) > 0.4) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            sumX += x;
            sumY += y;
            count++;
          }
        }
      }
      if (count >= 200 && maxX - minX >= SHORT * 0.3 && maxY - minY >= SHORT * 0.3) {
        const cx = sumX / count;
        const cy = sumY / count;
        const bboxHalf = Math.max(maxX - minX, maxY - minY) / 2;
        detected = { cx, cy, radius: bboxHalf * 1.05 };
      }
    }
  }

  // ── Verification ─────────────────────────────────────────────────────────
  // If detected radius is suspiciously small (< 25% of short side) or the body
  // at 0.7*radius looks like bg (we may have hit the label, not the disc
  // edge), discard and fall back.
  if (detected) {
    const { cx, cy, radius } = detected;
    if (radius < SHORT * 0.25) {
      detected = null;
    } else {
      let bgLikeBody = 0;
      const RING_R = radius * 0.7;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * 2 * Math.PI;
        const x = Math.round(cx + RING_R * Math.cos(ang));
        const y = Math.round(cy + RING_R * Math.sin(ang));
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * info.channels;
        const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
        if (dist(px, bg) < 25) bgLikeBody++;
      }
      if (bgLikeBody > 4) detected = null;
    }
  }

  const result = detected
    ? {
        sourceWidth,
        sourceHeight,
        // cx as fraction of WIDTH, cy as fraction of HEIGHT, radius as
        // fraction of SHORT side — matches processVinylImage's interpretation.
        cx: detected.cx / W,
        cy: detected.cy / H,
        radius: detected.radius / SHORT,
      }
    : filledFrame;

  overrideDetectCache.set(cacheKey, result);
  return result;
}

// For sheet-override rows tagged "svg" / "Outer X color" / "Use X to create
// custom SVG version": sample the dominant vinyl color from a single
// user-chosen image. We look at pixels in a ring at 35–45% of the image radius
// (just outside the label, well inside the disc edge) and return the median
// RGB of saturated, non-background pixels. Bypasses expectedColors entirely —
// the user told us this image *is* the right color, whatever it is.
export async function sampleOverrideShade(
  url: string,
  expectedColors?: ColorRGB[] | null,
): Promise<ColorRGB | null> {
  // Use real disc detection so the sample ring tracks the actual vinyl body,
  // not a fixed proportion of the image frame. Works for off-center or
  // partially-out-of-frame override images.
  const detected = await detectDiscInOverride(url, expectedColors);
  if (!detected) return null;

  const SZ_MAX = 100;
  let data: Buffer;
  let info: { width: number; height: number; channels: number };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const out = await sharp(buf)
      .resize(SZ_MAX, SZ_MAX, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    info = out.info;
  } catch {
    return null;
  }

  const W = info.width;
  const H = info.height;
  const SHORT = Math.min(W, H);

  // Ring inside the detected disc: 55–85% of disc radius covers the vinyl
  // body, well outside the center label. detected.cx/cy/radius are fractions
  // of (width, height, short-side) so they translate cleanly to this buffer's
  // proportional pixel dimensions.
  const cx = detected.cx * W;
  const cy = detected.cy * H;
  const discR = detected.radius * SHORT;
  const rMin = discR * 0.55;
  const rMax = discR * 0.85;
  const rMinSq = rMin * rMin;
  const rMaxSq = rMax * rMax;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < rMinSq || d2 > rMaxSq) continue;
      const i = (y * W + x) * info.channels;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  if (rs.length < 40) return null;
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

const BLOB_SAMPLE = 100;

// Connected-component blob detection. For colored vinyls, find the largest
// contiguous blob of expected-color pixels in each image. If it's vinyl-shaped
// (roughly square bbox, centered, fills its bbox well, occupies ≥12% of the
// image), accept. Naturally rejects:
//   - label close-ups (label is a different color, so the colored blob is only
//     a thin ring around the label → low fill ratio, OR no blob at all)
//   - liner notes / back covers / inserts (scattered colored elements, not a
//     single connected disc)
//   - covers with the color as artwork (off-center or wrong shape)
async function findColoredBlob(url: string, expected: ColorRGB[]): Promise<VinylShot | null> {
  const dbg = (_msg: string) => {};
  let meta: { width?: number; height?: number };
  let data: Buffer;
  let info: { width: number; height: number; channels: number };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf);
    meta = await img.metadata();
    const out = await img
      .resize(BLOB_SAMPLE, BLOB_SAMPLE, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    info = out.info;
  } catch {
    return null;
  }

  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight) return null;
  const SZ = BLOB_SAMPLE;

  // Build pixel mask: 1 if pixel matches any expected color (hue + variants)
  const mask = new Uint8Array(SZ * SZ);
  for (let y = 0; y < SZ; y++) {
    for (let x = 0; x < SZ; x++) {
      const i = (y * info.width + x) * info.channels;
      const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (pixelMatchesExpected(px, expected)) {
        mask[y * SZ + x] = 1;
      }
    }
  }

  // Find ALL connected components, track the largest
  const visited = new Uint8Array(SZ * SZ);
  let bestCount = 0;
  let bestMinX = 0,
    bestMaxX = 0,
    bestMinY = 0,
    bestMaxY = 0,
    bestSumX = 0,
    bestSumY = 0;

  for (let yi = 0; yi < SZ; yi++) {
    for (let xi = 0; xi < SZ; xi++) {
      const startIdx = yi * SZ + xi;
      if (!mask[startIdx] || visited[startIdx]) continue;

      // BFS flood-fill
      const stack: number[] = [startIdx];
      visited[startIdx] = 1;
      let count = 0;
      let minX = xi,
        maxX = xi,
        minY = yi,
        maxY = yi,
        sumX = 0,
        sumY = 0;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const cx = idx % SZ;
        const cy = (idx - cx) / SZ;
        count++;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        if (cx > 0) {
          const n = idx - 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (cx < SZ - 1) {
          const n = idx + 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (cy > 0) {
          const n = idx - SZ;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
        if (cy < SZ - 1) {
          const n = idx + SZ;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }

      if (count > bestCount) {
        bestCount = count;
        bestMinX = minX;
        bestMaxX = maxX;
        bestMinY = minY;
        bestMaxY = maxY;
        bestSumX = sumX;
        bestSumY = sumY;
      }
    }
  }

  // Must occupy ≥12% of image (smaller = scattered text or sparse matches)
  const totalPixels = SZ * SZ;
  if (bestCount < totalPixels * 0.12) return null;

  const bbW = bestMaxX - bestMinX + 1;
  const bbH = bestMaxY - bestMinY + 1;
  if (bbW < SZ * 0.30 || bbH < SZ * 0.30) {
    dbg(`bbox too small ${bbW}x${bbH}`);
    return null;
  }

  // Roughly square bbox = disc shape
  const aspect = bbW / bbH;
  if (aspect < 0.75 || aspect > 1.33) {
    dbg(`aspect ${aspect.toFixed(2)}`);
    return null;
  }

  // Fill ratio against the bbox: solid disc fills ~78% (π/4). Tight crops
  // where the vinyl extends past the frame and the sleeve interrupts at the
  // cardinal edges give much lower ratios (0.20-0.40), so we allow loose
  // fills as long as the blob is mostly contiguous and centered.
  const fillRatio = bestCount / (bbW * bbH);
  // Note: high fillRatio is OK now. A disc on a same-hue surface (gold vinyl
  // on wood) produces a near-full bbox because the hue-matcher includes both.
  // Corner-vs-body distance check downstream distinguishes vinyl-on-bg from
  // uniformly-colored images.
  if (fillRatio < 0.22) {
    dbg(`fillRatio ${fillRatio.toFixed(2)}`);
    return null;
  }

  // Roughly centered
  const bbCx = (bestMinX + bestMaxX) / 2;
  const bbCy = (bestMinY + bestMaxY) / 2;
  const drift = Math.max(Math.abs(bbCx - SZ / 2), Math.abs(bbCy - SZ / 2));
  if (drift > SZ * 0.22) {
    dbg(`drift ${drift.toFixed(1)}`);
    return null;
  }

  // Disc-shape check: walk outward from blob center at 24 angles, find the
  // outermost mask pixel. For a real vinyl, these radii cluster tightly
  // (smooth circle). For cover art that happens to have matching pixels
  // forming a rough bbox, the radii vary widely.
  const shapeAngles = 24;
  const shapeRadii: number[] = [];
  for (let a = 0; a < shapeAngles; a++) {
    const ang = (a / shapeAngles) * 2 * Math.PI;
    const acos = Math.cos(ang);
    const asin = Math.sin(ang);
    let maxR = 0;
    for (let r = 1; r < SZ / 2; r++) {
      const x = Math.round(bbCx + r * acos);
      const y = Math.round(bbCy + r * asin);
      if (x < 0 || x >= SZ || y < 0 || y >= SZ) break;
      if (mask[y * SZ + x]) maxR = r;
    }
    if (maxR > 0) shapeRadii.push(maxR);
  }
  if (shapeRadii.length < shapeAngles * 0.85) {
    dbg(`shapeRadii ${shapeRadii.length}`);
    return null;
  }
  const sortedShape = [...shapeRadii].sort((a, b) => a - b);
  const shapeP10 = sortedShape[Math.floor(sortedShape.length * 0.1)];
  const shapeP90 = sortedShape[Math.floor(sortedShape.length * 0.9)];
  if (shapeP90 / shapeP10 > 1.30) {
    dbg(`shape p90/p10 ${(shapeP90/shapeP10).toFixed(2)}`);
    return null;
  }

  const radius = sortedShape[Math.floor(sortedShape.length / 2)];

  // Body-color verification: the disc body (between label and outer edge)
  // must be mostly the expected vinyl color, AND uniform enough to look
  // like a vinyl body (not a cover image with mixed content).
  const bodyR1 = radius * 0.55;
  const bodyR2 = radius * 0.78;
  const bodySamples: RGB[] = [];
  let bodyMatchCount = 0;
  for (const sampleR of [bodyR1, bodyR2]) {
    for (let ai = 0; ai < 12; ai++) {
      const ang = (ai / 12) * 2 * Math.PI;
      const x = Math.round(bbCx + sampleR * Math.cos(ang));
      const y = Math.round(bbCy + sampleR * Math.sin(ang));
      if (x < 0 || x >= SZ || y < 0 || y >= SZ) continue;
      const i = (y * info.width + x) * info.channels;
      const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
      bodySamples.push(px);
      if (pixelMatchesExpected(px, expected)) bodyMatchCount++;
    }
  }
  if (bodySamples.length < 18) {
    dbg(`bodySamples ${bodySamples.length}`);
    return null;
  }
  if (bodyMatchCount / bodySamples.length < 0.75) {
    dbg(`bodyMatch ${bodyMatchCount}/${bodySamples.length}`);
    return null;
  }

  // Body uniformity: a real vinyl body has at most ~3 distinct color regions
  // (solid, marbled). Cover art has many different colors at body radius.
  // Compute median per channel, count how many samples are within 70 of it.
  const sortedR = [...bodySamples].map((s) => s.r).sort((a, b) => a - b);
  const sortedG = [...bodySamples].map((s) => s.g).sort((a, b) => a - b);
  const sortedB = [...bodySamples].map((s) => s.b).sort((a, b) => a - b);
  const mid = Math.floor(bodySamples.length / 2);
  const medianColor: RGB = {
    r: sortedR[mid],
    g: sortedG[mid],
    b: sortedB[mid],
  };
  let nearMedian = 0;
  for (const s of bodySamples) {
    if (dist(s, medianColor) < 75) nearMedian++;
  }
  if (nearMedian / bodySamples.length < 0.55) {
    dbg(`bodyUniformity ${nearMedian}/${bodySamples.length}`);
    return null;
  }

  // Also: the center color (label) should differ from the body samples.
  // If center ~ body, it's a uniform image (label close-up or art piece).
  const cxi = Math.round(bbCx);
  const cyi = Math.round(bbCy);
  let lr = 0,
    lg = 0,
    lb = 0,
    lc = 0;
  for (let yy = cyi - 3; yy < cyi + 3; yy++) {
    for (let xx = cxi - 3; xx < cxi + 3; xx++) {
      if (xx < 0 || xx >= SZ || yy < 0 || yy >= SZ) continue;
      const i = (yy * info.width + xx) * info.channels;
      lr += data[i];
      lg += data[i + 1];
      lb += data[i + 2];
      lc++;
    }
  }
  if (lc < 20) return null;
  const labelColor = { r: lr / lc, g: lg / lc, b: lb / lc };
  // Compute mean body color for comparison
  // Center color must differ from body mean (rules out uniform images / label-only)
  const bodyMean: RGB = {
    r: bodySamples.reduce((a, s) => a + s.r, 0) / bodySamples.length,
    g: bodySamples.reduce((a, s) => a + s.g, 0) / bodySamples.length,
    b: bodySamples.reduce((a, s) => a + s.b, 0) / bodySamples.length,
  };
  if (dist(labelColor, bodyMean) < 28) {
    dbg(`label-body dist ${dist(labelColor, bodyMean).toFixed(1)}`);
    return null;
  }

  // The image corners must be visibly DIFFERENT from the vinyl body. Real
  // vinyl photos have a distinct background (table, sleeve, sheet) around
  // the disc. A uniformly-tinted image (back cover with vinyl-colored bg)
  // has corners that match the body color → reject.
  // Use sampled bg color (mean of 8×8 patches at all 4 image corners) and
  // compare to the body mean we already computed.
  const cornerSample = (cx: number, cy: number): RGB => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let yy = cy; yy < cy + 8; yy++) {
      for (let xx = cx; xx < cx + 8; xx++) {
        const i = (yy * info.width + xx) * info.channels;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
    return { r: r / n, g: g / n, b: b / n };
  };
  const cornerMean: RGB = {
    r: 0,
    g: 0,
    b: 0,
  };
  for (const [cx, cy] of [
    [0, 0],
    [SZ - 8, 0],
    [0, SZ - 8],
    [SZ - 8, SZ - 8],
  ]) {
    const c = cornerSample(cx, cy);
    cornerMean.r += c.r / 4;
    cornerMean.g += c.g / 4;
    cornerMean.b += c.b / 4;
  }
  const cornerBodyDist = dist(cornerMean, bodyMean);
  if (cornerBodyDist < 25) {
    dbg(`corner-body dist ${cornerBodyDist.toFixed(1)}`);
    return null;
  }
  dbg(`PASSED, cornerBodyDist=${cornerBodyDist.toFixed(0)}`);

  return {
    url,
    sourceWidth,
    sourceHeight,
    cx: bbCx / SZ,
    cy: bbCy / SZ,
    radius: (radius * 0.96) / SZ,
    // Score weights: matching pixel count (size) × fill ratio (density) ×
    // corner-body separation (boosts real-vinyl-on-distinct-bg over
    // uniformly-colored inserts). Real vinyl shots win on bg separation.
    score: bestCount * fillRatio * Math.min(2.5, cornerBodyDist / 50),
    ringColor: { r: 0, g: 0, b: 0 },
  };
}

// Dead-simple color-presence scan: count pixels matching the expected color
// in each candidate image, pick the image with the most. No geometric checks,
// no disc-shape detection. Logic-based: "the album says PINK; find the photo
// with the most pink." Returns the matching pixels' bounding region so the
// processor can crop to the colored area.
async function colorPresence(
  url: string,
  expected: ColorRGB[],
): Promise<{
  url: string;
  sourceWidth: number;
  sourceHeight: number;
  matchCount: number;
  matchRatio: number;
  strongMatches: number;
  cx: number;
  cy: number;
  radius: number;
} | null> {
  const SZ = 100;
  let meta: { width?: number; height?: number };
  let data: Buffer;
  let info: { width: number; height: number; channels: number };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf);
    meta = await img.metadata();
    const out = await img
      .resize(SZ, SZ, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = out.data;
    info = out.info;
  } catch {
    return null;
  }
  const sourceWidth = meta.width ?? 0;
  const sourceHeight = meta.height ?? 0;
  if (!sourceWidth || !sourceHeight) return null;

  // Walk every pixel; sum SQUARED quality. Squaring heavily biases the score
  // toward strong matches — a real vinyl pixel (q=0.85) contributes 0.72 while
  // an incidentally-warm-toned background pixel (q=0.10) contributes 0.01. This
  // is the core fix for "image with no yellow scoring higher than the actual
  // yellow vinyl photo": thousands of weakly-tinted background pixels can no
  // longer dogpile to outweigh a few hundred bright vinyl pixels.
  let qualitySum = 0;
  let strongMatches = 0;
  let sumX = 0,
    sumY = 0,
    strongCount = 0;
  for (let y = 0; y < SZ; y++) {
    for (let x = 0; x < SZ; x++) {
      const i = (y * info.width + x) * info.channels;
      const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
      const q = pixelMatchQuality(px, expected);
      if (q > 0.1) {
        qualitySum += q * q;
        if (q > 0.5) {
          sumX += x;
          sumY += y;
          strongCount++;
          strongMatches++;
        }
      }
    }
  }
  if (qualitySum < 2) return null;

  // Corner-color penalty: if the expected color appears at 3+ corners, the
  // image's BACKGROUND is that color (printed insert, colored label sheet,
  // cover with color as theme). A real vinyl photo has a distinct background
  // — sleeve, table, sheet — that does NOT match the vinyl color. Heavily
  // downweight these so they can't out-score real vinyl shots.
  const cornerSize = 6;
  const cornerCoords: Array<[number, number]> = [
    [0, 0],
    [SZ - cornerSize, 0],
    [0, SZ - cornerSize],
    [SZ - cornerSize, SZ - cornerSize],
  ];
  let cornerMatchCount = 0;
  for (const [cx0, cy0] of cornerCoords) {
    let cr = 0,
      cg = 0,
      cb = 0,
      cn = 0;
    for (let yy = cy0; yy < cy0 + cornerSize; yy++) {
      for (let xx = cx0; xx < cx0 + cornerSize; xx++) {
        const i = (yy * info.width + xx) * info.channels;
        cr += data[i];
        cg += data[i + 1];
        cb += data[i + 2];
        cn++;
      }
    }
    const cornerPx = { r: cr / cn, g: cg / cn, b: cb / cn };
    if (pixelMatchQuality(cornerPx, expected) > 0.4) cornerMatchCount++;
  }
  if (cornerMatchCount >= 3) {
    qualitySum *= 0.25; // bg-is-the-color case — heavy penalty
  } else if (cornerMatchCount === 2) {
    qualitySum *= 0.6;
  }

  // Compute center of mass from STRONG matches if we have any, else fall back
  // to image center.
  const cx = strongCount > 0 ? sumX / strongCount : SZ / 2;
  const cy = strongCount > 0 ? sumY / strongCount : SZ / 2;

  // Radius covering 80% of strong matches.
  let r80 = SZ / 3;
  if (strongCount >= 20) {
    const dists: number[] = [];
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        const i = (y * info.width + x) * info.channels;
        const q = pixelMatchQuality(
          { r: data[i], g: data[i + 1], b: data[i + 2] },
          expected,
        );
        if (q > 0.5) {
          dists.push(Math.sqrt((x - cx) ** 2 + (y - cy) ** 2));
        }
      }
    }
    dists.sort((a, b) => a - b);
    r80 = dists[Math.floor(dists.length * 0.8)] || SZ / 3;
  }

  return {
    url,
    sourceWidth,
    sourceHeight,
    matchCount: Math.round(qualitySum),
    matchRatio: qualitySum / (SZ * SZ),
    strongMatches,
    cx: cx / SZ,
    cy: cy / SZ,
    radius: r80 / SZ,
  };
}

export async function findVinylShot(
  urls: string[],
  _ringCheckColors: ColorRGB[],
  explicitColors?: ColorRGB[] | null,
): Promise<VinylShot | null> {
  // Black vinyls (no explicit color) render as flat SVG — no photo.
  if (!explicitColors || explicitColors.length === 0) return null;

  // For every secondary image, count pixels matching the expected color.
  // The image with the most matching pixels wins. Simple.
  const results = await Promise.all(urls.map((u) => colorPresence(u, explicitColors)));

  let best: typeof results[number] | null = null;
  for (const r of results) {
    if (!r) continue;
    if (!best || r.matchCount > best.matchCount) best = r;
  }

  // Require enough squared-quality mass — guards against picking a photo with
  // no real color content. Scale matches the new q² summation (a few hundred
  // strong matches is the floor for "real vinyl shot present").
  if (!best || best.matchRatio < 0.015) return null;

  return {
    url: best.url,
    sourceWidth: best.sourceWidth,
    sourceHeight: best.sourceHeight,
    cx: best.cx,
    cy: best.cy,
    radius: best.radius,
    score: best.matchCount,
    ringColor: { r: 0, g: 0, b: 0 },
  };
}
