/**
 * Generate every raster brand asset from the चौक mark.
 *
 * Run manually and COMMIT the output:
 *
 *   npm run icons
 *
 * WHY IT WORKS THIS WAY
 *
 * The obvious approach — `next/og` + `ImageResponse` — does not work for this
 * brand. Its renderer (satori) has no system fonts and needs an explicitly
 * supplied TTF/OTF/WOFF; `next/font` downloads WOFF2, which satori cannot parse.
 * So a Devanagari OG image would mean committing a ~300 KB TTF and wiring a
 * build-time font load.
 *
 * Generating locally with sharp and committing the PNGs avoids all of it: the
 * Amplify build container never needs a Devanagari font because it only ever
 * serves finished binaries. sharp is already resolvable here — Next declares it
 * as an optional dependency and package.json pins it to 0.35.3 in `overrides`
 * for the libvips CVEs — so this adds no dependency at all.
 *
 * Colours are imported from src/lib/design/brand.ts, which derives them from the
 * same OKLCH tokens as globals.css. Never hardcode a hex in here.
 *
 * KNOWN COMPROMISE: the wordmark in the OG image renders in a system Devanagari
 * face (Devanagari Sangam MN), not the site's Noto Serif Devanagari, which is not
 * installed as a system font. Visually close and dependency-free. For exact
 * fidelity, commit the Noto TTF and name it in WORDMARK_FONT below.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { ACCENT_HEX, BG_LIGHT_HEX, BRAND_HEX, MARK_FG_HEX } from '../src/lib/design/brand'

const ROOT = process.cwd()
const WORDMARK_FONT = 'Devanagari Sangam MN, Noto Serif Devanagari, serif'

/**
 * The mark itself, as SVG source.
 *
 * Must stay identical to src/components/site/logo.tsx — same viewBox, same
 * geometry, same fills — or the favicon and the in-app logo drift apart.
 * `inset` shrinks the roads for the maskable variant, where Android crops a
 * circle out of the middle and anything near the edge is lost.
 */
function markSvg(size: number, { padded = false }: { padded?: boolean } = {}): string {
  // A maskable icon must keep its content inside the middle 80% "safe zone".
  const scale = padded ? 0.62 : 1
  const offset = (64 - 64 * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" ${padded ? '' : 'rx="14"'} fill="${BRAND_HEX}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <g fill="${MARK_FG_HEX}">
      <rect x="27" y="4" width="10" height="56" rx="1"/>
      <rect x="4" y="27" width="56" height="10" rx="1"/>
    </g>
    <circle cx="32" cy="32" r="7.5" fill="${ACCENT_HEX}"/>
  </g>
</svg>`
}

/**
 * 1200x630 share card: mark, wordmark, tagline, accent rule.
 *
 * The roads are drawn straight onto the navy field with no rounded plate behind
 * them. A translucent plate reads as an unintended artefact at this size, and
 * the card already IS the navy ground the icon's plate provides.
 *
 * Vertical rhythm is set so nothing collides: mark occupies 150–350, the
 * wordmark's cap height sits under 440, the tagline under 500, and the accent
 * rule owns the last 12px. Devanagari needs the generous gap — matras sit above
 * the headline stroke and descenders below it, so a Latin-tuned leading clips.
 */
function ogSvg(): string {
  const MARK = 200
  const scale = MARK / 64
  const x = (1200 - MARK) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BRAND_HEX}"/>
  <g transform="translate(${x} 150) scale(${scale})">
    <g fill="${MARK_FG_HEX}">
      <rect x="27" y="4" width="10" height="56" rx="1"/>
      <rect x="4" y="27" width="56" height="10" rx="1"/>
    </g>
    <circle cx="32" cy="32" r="7.5" fill="${ACCENT_HEX}"/>
  </g>
  <text x="600" y="440" text-anchor="middle" font-family="${WORDMARK_FONT}"
        font-size="78" font-weight="700" fill="${MARK_FG_HEX}">राज चौक</text>
  <text x="600" y="510" text-anchor="middle" font-family="${WORDMARK_FONT}"
        font-size="32" fill="${MARK_FG_HEX}" fill-opacity="0.82">खबर, विश्लेषण और आपकी राय</text>
  <rect x="0" y="618" width="1200" height="12" fill="${ACCENT_HEX}"/>
</svg>`
}

/**
 * Google wants a wide publisher logo for NewsMediaOrganization, on a light
 * ground so it composites cleanly into search surfaces. Sized to the content —
 * trailing whitespace inside the image gets treated as part of the logo and
 * makes the mark render smaller than it should everywhere it is used.
 */
function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="120" viewBox="0 0 420 120">
  <rect width="420" height="120" fill="${BG_LIGHT_HEX}"/>
  <g transform="translate(24 28)">
    <rect width="64" height="64" rx="14" fill="${BRAND_HEX}"/>
    <g fill="${MARK_FG_HEX}">
      <rect x="27" y="4" width="10" height="56" rx="1"/>
      <rect x="4" y="27" width="56" height="10" rx="1"/>
    </g>
    <circle cx="32" cy="32" r="7.5" fill="${ACCENT_HEX}"/>
  </g>
  <text x="104" y="78" font-family="${WORDMARK_FONT}" font-size="50" font-weight="700"
        fill="${BRAND_HEX}">राज चौक</text>
</svg>`
}

async function writePng(svg: string, relPath: string, opaqueOver?: string) {
  const out = join(ROOT, relPath)
  await mkdir(dirname(out), { recursive: true })
  let pipeline = sharp(Buffer.from(svg))
  // iOS ignores transparency on apple-icon and composites it onto black, so it
  // has to be flattened onto the brand colour rather than left with an alpha.
  if (opaqueOver) pipeline = pipeline.flatten({ background: opaqueOver })
  await pipeline.png({ compressionLevel: 9 }).toFile(out)
  console.log('  wrote', relPath)
}

async function main() {
  console.log('Generating brand assets from the चौक mark…')

  // Scalable primary icon. Next serves src/app/icon.svg by file convention.
  await mkdir(join(ROOT, 'src/app'), { recursive: true })
  await writeFile(join(ROOT, 'src/app/icon.svg'), markSvg(64), 'utf8')
  console.log('  wrote src/app/icon.svg')

  // Raster fallback, for browsers that do not take an SVG favicon. The numbered
  // suffix is Next's documented convention for a SECOND icon of the same kind:
  // with both named `icon`, Next links only one of them and the SVG silently
  // became a route nothing pointed at. No .ico — sharp cannot write one, and
  // these two cover every browser that is not IE.
  await writePng(markSvg(192), 'src/app/icon1.png')
  await writePng(markSvg(180), 'src/app/apple-icon.png', BRAND_HEX)

  // PWA install icons. The maskable variant is padded into the safe zone.
  await writePng(markSvg(192), 'public/icon-192.png')
  await writePng(markSvg(512), 'public/icon-512.png')
  await writePng(markSvg(512, { padded: true }), 'public/icon-maskable-512.png')

  // Share card, and the publisher logo that src/lib/seo/jsonld.ts already
  // advertises at /logo.png and that has been 404ing since the first commit.
  await writePng(ogSvg(), 'src/app/opengraph-image.png')
  await writePng(logoSvg(), 'public/logo.png')

  await writeFile(
    join(ROOT, 'src/app/opengraph-image.alt.txt'),
    'राज चौक — खबर, विश्लेषण और आपकी राय',
    'utf8',
  )
  console.log('  wrote src/app/opengraph-image.alt.txt')
  console.log('Done. Commit the generated files.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
