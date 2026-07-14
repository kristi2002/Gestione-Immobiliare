import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The SPA is served under /app in production (strangler pattern: the legacy
// PHP SPA keeps living at "/"). In dev, Vite proxies the PHP backend so the
// browser treats everything as same-origin and the `gestionale_session`
// cookie flows without CORS headaches.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY || 'http://localhost:8000';

  // Paths owned by the PHP backend that must be proxied through in dev.
  const backendPaths = ['/api', '/uploads', '/assets', '/login.php', '/logout.php', '/branding.css.php'];

  return {
    base: '/app/',
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
