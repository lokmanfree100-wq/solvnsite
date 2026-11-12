/**
 * The browser half of SOLVN CAT.
 *
 * It sends the conversation to the site's own `/api/chat` route and nothing
 * else. No key, no model name and no provider address exists in this file — the
 * Netlify function owns all three. When the site is served by a host that runs
 * no functions (GitHub Pages), the request 404s and the panel says so instead of
 * pretending to think.
 */

import { proxyUrl } from './proxy.js';

const ENDPOINT = proxyUrl('/api/chat');

export class CatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CatError';
    this.code = code;
  }
}

const COPY = {
  unconfigured:
    "SOLVN CAT isn't switched on yet — the site owner needs to add the assistant's API key.",
  offline:
    "SOLVN CAT needs the site's server route, and this address doesn't have it. Open solvn.site, or run the site with Netlify Dev.",
  rate: 'That was a lot of questions at once. Give me a few seconds and ask again.',
  catalogue: "I couldn't reach the catalogue just now. Try that again in a moment.",
  model: "My thoughts got lost for a second. Ask me once more?",
  network: "I can't reach the server from here. Check your connection and try again.",
  empty: 'I did not catch that — say it another way?',
};

export function catErrorMessage(code) {
  return COPY[code] || COPY.model;
}

export async function askCat(messages, { signal } = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new CatError('network', COPY.network);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* a static host answers 404 with HTML */
  }

  if (!res.ok) {
    const code = data?.code || (res.status === 404 || res.status === 405 ? 'offline' : 'model');
    throw new CatError(code, data?.error || COPY[code] || COPY.model);
  }
  if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
    throw new CatError('empty', COPY.empty);
  }

  return {
    reply: data.reply.trim(),
    picks: Array.isArray(data.picks)
      ? data.picks.filter((p) => p && Number.isInteger(Number(p.id)) && p.title).slice(0, 3)
      : [],
  };
}
