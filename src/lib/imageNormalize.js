/**
 * Normalizes images for Pl@ntNet compatibility.
 * JPEG/PNG are returned as-is. WEBP is converted client-side via Canvas.
 * All processing is browser-local — nothing is uploaded here.
 */
export async function normalizeImageForPlantNet(file) {
  const { type } = file

  if (type === 'image/jpeg' || type === 'image/png') {
    return { file, wasConverted: false, originalType: type, outputType: type, notes: [] }
  }

  if (type === 'image/webp') {
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      bitmap.close()

      return new Promise((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({
                file: null, wasConverted: false,
                originalType: type, outputType: null, error: true,
                notes: ['WEBP conversion failed — canvas.toBlob returned null.'],
              })
              return
            }
            const base = file.name.replace(/\.[^.]+$/, '')
            const converted = new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
            resolve({
              file: converted, wasConverted: true,
              originalType: 'image/webp', outputType: 'image/jpeg',
              notes: ['Converted WEBP to JPEG for Pl@ntNet compatibility.'],
            })
          },
          'image/jpeg',
          0.92
        )
      })
    } catch (err) {
      return {
        file: null, wasConverted: false,
        originalType: type, outputType: null, error: true,
        notes: [`WEBP conversion failed: ${err.message ?? 'unknown error'}`],
      }
    }
  }

  // Unsupported type — caller decides how to surface the error
  return { file: null, wasConverted: false, originalType: type, outputType: null, error: true, notes: [] }
}
