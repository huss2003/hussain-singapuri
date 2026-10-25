// server/security.js
// -----------------------------------------------------------------------------
// Security headers for every response, and the CSP nonce machinery.
//
// CSP nonce: each request gets a fresh random value. The policy only allows
// <script> tags that carry that exact nonce (plus the listed CDN). An attacker
// who injects <script>…</script> into a page can't guess the nonce, so the
// browser refuses to run it. That is why the server rewrites every <script> tag
// in HTML it serves (see addNonce) instead of the frontend hard-coding one.
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';

export function makeNonce() {
  return crypto.randomBytes(16).toString('base64');
}

export function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    // 'unsafe-inline' for styles: animation libraries and small inline <style>
    // blocks need it; style injection is far less dangerous than script.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'", // modern equivalent of X-Frame-Options: DENY
    "base-uri 'self'",
    "form-action 'self' mailto:",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Sets the baseline headers and returns the nonce for this request. */
export function applySecurityHeaders(res) {
  const nonce = makeNonce();
  res.setHeader('Content-Security-Policy', buildCsp(nonce));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self), interest-cohort=()');
  // Browsers ignore HSTS over plain http, so it is harmless locally and
  // correct behind Cloudflare/HTTPS in production.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.removeHeader('X-Powered-By');
  return nonce;
}

/** Put nonce="…" on EVERY <script> tag (inline and external), replacing any existing nonce. */
export function addNonce(html, nonce) {
  return html.replace(/<script\b([^>]*)>/gi, (_m, attrs) => {
    const clean = attrs.replace(/\snonce\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<script nonce="${nonce}"${clean}>`;
  });
}
