import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@iris/extension-utils': path.resolve(__dirname, 'packages/extension-utils/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
});
