import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The SPA is served at "/" in production. The legacy PHP admin (index.php,
// view.php, views/*.html, assets/js/*) still lives on disk and is directly
// reachable by URL — it's the escape hatch for the ~19 create/edit forms not
// yet ported to React (see docs/deployment or the react-cutover branch plan)
// — but it is no longer the default landing experience. In dev, Vite proxies
// the PHP backend so the browser treats everything as same-origin and the
// `gestionale_session` cookie flows without CORS headaches.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY || 'http://localhost:8000';

  // Paths owned by the PHP backend that must be proxied through in dev,
  // including the legacy admin escape hatch (index.php/view.php/views/*).
  const backendPaths = [
    '/api',
    '/uploads',
    '/assets',
    '/login.php',
    '/login_2fa.php',
    '/logout.php',
    '/branding.css.php',
    '/index.php',
    '/view.php',
    '/views',
  ];

  return {
    base: '/',
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      proxy: Object.fromEntries(
        backendPaths.map((p) => [
          p,
          { target: apiTarget, changeOrigin: true, secure: false },
        ]),
      ),
    },
    build: {
      outDir: 'dist',
      // The legacy admin already owns /assets/* at web root (shared with the
      // owner/tenant portals). Keep Vite's own build assets on a distinct
      // path so the two don't collide once both are copied into the same
      // web root (see Dockerfile).
      assetsDir: '_app-assets',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'query-vendor': ['@tanstack/react-query'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});
