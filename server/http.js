// server/http.js
// -----------------------------------------------------------------------------
// Tiny helpers so route handlers stay readable: send JSON/text, consistent
// error shape, gzip when the client accepts it, and a size-limited body reader.
// -----------------------------------------------------------------------------
import zlib from 'node:zlib';
import { config } from './config.js';

/** Error type handlers can throw; the router turns it into a JSON response. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json|ld\+json)|image\/svg\+xml)/;

/** Send a body, gzip-compressing text types above 1 KB when accepted. */
export function send(req, res, status, body, headers = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const type = headers['Content-Type'] || '';
  const out = { ...headers };
  if (COMPRESSIBLE.test(type)) {
    out['Vary'] = 'Accept-Encoding';
    if (buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      buf = zlib.gzipSync(buf);
      out['Content-Encoding'] = 'gzip';
    }
  }
  out['Content-Length'] = buf.length;
  res.writeHead(status, out);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

export function sendJson(req, res, status, data, headers = {}) {
  send(req, res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

/** Every API error looks like { error: "CODE", message: "..." } (+ optional fields). */
export function sendError(req, res, status, code, message, extra = {}) {
  sendJson(req, res, status, { error: code, message, ...extra });
}

/** Read the raw request body as a string, refusing anything over the limit. */
export function readRawBody(req, limit = config.bodyLimit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${limit} bytes`));
      req.resume(); // drain so the socket can be reused
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Read and parse a JSON body. Returns { raw, body } — raw is needed for HMAC checks. */
export async function readJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json');
  }
  const raw = await readRawBody(req);
  try {
    const body = raw ? JSON.parse(raw) : {};
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return { raw, body };
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Body must be a JSON object');
  }
}

/** Client IP, honouring proxy headers only when TRUST_PROXY=1. */
export function clientIp(req) {
  if (process.env.VERCEL || process.env.TRUST_PROXY === '1') {
    const real = req.headers['x-real-ip'];
    if (real) return String(real);
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf);
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
