import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de interface com o backend simulado (tests/e2e/mockBackend.ts).
 * As regras de banco (RLS, deduplicação, consentimento) são testadas em tests/integration.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'off',
    // No container de desenvolvimento usamos o Chromium já instalado; localmente o Playwright usa o próprio.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npx vite build --mode e2e && npx vite preview --mode e2e --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
