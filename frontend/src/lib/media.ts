/**
 * Resolve a backend media path to a browser URL.
 *
 * The API returns paths like "uploads/properties/2/foto.jpg" (no leading slash).
 * A bare relative path would resolve against the current route (e.g.
 * /properties/uploads/...) and 404. Prefixing "/" roots it at the backend,
 * which the Vite dev proxy (and Apache in prod) serves.
 */
export function mediaSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return `/${path}`;
}
