import { defineConfig } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', 'apps/web/next-env.d.ts'] },
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
]);
