import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    // bcrypt at cost 12 (NFR-01) makes auth tests CPU-heavy; leave headroom for busy machines.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
