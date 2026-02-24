import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const CDN_BASE = 'https://cdn.siglum.org/tl2025/bundles'

function siglumDownloader(): Plugin {
  return {
    name: 'vite-plugin-siglum-downloader',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/bundles/')) {
          return next()
        }

        const fileName = path.basename(req.url)
        const publicDir = path.resolve(__dirname, 'public/bundles')
        const filePath = path.join(publicDir, fileName)

        if (fs.existsSync(filePath)) {
          return next()
        }

        console.log(`[Siglum] Auto-downloading missing bundle: ${fileName}`)

        try {
          // Ensure directory exists
          if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true })
          }

          const response = await fetch(`${CDN_BASE}/${fileName}`)

          if (!response.ok) {
            console.error(`[Siglum] Failed to download ${fileName}: ${response.statusText}`)
            return next()
          }

          // Save to file
          const fileStream = fs.createWriteStream(filePath)
          if (response.body) {
            // @ts-ignore - native fetch body is a ReadableStream which works with pipeline
            await pipeline(response.body, fileStream)
          }

          console.log(`[Siglum] Downloaded ${fileName}`)
          next()
        } catch (err) {
          console.error(`[Siglum] Error downloading ${fileName}:`, err)
          next()
        }
      })

      // Add middleware to serve bundle files with correct headers
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/bundles/') && req.url.endsWith('.data.gz')) {
          // Prevent Vite/browser from handling gzip automatically.
          // The engine expects to receive the gzipped bytes.
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Encoding', 'identity')
        }
        next()
      })
    }
  }
}

import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    siglumDownloader(),
    wasm(),
    topLevelAwait()
  ],
  server: {
    port: 3002,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.VITE_API_PORT || '3003'}`,
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    exclude: ['@siglum/engine', 'blake3-wasm']
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext'
  },
  resolve: {
    alias: {
      './blake3_js_bg.js': './blake3_js_bg.wasm'
    }
  }
})
