const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  // Keep BullMQ's runtime scripts/optional clients in its installed package.
  externals: [{ bullmq: 'commonjs bullmq', ioredis: 'commonjs ioredis' }],
  resolve: { alias: { src: join(__dirname, 'src') } },
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      mergeExternals: true,
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [
        { entryName: 'worker', entryPath: './src/worker.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
