import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/website',
  outputDir: './test-results-website',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { channel: 'msedge', trace: 'retain-on-failure' },
  projects: [
    { name: 'public', testMatch: 'public.spec.ts', use: { baseURL: 'http://127.0.0.1:5174' } },
    { name: 'configured-admin', testMatch: 'admin.spec.ts', use: { baseURL: 'http://127.0.0.1:5175' } }
  ],
  webServer: [
    { command: 'npm.cmd run dev:website', url: 'http://127.0.0.1:5174', reuseExistingServer: false,
      env: { VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_PROJECT_ID: '', VITE_WINDOWS_DOWNLOAD_URL: '' } },
    { command: 'npm.cmd run dev:website -- --port 5175', url: 'http://127.0.0.1:5175', reuseExistingServer: false,
      env: { VITE_FIREBASE_API_KEY: 'synthetic-public-api-key', VITE_FIREBASE_PROJECT_ID: 'demo-logdeck', VITE_WINDOWS_DOWNLOAD_URL: '' } }
  ]
})
