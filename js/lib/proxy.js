/**
 * The one address every server-side call goes through.
 *
 * Four things on this site cannot happen inside a browser: reading TMDB (the
 * key must not ship), reading Archive.org or a provider's answer (their
 * responses are not cross-origin readable), and pre-flighting an embed. They
 * all live on the site's own origin as `/tmdb`, `/ia`, `/health`, `/stream` —
 * which `serve-solvn.mjs` and this repo's `netlify.toml` both provide.
 *
 * A host that runs no server code at all — GitHub Pages, which is what
 * `solvn.site` points at today — cannot answer any of them. Deploy the same
 * four routes on a function host (the recipe is in `deploy.txt`) and put that
 * address here, once, for every visitor. It stays a literal on purpose: a
 * device-local setting would fix the operator's browser and leave everyone else
 * reading an empty shelf.
 */

export const API_HOST = '';

export const proxyUrl = (pathWithQuery) => (API_HOST ? `${API_HOST}${pathWithQuery}` : pathWithQuery);
