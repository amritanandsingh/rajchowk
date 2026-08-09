/**
 * Compare the observable HTTP contract of two deployed environments.
 *
 * Why this exists
 * ---------------
 * `npm run test:integration` and `npm run verify:backend` can never run against
 * production — amplify/backend.ts withholds ALLOW_ADMIN_USER_PASSWORD_AUTH from
 * main/production, so there is no way to mint role tokens there. That leaves a
 * permanent hole in "does main behave like the branch I tested?".
 *
 * This closes it from the outside. Everything asserted here is visible to an
 * anonymous HTTP client, so it works identically against localhost, a preview
 * branch and production, and it needs no AWS credentials at all.
 *
 * Two kinds of check
 * ------------------
 *   ABSOLUTE   — must hold in every environment independently (security headers
 *                present, CSP free of 'unsafe-eval', sitemaps well formed).
 *   COMPARATIVE — must be IDENTICAL between the two environments (status codes,
 *                header values). Divergence here is the thing we are hunting.
 *
 * A small allowlist covers differences that are correct by design: the origin
 * itself, and the robots policy (a non-production branch must emit Disallow: /,
 * production must not — see src/app/robots.ts).
 *
 * Usage
 * -----
 *   npm run verify:parity -- <urlA> <urlB>   # compare two environments
 *   npm run verify:parity -- <url>           # audit one (absolute checks only)
 */

/** Paths probed in every environment. Chrome only — never content-dependent. */
const PATHS = [
  '/',
  '/latest',
  '/opinion',
  '/janmat',
  '/ask',
  '/promises',
  '/live',
  '/videos',
  '/search',
  '/about',
  '/contact',
  '/editorial-policy',
  '/corrections-policy',
  '/auth/sign-in',
  '/auth/sign-up',
  '/account',
  '/admin',
  '/feed.xml',
  '/sitemap.xml',
  '/news-sitemap.xml',
  '/robots.txt',
  '/manifest.webmanifest',
  '/this-route-does-not-exist-parity-probe',
] as const

/**
 * Headers compared byte-for-byte between environments. Sourced from
 * SECURITY_HEADERS in next.config.ts — if that list changes, this one must too.
 */
const COMPARED_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'strict-transport-security',
  'cross-origin-opener-policy',
  'x-dns-prefetch-control',
  'x-robots-tag',
] as const

/** Present on every response, per `source: '/:path*'` in next.config.ts. */
const REQUIRED_ON_EVERY_PATH = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
] as const

/** Paths whose robots policy legitimately differs between staging and prod. */
const ROBOTS_SENSITIVE = new Set<string>(['/robots.txt'])

const XML_ROOTS: Record<string, string> = {
  '/feed.xml': 'rss',
  '/sitemap.xml': 'urlset',
  '/news-sitemap.xml': 'urlset',
}

type Probe = {
  path: string
  status: number
  /** Origin actually serving the response, after any redirect (apex → www). */
  origin: string
  redirected: boolean
  headers: Record<string, string>
  canonical: string | null
  bodyMarkers: string[]
}

type EnvReport = {
  base: string
  probes: Map<string, Probe>
  failures: string[]
  warnings: string[]
}

const CANONICAL_RE = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i

function normalizeBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(`Base URL must be absolute and include a scheme: ${raw}`)
  }
  return trimmed
}

async function probe(base: string, path: string): Promise<Probe> {
  // Follow redirects. An earlier version used `redirect: 'manual'` to make slug
  // redirects visible, but production apex-redirects to www at the load
  // balancer, so every probe measured a bare 301 — no security headers, no body
  // — and the run reported ~45 false failures. The redirect itself is still
  // recorded below and compared, so nothing is hidden by following it.
  const response = await fetch(`${base}${path}`, {
    redirect: 'follow',
    headers: { 'user-agent': 'rajchowk-verify-parity' },
  })

  const headers: Record<string, string> = {}
  for (const name of COMPARED_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = value
  }

  const contentType = response.headers.get('content-type') ?? ''
  const isTextual = /text\/|xml|json|javascript/.test(contentType)
  const body = isTextual ? await response.text() : ''

  const markers: string[] = []
  if (body.includes('पृष्ठ नहीं मिला')) markers.push('branded-404')
  if (/^\s*Disallow:\s*\/\s*$/m.test(body)) markers.push('robots-disallow-all')
  if (/^\s*Allow:/m.test(body)) markers.push('robots-has-allow')

  const expectedRoot = XML_ROOTS[path]
  if (expectedRoot) {
    markers.push(new RegExp(`<${expectedRoot}[\\s>]`).test(body) ? 'xml-ok' : 'xml-BAD')
  }

  return {
    path,
    status: response.status,
    origin: new URL(response.url).origin,
    redirected: response.redirected,
    headers,
    canonical: CANONICAL_RE.exec(body)?.[1] ?? null,
    bodyMarkers: markers,
  }
}

