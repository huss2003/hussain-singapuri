// core/api.js — tiny fetch wrapper. Errors are { status, error, message, fields? } (the API's error shape).
import { env } from './env.js';
import fallback from './fallback-content.js';

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(env.api + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    throw { status: 0, error: 'NETWORK', message: 'Network error — check your connection and try again.' };
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw { status: res.status, error: data?.error || 'HTTP_' + res.status, message: data?.message || res.statusText, ...(data || {}) };
  return { status: res.status, data };
}

let contentPromise = null;
/** GET /api/content with the built-in fallback copy if the API fails. */
export function getContent() {
  if (!contentPromise) {
    contentPromise = api('/content')
      .then(({ data }) => (data && Array.isArray(data.projects) && data.projects.length ? { ...fallback, ...data, source: 'api' } : { ...fallback, source: 'fallback' }))
      .catch(() => ({ ...fallback, source: 'fallback' }));
  }
  return contentPromise;
}
