import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NextConfig } from 'next'

/**
 * `amplify_outputs.json` is gitignored and produced by `ampx sandbox` /
 * `ampx pipeline-deploy`. Reading it here lets image `remotePatterns` be scoped
 * to OUR media bucket. A wildcard would let anyone proxy arbitrary remote
 * objects through the image optimizer.
 */
type AmplifyOutputs = {
  storage?: { bucket_name?: string; aws_region?: string }
}

function readAmplifyOutputs(): AmplifyOutputs {
  const path = join(process.cwd(), 'amplify_outputs.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AmplifyOutputs
  } catch {
    return {}
  }
}

const outputs = readAmplifyOutputs()
const bucket = outputs.storage?.bucket_name ?? process.env.NEXT_PUBLIC_MEDIA_BUCKET
const region = outputs.storage?.aws_region ?? process.env.NEXT_PUBLIC_AWS_REGION ?? 'ap-south-1'

const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] = [
  // YouTube thumbnails for the click-to-load embed facade.
  { protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' },
  { protocol: 'https', hostname: 'img.youtube.com', pathname: '/vi/**' },
]

if (bucket) {
  remotePatterns.push(
    { protocol: 'https', hostname: `${bucket}.s3.${region}.amazonaws.com`, pathname: '/media/**' },
    { protocol: 'https', hostname: `${bucket}.s3.amazonaws.com`, pathname: '/media/**' },
  )
}

if (process.env.NEXT_PUBLIC_MEDIA_CDN_HOST) {
  remotePatterns.push({
    protocol: 'https',
    hostname: process.env.NEXT_PUBLIC_MEDIA_CDN_HOST,
    pathname: '/**',
  })
}

/**
 * Public pages are statically generated / ISR, so they cannot carry a per-request
 * nonce (a nonce forces dynamic rendering, which would disable ISR site-wide and
 * is the single most expensive thing we could do on Amplify Hosting compute).
 *
 * Public routes therefore get this static policy, and `src/middleware.ts` layers
 * a strict nonce-based policy over the already-dynamic /admin, /account, /auth
 * and /preview routes. See docs/architecture.md.
 */
const PUBLIC_CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required: Next streams the RSC payload as inline
  // self.__next_f.push() calls whose hashes change every render.
  // Trusted Types (report-only, below) is the compensating control.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com wss://*.amazonaws.com",
  // The only third-party frame we ever mount, and only after a user click.
  'frame-src https://www.youtube-nocookie.com',
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
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
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
      'magnetometer=(), gyroscope=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'Content-Security-Policy', value: PUBLIC_CSP },
  { key: 'Content-Security-Policy-Report-Only', value: TRUSTED_TYPES_REPORT_ONLY },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Next infers the workspace root from the nearest lockfile and walks upward.
  // A stray lockfile anywhere above the project (a developer's home directory,
  // or the Amplify build container) makes it trace the deployment bundle from
  // the wrong root. Pin it. `next build` always runs from the project root.
  outputFileTracingRoot: process.cwd(),

  // NEVER set `distDir` — Amplify Hosting requires build artifacts in `.next`.
  // NEVER set `output: 'standalone' | 'export'` — Amplify's SSR adapter builds
  // its own deployment bundle from the default `.next` output.

  eslint: {
    // Linting runs explicitly in `npm run verify` and in amplify.yml. Leaving
    // this false would make `next build` invoke the deprecated `next lint` path.
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns,
    formats: ['image/avif', 'image/webp'],
    // Sized for the Indian mobile market first.
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    dangerouslyAllowSVG: false,
    contentDispositionType: 'attachment',
  },

  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // Defence in depth: robots.ts disallow alone leaks URLs and does not
        // deindex. The header does.
        source: '/:path(admin|account|auth|preview)/:rest*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default nextConfig
