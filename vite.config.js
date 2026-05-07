import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Prevent Vite's esbuild pre-bundler from mangling onnxruntime-web's
  // dynamic WASM imports — it must be loaded as-is at runtime.
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },

  // Note: Vite v8 includes ~26 MB JSEP-variant WASM from onnxruntime-web in
  // the production bundle as a dead asset (never loaded at runtime because
  // ort.env.wasm.wasmPaths redirects to /ort-wasm/). To remove it, strip
  // `new URL(*.wasm)` references from the onnxruntime-web source with a
  // custom Vite plugin, or ship onnxruntime-web as an ESM CDN import.


  // SharedArrayBuffer (required for threaded WASM) needs these two headers.
  // They are safe here because all cross-origin fetches in this app either
  // go through same-origin Vercel functions or use blob: / data: URLs.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
