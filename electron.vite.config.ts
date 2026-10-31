import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'
import versionCheck from './version-check.config.json'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
  main: {
    define: {
      __LOGDECK_VERSION__: JSON.stringify(versionCheck),
      __LOGDECK_FIREBASE__: JSON.stringify({ apiKey: env.VITE_FIREBASE_API_KEY ?? '', projectId: env.VITE_FIREBASE_PROJECT_ID ?? '' }),
      __LOGDECK_RELEASE__: JSON.stringify({
        manifestUrl: env.VITE_UPDATE_MANIFEST_URL ?? '',
        websiteUrl: env.VITE_WEBSITE_URL ?? ''
      })
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          logWorker: resolve('src/workers/logWorker.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [
      react(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          // Vite's refresh preamble and websocket are development-only.
          return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
        }
      }
    ],
    build: { minify: true }
  }
  }
})
