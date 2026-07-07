const path = require('path');

/**
 * Dev: bundle @sfa/shared from TypeScript source; leave node_modules (bcrypt, etc.) external.
 */
module.exports = (options) => ({
  ...options,
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
