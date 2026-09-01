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
      /**
       * Bind IPv4 loopback explicitly.
       *
       * Vite's default is `localhost`, which Node resolves to **`::1` only** on
       * macOS — so the dev server listens on IPv6 loopback and nothing at all on
       * `127.0.0.1`. That is invisible while you browse `localhost` (the browser
       * tries `::1` first and succeeds), and breaks the moment you add a tenant
       * hostname to `/etc/hosts`, because the conventional entry there maps to
       * the IPv4 `127.0.0.1`. The browser resolves the name, dials
       * `127.0.0.1:5173`, and finds nothing listening — a blank page with no
       * error anywhere.
       *
       * `127.0.0.1` rather than `true`/`0.0.0.0`: this keeps the server on
       * loopback exactly as before, and does not put it on the LAN. Pass
       * `--host` on the command line when you genuinely want that.
       */
      host: env.WEB_HOST ?? '127.0.0.1',
      /**
       * Tenant hostnames the dev server will answer on.
       *
       * White-labelling is only testable in a browser if the dev server accepts
       * the tenant's own hostname — `texasholdings.sfa.local` rather than
       * `localhost`. **Vite 6 rejects any Host but localhost by default**
       * (`Blocked request. This host is not allowed.`), as DNS-rebinding
       * protection, so those names have to be listed here or the feature cannot
       * be exercised locally at all.
       *
       * Derived from the same `PLATFORM_HOST` / `BASE_DOMAIN` the API reads, so
       * one pair of env vars configures both halves of the stack. A leading dot
       * is Vite's syntax for "this domain and any subdomain", which is exactly
       * the set of agency hostnames.
       *
       * ⚠ Deliberately a list, never `true`. `true` disables the check outright
       * and re-opens the rebinding hole for every developer. Dev-server only —
       * production is served by nginx behind Caddy and never sees this.
       */
      allowedHosts: [
        ...(env.PLATFORM_HOST ? [env.PLATFORM_HOST] : []),
        ...(env.BASE_DOMAIN ? [`.${env.BASE_DOMAIN}`] : []),
      ],
      proxy: {
        '/api/v1': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
          /**
           * ⚠ Must stay `false`. The API resolves the tenant from the request's
           * `Host` header, and `changeOrigin: true` **overwrites it** with the
           * proxy target (`localhost:4000`). With it on, every tenant hostname
           * collapses to one: `texasholdings.sfa.local` and `other.sfa.local`
           * both arrive at the API looking like `localhost`, so white-labelling
           * silently does nothing in dev and an unknown host wrongly answers
           * 200 instead of 404.
           *
           * `changeOrigin` exists for proxying to a third party that vhosts on
           * `Host`. Ours is the opposite case: the original `Host` is the
           * payload.
           */
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
