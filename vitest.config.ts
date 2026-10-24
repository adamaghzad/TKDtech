import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: {
    '@tkd/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
    '@tkd/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts')
  } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], coverage: { reporter: ['text', 'html'] } }
});
