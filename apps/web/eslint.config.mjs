import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@xjobs/database(?!/(enums|matches|types)$)',
              message:
                'web may import only @xjobs/database/enums, @xjobs/database/matches and @xjobs/database/types.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['.next/**/*', '**/out-tsc'],
  },
];