/** Checks that must hold in one environment on its own terms. */
function auditAbsolute(report: EnvReport): void {
  const { probes, failures } = report

  for (const [path, result] of probes) {
    const csp = result.headers['content-security-policy']

    if (csp?.includes("'unsafe-eval'")) {
      failures.push(`${path}: CSP contains 'unsafe-eval' — a development build was deployed`)
    }

    for (const name of REQUIRED_ON_EVERY_PATH) {
      if (!(name in result.headers)) failures.push(`${path}: missing ${name}`)
    }

    if (result.status >= 500) failures.push(`${path}: server error ${result.status}`)

    if (XML_ROOTS[path] && !result.bodyMarkers.includes('xml-ok')) {
      failures.push(
        `${path}: expected <${XML_ROOTS[path]}> root, not found (status ${result.status})`,
      )
    }

    if (path.endsWith('parity-probe')) {
      if (result.status !== 404) failures.push(`${path}: expected 404, got ${result.status}`)
      if (!result.bodyMarkers.includes('branded-404')) {
        failures.push(`${path}: 404 page is not the branded one`)
      }
    }
  }
}

/**
 * Cross-host canonicals: warn, or fail if the target is itself a redirect.
 *
 * A canonical pointing at a different host than the one serving the page is not
 * automatically wrong — some deployments canonicalise deliberately. It IS wrong
 * when the canonical target redirects, because a canonical must name the final
 * URL; pointing it at a redirect gives crawlers two contradictory signals and
 * Google's guidance is explicit that such a canonical may simply be ignored.
 *
 * Distinguishing the two costs one extra request per distinct canonical origin,
 * not one per path.
 */
async function auditCanonicalOrigin(report: EnvReport): Promise<void> {
  const mismatched = new Map<string, string[]>()

  for (const [path, result] of report.probes) {
    if (!result.canonical) continue
    const canonicalOrigin = new URL(result.canonical).origin
    if (canonicalOrigin === result.origin) continue
    const paths = mismatched.get(canonicalOrigin) ?? []
    paths.push(path)
    mismatched.set(canonicalOrigin, paths)
  }

  for (const [canonicalOrigin, paths] of mismatched) {
    const servingOrigin = report.probes.get(paths[0] ?? '/')?.origin ?? report.base
    let redirects = false
    let target = ''

    try {
      const response = await fetch(canonicalOrigin, {
        redirect: 'manual',
        headers: { 'user-agent': 'rajchowk-verify-parity' },
      })
      redirects = response.status >= 300 && response.status < 400
      target = response.headers.get('location') ?? ''
    } catch {
      report.warnings.push(`canonical origin ${canonicalOrigin} is unreachable`)
      continue
    }

    const summary = `${paths.length} page(s) declare canonical on ${canonicalOrigin} but are served from ${servingOrigin}`

    if (redirects) {
      report.failures.push(
        `${summary}\n        ${canonicalOrigin} itself redirects to ${target} — a canonical must ` +
          `name the final URL, so this is self-contradictory.\n        Fix: set ` +
          `NEXT_PUBLIC_SITE_URL to ${servingOrigin} on this branch.`,
      )
    } else {
      report.warnings.push(`${summary} (target does not redirect — may be deliberate)`)
    }
  }
}

