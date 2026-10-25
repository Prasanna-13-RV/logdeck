import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  root: directory,
  envDir: resolve(directory, '..'),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5174, strictPort: true }
})
