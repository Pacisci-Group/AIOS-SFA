const path = require('path');

/**
 * Dev + prod: bundle @sfa/shared from TypeScript source; leave node_modules external.
 *
 * Emits three entries from one build, so one image can be started three ways:
 *   dist/main.js       the HTTP API (default CMD)
 *   dist/worker.js     the standalone worker — same image, different CMD, used
 *                      when WORKER_INLINE=false splits async work into its own
 *                      container. Built unconditionally so the split path is
 *                      always compiled and type-checked, never bit-rotting
 *                      until the day it is needed.
 *   dist/seed/seed.js  the core seed (Docker compose start command, npm run seed)
 */
module.exports = (options) => ({
  ...options,
  entry: {
    main: options.entry,
    worker: path.resolve(__dirname, 'src/worker.ts'),
    'seed/seed': path.resolve(__dirname, 'src/seed/seed.ts'),
  },
  output: {
    ...options.output,
    filename: '[name].js',
  },
  externals: [
    ...(Array.isArray(options.externals) ? options.externals : []),
    ({ request }, callback) => {
      if (!request) {
        return callback();
      }
      if (request === '@sfa/shared' || request.startsWith('@sfa/shared/')) {
        return callback();
      }
      if (!request.startsWith('.') && !path.isAbsolute(request)) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve?.alias ?? {}),
      '@sfa/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