/** Checks that compare the two environments against each other. */
function diff(a: EnvReport, b: EnvReport): string[] {
  const differences: string[] = []

  for (const path of PATHS) {
    const left = a.probes.get(path)
    const right = b.probes.get(path)
    if (!left || !right) continue

    if (left.status !== right.status) {
      differences.push(`${path}: status ${left.status} vs ${right.status}`)
    }

    // Whether a path redirects is part of the contract: if staging serves /live
    // directly and production 301s it, they are not the same application.
    if (left.redirected !== right.redirected) {
      differences.push(
        `${path}: redirect ${left.redirected ? 'yes' : 'no'} vs ${right.redirected ? 'yes' : 'no'}`,
      )
    }

    for (const name of COMPARED_HEADERS) {
      // robots.txt content and the X-Robots-Tag on private routes are allowed to
      // differ: a non-production branch must stay out of the index.
      if (ROBOTS_SENSITIVE.has(path) && name === 'x-robots-tag') continue

      const lv = left.headers[name]
      const rv = right.headers[name]
      if (lv !== rv) {
        differences.push(
          `${path}: ${name}\n      A: ${lv ?? '(absent)'}\n      B: ${rv ?? '(absent)'}`,
        )
      }
    }

    const lm = left.bodyMarkers.filter((m) => !m.startsWith('robots-')).join(',')
    const rm = right.bodyMarkers.filter((m) => !m.startsWith('robots-')).join(',')
    if (lm !== rm) differences.push(`${path}: body markers [${lm}] vs [${rm}]`)
  }

  return differences
}

async function inspect(base: string): Promise<EnvReport> {
  const report: EnvReport = { base, probes: new Map(), failures: [], warnings: [] }

  for (const path of PATHS) {
    try {
      report.probes.set(path, await probe(base, path))
    } catch (error) {
      report.failures.push(
        `${path}: request failed — ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  auditAbsolute(report)
  await auditCanonicalOrigin(report)
  return report
}

function describeRobots(report: EnvReport): string {
  const robots = report.probes.get('/robots.txt')
  if (!robots) return 'unknown'
  if (robots.bodyMarkers.includes('robots-disallow-all')) return 'Disallow: / (non-production)'
  if (robots.bodyMarkers.includes('robots-has-allow')) return 'indexable (production)'
  return 'unrecognised'
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))

  if (args.length === 0 || args.length > 2) {
    console.error('Usage: npm run verify:parity -- <urlA> [urlB]')
    process.exitCode = 1
    return
  }

  const bases = args.map(normalizeBase)
  const reports: EnvReport[] = []

  for (const base of bases) {
    process.stdout.write(`Probing ${base} … `)
    const report = await inspect(base)
    console.log(`${report.probes.size}/${PATHS.length} paths, ${report.failures.length} issue(s)`)
    reports.push(report)
  }

  let failed = false

  for (const report of reports) {
    const servedFrom = report.probes.get('/')?.origin ?? report.base
    console.log(`\n${report.base}`)
    if (servedFrom !== report.base) console.log(`  served from:   ${servedFrom} (redirected)`)
    console.log(`  robots policy: ${describeRobots(report)}`)

    for (const warning of report.warnings) console.log(`  WARN  ${warning}`)

    if (report.failures.length === 0) {
      console.log('  PASS  no absolute-contract violations')
    } else {
      failed = true
      for (const failure of report.failures) console.log(`  FAIL  ${failure}`)
    }
  }

  if (reports.length === 2) {
    const [a, b] = reports as [EnvReport, EnvReport]
    const differences = diff(a, b)
    console.log(`\nA = ${a.base}\nB = ${b.base}`)
    if (differences.length === 0) {
      console.log('  PASS  environments are identical across every compared surface')
    } else {
      failed = true
      console.log(`  ${differences.length} DIFFERENCE(S):`)
      for (const d of differences) console.log(`  FAIL  ${d}`)
    }
    console.log('\n  Expected-by-design differences NOT reported above: origin, robots.txt policy.')
  }

  if (failed) process.exitCode = 1
}

// Not top-level await: this file has no imports, so TS would not treat it as a
// module and TS1375 fires. Catching here also turns an unexpected throw into a
// clean non-zero exit rather than an unhandled rejection warning.
main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
