import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:5173/' } },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 2,
  },
});
