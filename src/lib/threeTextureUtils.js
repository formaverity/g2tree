import * as THREE from 'three'

const MAX_PX = { bark: 1024, leaf: 512, canopy: 768, default: 512 }

function isDataUrl(url) {
  return typeof url === 'string' && url.startsWith('data:image')
}

function isHttpUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))
}

/**
 * Downscale a dataUrl to maxPx on its longest side.
 * Returns the original dataUrl if already small enough, or null on failure.
 */
export function downscaleDataUrl(dataUrl, maxPx) {
  if (!isDataUrl(dataUrl)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= maxPx && h <= maxPx) { resolve(dataUrl); return }
      const scale = maxPx / Math.max(w, h)
      const nw = Math.round(w * scale)
      const nh = Math.round(h * scale)
      const cv = document.createElement('canvas')
      cv.width = nw; cv.height = nh
      cv.getContext('2d').drawImage(img, 0, 0, nw, nh)
      resolve(cv.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

/**
 * Safely load a THREE.Texture from a data URL or an HTTPS URL.
 * Returns null (not a rejection) if loading fails.
 *
 * options:
 *   textureType  — 'bark' | 'leaf' | 'canopy' | 'default'  (controls max downscale size)
 *   wrapS/wrapT  — THREE wrapping mode (default RepeatWrapping)
 *   repeat       — [u, v] repeat values
 *   anisotropy   — anisotropy level
 */
export async function loadTextureSafe(url, options = {}) {
  if (!isDataUrl(url) && !isHttpUrl(url)) return null

  let loadUrl = url

  if (isDataUrl(url)) {
    const maxPx = MAX_PX[options.textureType] ?? MAX_PX.default
    loadUrl = await downscaleDataUrl(url, maxPx)
    if (!loadUrl) return null
  }

  return new Promise((resolve) => {
    try {
      const loader = new THREE.TextureLoader()
      loader.crossOrigin = 'anonymous'
      loader.load(
        loadUrl,
        (texture) => {
          texture.needsUpdate = true
          texture.wrapS = options.wrapS ?? THREE.RepeatWrapping
          texture.wrapT = options.wrapT ?? THREE.RepeatWrapping
          if (options.repeat) texture.repeat.set(options.repeat[0], options.repeat[1])
          if (options.anisotropy) texture.anisotropy = options.anisotropy
          resolve(texture)
        },
        undefined,
        (err) => {
          if (import.meta.env.DEV) console.warn('[loadTextureSafe] error:', err)
          resolve(null)
        },
      )
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[loadTextureSafe] exception:', err)
      resolve(null)
    }
  })
}
