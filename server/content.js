// server/content.js
// -----------------------------------------------------------------------------
// Content lives in Postgres: projects in their own table (edited from /admin),
// everything else (site, credentials, timeline, services, booking rules) in
// meta.content. data/content.json is only the first-boot seed.
//
// Every server instance caches the content and reloads it when
// meta.content_version moves, so admin edits show up on the next request.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, one, ensureSchema, setMeta, getMeta, SCHEMA_VERSION } from './db.js';

let booted = null;
export function boot() {
  booted ??= (async () => {
    if (await ensureSchema()) {
      const seed = JSON.parse(fs.readFileSync(config.contentFile, 'utf8'));
      const { projects, _note, ...rest } = seed;
      for (const [i, p] of projects.entries()) {
        await q(`insert into projects (slug, title, client, kind, clip, url, repo, tags, year, poster, summary, position)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) on conflict (slug) do nothing`,
        [p.slug, p.title, p.client, p.kind, p.clip, p.client_url, p.repo || '', JSON.stringify(p.tags || []), p.year, p.poster, p.summary, i]);
      }
      await setMeta('content', rest);
      await setMeta('schema_version', SCHEMA_VERSION);
      await bumpContent();
    } else {
      // Seed upgrades: when data/content.json carries a newer seed_version, refresh the non-project
      // content (site, credentials, timeline, services). Projects stay as edited in /admin.
      const seed = JSON.parse(fs.readFileSync(config.contentFile, 'utf8'));
      const cur = await getMeta('content', {});
      if ((seed.seed_version || 1) > (cur.seed_version || 1)) {
        const { projects, _note, ...rest } = seed;
        await setMeta('content', rest);
        await bumpContent();
      }
    }
  })().catch((e) => { booted = null; throw e; });
  return booted;
}

export const bumpContent = (t) => (t || { q }).q(`insert into meta (key, value) values ('content_version', '1'::jsonb)
  on conflict (key) do update set value = to_jsonb((meta.value #>> '{}')::int + 1)`);

const cache = { version: null, data: null, etag: '', all: [] };

/** One cheap query per request; full reload only when the version changed. */
export async function refresh() {
  await boot();
  const v = await one("select value from meta where key = 'content_version'");
  const ver = v ? v.value : 0;
  if (ver === cache.version && cache.data) return cache;
  const [rows, base] = await Promise.all([q('select * from projects order by position, id'), getMeta('content', {})]);
  const n = rows.filter((r) => r.visible).length;
  let k = 0;
  cache.all = rows;
  const projects = rows.filter((r) => r.visible).map((r) => ({
    id: `p${r.id}`, slug: r.slug, title: r.title, client: r.client || r.title, kind: r.kind, clip: r.clip,
    client_url: r.url, repo: r.repo, tags: r.tags, year: r.year, poster: r.poster, summary: r.summary,
    caption_key: `#hs${String(r.year || 26).slice(-2)}-${String(++k).padStart(4, '0')}/${n}`,
  }));
  cache.data = { ...base, projects };
  cache.etag = `"${crypto.createHash('sha1').update(JSON.stringify(cache.data)).digest('hex').slice(0, 16)}"`;
  cache.version = ver;
  return cache;
}

export const content = () => cache.data;
export const etag = () => cache.etag;
export const allProjectRows = () => cache.all;
export const getService = (id) => cache.data?.services.find((s) => s.id === id) || null;
