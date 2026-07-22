/**
 * Build-time asset pipeline for the PHP app.
 *
 * Bundles the global CSS (the style.css partial chain + theme) into a single
 * minified file, assets/dist/app.min.css. This collapses the 9-request @import
 * waterfall the browser would otherwise make into one request.
 *
 * This is NOT a frontend framework or a runtime dependency: it only emits static
 * files under assets/dist/. index.php uses that bundle when present and falls
 * back to the unbundled source files otherwise, so the app runs with or without
 * this build having been run.
 *
 * Run: npm run build:assets
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'assets/dist'), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { 'app.min': 'assets/css/bundle.css' },
  bundle: true,
  minify: true,
  outdir: 'assets/dist',
  logLevel: 'info',
  // The CSS uses only data: URIs, so there are no external assets to resolve;
  // leave any url() token untouched just in case one is added later.
  loader: { '.woff2': 'copy', '.woff': 'copy', '.png': 'copy', '.svg': 'copy' },
});

console.log('✓ built assets/dist/app.min.css');
