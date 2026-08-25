// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Feature directories under `src/`. Anything not listed here is either shared
 * infrastructure the worker is allowed to use (`common`, `config`, `inngest`,
 * `storage`), the worker itself, or an offline CLI (`seed`, `migration`).
 *
 * ⚠ Three things to know before editing this list:
 *
 * 1. Add a new feature directory here when you create one, or the worker
 *    boundary silently stops covering it.
 * 2. **No name here may collide with a directory inside `src/worker/`.** These
 *    patterns match the import *string*, so a shared name matches the worker's
 *    own relative imports too and the rule fires on correct code. This is why
 *    the worker's email subsystem lives in `src/worker/email/` rather than
 *    `src/worker/mail/` — `mail` is taken by `src/mail/`.
 * 3. `storage` was here and was **deliberately removed** (PAC-73). It is not a
 *    feature: `StorageService` is an S3 wrapper whose only injected dependency
 *    is `ConfigService`, it is already `@Global()`, and it owns no domain
 *    logic — the same tier as `common`/`config`/`inngest`. Any worker job that
 *    processes an uploaded file needs it, and the mailer import is the first
 *    one. Listing it forced the alternative of re-reading the object through a
 *    hand-rolled second S3 client inside the worker, which is strictly worse.
 *    `WorkerModule` imports `StorageModule` explicitly so the standalone worker
 *    gets it too, rather than relying on `AppModule`'s global registration.
 */
const FEATURE_DIRS = [
  'activities', 'audit-generation', 'audit-templates', 'auth', 'branches',
  'carriers', 'clients', 'contacts', 'crm', 'crm-rotations', 'deal-audit-items',
  'deal-audits', 'deals', 'feature-modules', 'households', 'interested-parties',
  'leaderboard', 'leads', 'mail', 'mailers', 'performance', 'permissions',
  'platform', 'policies', 'prior-insurance', 'prior-policies',
  'producer-assignments', 'producer-goals', 'quote-recaps', 'roles',
  'service-tickets', 'share-links', 'sold-deals', 'time-off-requests', 'users',
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
   * Schemas are deliberately allowed: the worker has to read the same
   * collections the API writes, and duplicating 30-odd schema definitions to
   * avoid one import would be strictly worse. It is the *services* — with their
   * injected dependencies and transitive module graph — that must not cross.
   *
   * ## Why `regex` and not `group` (PAC-73)
   *
   * This was a `group` of gitignore-style patterns with negations for
   * `*.schema` files and `schemas` directories, and **those negations never
   * took effect** — a
   * worker file importing `../policies/schemas/policy.schema` was rejected
   * despite the rule's own docblock promising it would not be. Gitignore
   * semantics forbid re-including a file whose parent directory is already
   * excluded, and a recursive glob over `policies` excludes the `schemas`
   * directory along with everything else under it. Nothing caught it because
   * until the mailer import no worker file had ever needed a feature schema.
   *
   * A regex with a leading negative lookahead expresses the exception directly.
   * It is also anchored to `../`, which the `group` form was not, so it matches
   * only imports whose **first non-relative segment** is a feature directory.
   * That kills a second, subtler failure mode: `../../common/mailers/…` — a
   * pure helper in the shared tier — matched the recursive `mailers` glob
   * purely because the word appeared somewhere in the path.
   */
  {
    files: ['src/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: `^(?!.*(?:/schemas/|\\.schema$))(?:\\.\\./)+(?:${FEATURE_DIRS.join('|')})/`,
          message: WORKER_OWNS_ITS_LOGIC,
        }],
      }],
    },
  },
);
