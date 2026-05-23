import sharp from "sharp";
import type { VinylShot } from "./vinyl-image";
import type { RGB as ColorRGB } from "./vinyl-color";

const cache = new Map<string, Buffer>();
const CACHE_V = 13;
const TARGET = 500;
const OUTPUT = 500;

type RGB = { r: number; g: number; b: number };

function rgbDist(a: RGB, b: RGB) {
  return Math.sqrt(
    (a.r - b.r) * (a.r - b.r) +
      (a.g - b.g) * (a.g - b.g) +
      (a.b - b.b) * (a.b - b.b),
  );
}

function sampleArea(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
  w: number,
  h: number,
): RGB {
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
  return { r: r / n, g: g / n, b: b / n };
}

// Crops to a tight square around the detected vinyl, then makes both:
//   (a) pixels outside the disc circle
//   (b) pixels matching the photo's own background colors (sampled from corners)
// transparent. Hard edges throughout (no blur). Output PNG with alpha.
export async function processVinylImage(
  shot: VinylShot,
  expectedColors?: ColorRGB[] | null,
): Promise<Buffer | null> {
  const expectedKey = expectedColors
    ? expectedColors.map((c) => `${c.r},${c.g},${c.b}`).join(";")
    : "none";
  const cacheKey = `v${CACHE_V}|${shot.url}|${shot.cx.toFixed(3)}|${shot.cy.toFixed(3)}|${shot.radius.toFixed(3)}|${expectedKey}|p${shot.partialColor ? "1" : "0"}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(shot.url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());

    const shortSide = Math.min(shot.sourceWidth, shot.sourceHeight);
    const vinylRadiusPx = shot.radius * shortSide;
    const cxPx = shot.cx * shot.sourceWidth;
    const cyPx = shot.cy * shot.sourceHeight;

    // Crop with ~20% padding around the vinyl so corner samples land
    // safely in the photo's background, well clear of the vinyl edge.
    const cropRadius = vinylRadiusPx * 1.20;
    const safeRadius = Math.min(
      cropRadius,
      cxPx,
      cyPx,
      shot.sourceWidth - cxPx,
      shot.sourceHeight - cyPx,
    );
    const cropSize = Math.max(2, Math.round(safeRadius * 2));
    const cropX = Math.round(cxPx - safeRadius);
    const cropY = Math.round(cyPx - safeRadius);

    const { data: rgb, info } = await sharp(buf)
      .extract({ left: cropX, top: cropY, width: cropSize, height: cropSize })
      .resize(TARGET, TARGET)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Only sample the 4 image corners — with 20% crop padding, these are far
    // outside the vinyl boundary and represent the photo's true backgrounds.
    // Allow multiple distinct bg clusters (Birdie has sleeve + sheet, etc.)
    const C = 26;
    const samples: RGB[] = [
      sampleArea(rgb, info.width, info.channels, 0, 0, C, C),
      sampleArea(rgb, info.width, info.channels, TARGET - C, 0, C, C),
      sampleArea(rgb, info.width, info.channels, 0, TARGET - C, C, C),
      sampleArea(rgb, info.width, info.channels, TARGET - C, TARGET - C, C, C),
    ];
    // Cluster corners that look alike and TRACK HOW MANY agree. A single
    // isolated corner is not a reliable background — it's almost always the
    // vinyl bleeding into the corner of the frame (Mac Miller's blue disc
    // reaching the top-left corner, etc.). Only colors with ≥2 corners in
    // agreement get treated as actual background.
    const cornerClusters: Array<{ color: RGB; count: number }> = [];
    for (const s of samples) {
      const existing = cornerClusters.find((c) => rgbDist(c.color, s) < 40);
      if (existing) {
        existing.color = {
          r: (existing.color.r * existing.count + s.r) / (existing.count + 1),
          g: (existing.color.g * existing.count + s.g) / (existing.count + 1),
          b: (existing.color.b * existing.count + s.b) / (existing.count + 1),
        };
        existing.count++;
      } else {
        cornerClusters.push({ color: { ...s }, count: 1 });
      }
    }
    const agreedClusters: RGB[] = cornerClusters
      .filter((c) => c.count >= 2)
      .map((c) => c.color);

    // For tier-3 (partial color region) shots, skip bg color keying entirely —
    // the "bg" is just other parts of the source image (not the vinyl's actual
    // background), so keying it would erase useful color content.
    const bgClusters = shot.partialColor
      ? []
      : agreedClusters.filter((bg) => {
          const lightness = (bg.r + bg.g + bg.b) / (3 * 255);
          if (lightness < 0.18) return false;
          if (!expectedColors || expectedColors.length === 0) return true;
          return !expectedColors.some((exp) => rgbDist(bg, exp) < 70);
        });

    // Hard outer circular mask. Slight extra shrink (×0.96) to handle minor
    // detection overshoot — anything past this radius is guaranteed transparent.
    const vinylInCropRatio = Math.min(1, vinylRadiusPx / safeRadius);
    const hardRadius = (TARGET / 2) * vinylInCropRatio * 0.96;
    const hardRadiusSq = hardRadius * hardRadius;
    // bg-keying only runs in the OUTER 10% of the disc (the rim band where
    // edge halos appear). The inner 90% of the disc is preserved as-is — for
    // pale/pastel vinyls, photo lighting often makes the disc body look bg-
    // colored, and keying it would erase the vinyl itself (Swamp Dogg's Baby
    // Pink on a cream sleeve was the canonical case).
    const innerSafeRadius = hardRadius * 0.90;
    const innerSafeRadiusSq = innerSafeRadius * innerSafeRadius;
    const cx = TARGET / 2;
    const cy = TARGET / 2;

    const out = Buffer.alloc(TARGET * TARGET * 4);
    const KEY_HARD = 30;
    const KEY_SOFT = 55;

    for (let y = 0; y < TARGET; y++) {
      for (let x = 0; x < TARGET; x++) {
        const ri = (y * info.width + x) * info.channels;
        const oi = (y * TARGET + x) * 4;
        const r = rgb[ri],
          g = rgb[ri + 1],
          b = rgb[ri + 2];

        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;

        if (d2 > hardRadiusSq) {
          out[oi + 3] = 0;
          continue;
        }

        let alpha = 255;

        // Only run bg-keying in the rim band (between innerSafeRadius and
        // hardRadius). The disc interior is preserved verbatim.
        if (d2 > innerSafeRadiusSq) {
          // Pixel chroma (max channel − min channel). A desaturated pixel has
          // low chroma; a saturated/colored pixel has high chroma. Guards
          // against the RGB-distance heuristic misfiring at the rim, where
          // a pastel-edge pixel might be RGB-close to a near-white bg.
          const pxChroma = Math.max(r, g, b) - Math.min(r, g, b);

          let closest = Infinity;
          for (const bg of bgClusters) {
            const bgChroma =
              Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
            if (Math.abs(pxChroma - bgChroma) > 25) continue;
            const d = rgbDist({ r, g, b }, bg);
            if (d < closest) closest = d;
          }
          if (closest < KEY_HARD) alpha = 0;
          else if (closest < KEY_SOFT) {
            alpha = Math.round(
              ((closest - KEY_HARD) / (KEY_SOFT - KEY_HARD)) * 255,
            );
          }
        }

        out[oi] = r;
        out[oi + 1] = g;
        out[oi + 2] = b;
        out[oi + 3] = alpha;
      }
    }

    // Quick sanity check that we have any opaque pixels at all.
    let anyOpaque = false;
    for (let i = 3; i < out.length; i += 4) {
      if (out[i] > 80) {
        anyOpaque = true;
        break;
      }
    }
    if (!anyOpaque) return null;

    // Crop the output to a square tight to the KNOWN disc geometry. The disc
    // center is at (TARGET/2, TARGET/2) because the extract step was centered
    // on the detected (cxPx, cyPx) and the result resized to TARGET×TARGET —
    // so the disc center always lands at the buffer's geometric center.
    // We crop a square of side hardRadius*2 (+2px margin) around that center.
    //
    // Previously we trimmed to the bbox of opaque pixels, but asymmetric
    // rim-keying could push the bbox off-center, producing a visually
    // off-center disc. Using the known disc center guarantees symmetry.
    const cropHalf = Math.round(hardRadius) + 2;
    const cropL = Math.max(0, Math.round(TARGET / 2 - cropHalf));
    const cropT = Math.max(0, Math.round(TARGET / 2 - cropHalf));
    const cropR = Math.min(TARGET, Math.round(TARGET / 2 + cropHalf));
    const cropB = Math.min(TARGET, Math.round(TARGET / 2 + cropHalf));
    const cropW = cropR - cropL;
    const cropH = cropB - cropT;
    const finalSize = Math.min(cropW, cropH);

    const tight = Buffer.alloc(finalSize * finalSize * 4);
    for (let y = 0; y < finalSize; y++) {
      for (let x = 0; x < finalSize; x++) {
        const si = ((cropT + y) * TARGET + (cropL + x)) * 4;
        const di = (y * finalSize + x) * 4;
        tight[di] = out[si];
        tight[di + 1] = out[si + 1];
        tight[di + 2] = out[si + 2];
        tight[di + 3] = out[si + 3];
      }
    }

    const result = await sharp(tight, {
      raw: { width: finalSize, height: finalSize, channels: 4 },
    })
      .resize(OUTPUT, OUTPUT)
      .png({ compressionLevel: 9 })
      .toBuffer();

    cache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}
