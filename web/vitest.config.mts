import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // A tsconfig "@/*" -> "./src/*" aliasát kézzel tükrözzük (nincs ESM-only plugin).
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,src}/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
