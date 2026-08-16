import type { NextConfig } from 'next'

/**
 * Content Security Policy.
 *
 * Public pages are statically generated / ISR, so they CANNOT carry a
 * per-request nonce: a nonce forces dynamic rendering, which would disable ISR
 * site-wide and is the single most expensive change this app could make on
 * Amplify Hosting compute. All routes therefore share this static policy.
 *
 * `'unsafe-inline'` in script-src is not a shrug. Next streams the RSC payload
 * as inline `self.__next_f.push()` calls whose hashes change on every render,
 * so a hash-based policy is not expressible for an App Router app. The
 * compensating controls are the ones that actually carry the load here: no
 * `dangerouslySetInnerHTML` anywhere on the content path (ESLint-enforced),
 * Markdown sanitised on the hast tree, and Trusted Types in report-only below.
 */
const CSP = [
  "default-src 'self'",
  process.env.NODE_ENV === 'development'
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  /**
   * `*.cloudfront.net` is the article image CDN — a private S3 bucket fronted
   * by an Origin Access Control distribution (see amplify/backend.ts).
   *
   * A wildcard rather than the exact distribution host because the domain is
   * assigned by CloudFront at deploy time and differs per environment, while
   * this policy is a build-time constant. The same reasoning already governs
   * `connect-src https://*.amazonaws.com` two lines down. It is narrow in the
   * way that matters: an `img-src` origin can render pixels, not run script.
   */
  "img-src 'self' data: blob: https://*.cloudfront.net",
  "font-src 'self' data:",
  // Cognito and AppSync. Scoped to AWS hosts rather than '*' so a compromised
  // script cannot exfiltrate to an arbitrary origin.
  "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

const TRUSTED_TYPES_REPORT_ONLY = [
  "require-trusted-types-for 'script'",
  'trusted-types default nextjs nextjs#bundler',
].join('; ')

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
      'magnetometer=(), gyroscope=(), interest-cohort=()',
  },
  // Two years, with preload. Amplify Hosting terminates TLS and redirects
  // http->https, so there is no plaintext origin this could lock anyone out of.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Content-Security-Policy-Report-Only', value: TRUSTED_TYPES_REPORT_ONLY },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Next infers the workspace root from the nearest lockfile and walks upward.
  // A stray lockfile anywhere above the project (a developer's home directory,
  // or the Amplify build container) makes it trace the deployment bundle from
  // the wrong root. Pin it — `next build` always runs from the project root.
  outputFileTracingRoot: process.cwd(),

  // NEVER set `distDir` — Amplify Hosting requires build artifacts in `.next`.
  // NEVER set `output: 'standalone' | 'export'` — Amplify's SSR adapter builds
  // its own deployment bundle from the default `.next` output.

  eslint: {
    // Linting runs explicitly in `npm run verify` and in amplify.yml. Leaving
    // this false would make `next build` invoke the deprecated `next lint`.
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // Defence in depth: a robots.txt disallow leaks URLs and does not
        // deindex. The header does. It also cannot be forgotten on a new page
        // the way a `metadata.robots` export can.
        source: '/admin/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default nextConfig
