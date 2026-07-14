/**
 * Resolve a backend media path to a browser URL.
 *
 * The API returns paths like "uploads/properties/2/foto.jpg" (no leading slash).
 * The app runs under /app, so a bare relative path would resolve to
 * /app/uploads/... and 404. Prefixing "/" points it at the backend root, which
 * the Vite dev proxy (and Apache in prod) serves.
 */
export function mediaSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return `/${path}`;
}
