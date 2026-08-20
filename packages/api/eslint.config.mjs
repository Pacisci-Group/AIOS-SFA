// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Feature directories under `src/`. Anything not listed here is either shared
 * infrastructure the worker is allowed to use (`common`, `config`, `inngest`),
 * the worker itself, or an offline CLI (`seed`, `migration`).
 *
 * ⚠ Two things to know before editing this list:
 *
 * 1. Add a new feature directory here when you create one, or the worker
 *    boundary silently stops covering it.
 * 2. **No name here may collide with a directory inside `src/worker/`.** These
 *    patterns match the import *string*, so a shared name matches the worker's
 *    own relative imports too and the rule fires on correct code. This is why
 *    the worker's email subsystem lives in `src/worker/email/` rather than
 *    `src/worker/mail/` — `mail` is taken by `src/mail/`.
 */
const FEATURE_DIRS = [
  'activities', 'audit-generation', 'audit-templates', 'auth', 'branches',
  'carriers', 'clients', 'contacts', 'crm', 'crm-rotations', 'deal-audit-items',
  'deal-audits', 'deals', 'feature-modules', 'households', 'interested-parties',
  'leaderboard', 'leads', 'mail', 'performance', 'permissions', 'platform',
  'policies', 'prior-insurance', 'prior-policies', 'producer-assignments',
  'producer-goals', 'quote-recaps', 'roles', 'service-tickets', 'share-links',
  'sold-deals', 'storage', 'time-off-requests', 'users',
];

const WORKER_IS_PRIVATE =
  'src/worker/** is extractable: it must be liftable into its own container ' +
  '(and later its own package) without touching a single caller. Nothing ' +
  'outside it may import from it, except the two composition roots importing ' +
  'WorkerModule / WorkerRootModule. Hand work to the worker by sending an ' +
  'event from src/inngest/events/ instead — see worker.module.ts.';

const WORKER_OWNS_ITS_LOGIC =
  'src/worker/** must not import feature services or controllers — that would ' +
  'drag the whole module graph across the boundary and make extraction ' +
  'impossible. Import the *.schema.ts and pure helpers instead. If the logic ' +
  'you need only exists inside a service, extract the pure part into a helper ' +
  '(the split intake.normalize.ts already makes), do not relax this rule.';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },

  /*
   * ── Worker boundary, rule 1 ────────────────────────────────────────────────
   * Nothing outside src/worker/ imports from inside it.
   *
   * The two module files are negated exceptions: something has to compose the
   * graph, so `app.module.ts` imports WorkerModule and `worker.ts` imports
   * WorkerRootModule. Those are the module's public entry points, and they are
   * the *only* ones — importing MailDeliveryService into a controller is
   * exactly the erosion this rule exists to stop.
   */
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    // `test/worker/**` is exempt: a test of the worker has to import the worker,
    // and grouping those tests in one directory means they move with the code
    // when it is extracted rather than being scattered through the API's suite.
    // Adding a worker test therefore means putting it in that directory — which
    // is exactly the small, deliberate friction this rule is for.
    ignores: ['src/worker/**', 'test/worker/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/worker/**',
            '!**/worker/worker.module',
            '!**/worker/worker-root.module',
          ],
          message: WORKER_IS_PRIVATE,
        }],
      }],
    },
  },

  /*
   * ── Worker boundary, rule 2 ────────────────────────────────────────────────
   * The worker does not reach into feature modules.
   *
   * Schemas are deliberately still allowed (`*.schema` is negated): the worker
   * has to read the same collections the API writes, and duplicating 31 schema
   * definitions to avoid one import would be strictly worse. It is the
   * *services* — with their injected dependencies and transitive module graph —
   * that must not cross.
   */
  {
    files: ['src/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            ...FEATURE_DIRS.flatMap((dir) => [`**/${dir}/**`, `../${dir}/*`]),
            '!**/*.schema',
            '!**/schemas/**',
          ],
          message: WORKER_OWNS_ITS_LOGIC,
        }],
      }],
    },
  },
);
