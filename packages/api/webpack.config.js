const path = require('path');

/**
 * Dev + prod: bundle @sfa/shared from TypeScript source; leave node_modules external.
 * Emits dist/main.js and dist/seed/seed.js (used by Docker compose and npm run seed).
 */
module.exports = (options) => ({
  ...options,
  entry: {
    main: options.entry,
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
