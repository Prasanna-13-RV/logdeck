import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import releaseHandler from '../api/windows-release'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function localReleaseMiddleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (request.url?.split('?')[0] !== '/updates/windows.json') { next(); return }
  void releaseHandler(request, response).catch(error => {
    console.error('Local release endpoint failed:', error)
    if (!response.headersSent) {
      response.statusCode = 500
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
    }
    response.end(JSON.stringify({ error: 'Local release endpoint failed. Check the development server logs.' }))
  })
}

const releaseEndpoint: Plugin = {
  name: 'logdeck-local-release',
  configureServer(server) { server.middlewares.use(localReleaseMiddleware) },
  configurePreviewServer(server) { server.middlewares.use(localReleaseMiddleware) }
}

const directory = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root: directory,
  envDir: resolve(directory, '..'),
  plugins: [react(), releaseEndpoint],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true }
})
