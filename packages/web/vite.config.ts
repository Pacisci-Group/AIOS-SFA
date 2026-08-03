import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const sharedSrc = path.resolve(__dirname, '../shared/src/index.ts');
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig(({ mode }) => {
  // Read the repo-root .env (all keys, not just VITE_*) so a worktree can pin its
  // own ports — Vite does not populate process.env from it on its own.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Dev + prod: bundle shared from source (no separate shared:build for web)
        '@sfa/shared': sharedSrc,
      },
    },
    server: {
      // Overridable so parallel git worktrees can each run their own dev stack
      // (see scripts/new-worktree.sh); defaults match the single-checkout setup.
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        '/api/v1': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
