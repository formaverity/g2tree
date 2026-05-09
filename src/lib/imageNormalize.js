/**
 * General-purpose capture normalizer — used by BulkCaptureStep before photos
 * enter the session. Targets 1600px long edge at 85% quality.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ blob: Blob, url: string, width: number, height: number }>}
 */
export async function normalizeImageForCapture(file) {
  const MAX_DIM  = 1600
  const QUALITY  = 0.85

  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  const longest = Math.max(width, height)
  if (longest > MAX_DIM) {
    const scale = MAX_DIM / longest
    width  = Math.round(width  * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY))
  const url  = URL.createObjectURL(blob)
  return { blob, url, width, height }
}

const HEIC_MSG =
  'HEIC is not currently supported by Pl@ntNet. Please use browser camera capture or convert to JPG/PNG.'

function isHeicType(type, name) {
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    /\.heic$/i.test(name) ||
    /\.heif$/i.test(name)
  )
}

/**
 * Normalize a photo for Pl@ntNet: resize to maxDimension, convert to JPEG,
 * and iteratively compress until outputBytes <= maxBytes.
 *
 * @returns {{
 *   file: File|null,
 *   wasConverted: boolean,
 *   originalType: string,
 *   originalBytes: number,
 *   outputType: string|null,
 *   outputBytes: number|null,
 *   width: number|null,
 *   height: number|null,
 *   notes: string[],
 *   error: string|null,
 * }}
 */
export async function normalizeImageForPlantNet(file, options = {}) {
  const {
    maxDimension = 1280,
    maxBytes     = 1_200_000,
    qualityStart = 0.86,
    qualityMin   = 0.58,
  } = options

  const result = {
    file:          null,
    wasConverted:  false,
    originalType:  file.type,
    originalBytes: file.size,
    outputType:    null,
    outputBytes:   null,
    width:         null,
    height:        null,
    notes:         [],
    error:         null,
  }

  if (isHeicType(file.type, file.name)) {
    result.error = 'heic'
    result.notes = [HEIC_MSG]
    return result
  }

  const accepted = ['image/jpeg', 'image/png', 'image/webp']
  if (!accepted.includes(file.type)) {
    result.error = 'unsupported'
    result.notes = [`Unsupported image type: ${file.type}`]
    return result
  }

  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap

    const longest     = Math.max(width, height)
    const needsResize = longest > maxDimension
    if (needsResize) {
      const scale = maxDimension / longest
      width  = Math.round(width  * scale)
      height = Math.round(height * scale)
    }

    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    result.width  = width
    result.height = height

    if (needsResize) {
      result.notes.push(`Resized longest edge to ${maxDimension}px.`)
    }

    const blobAt = (q) =>
      new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))

    let quality = qualityStart
    let blob    = await blobAt(quality)

    while (blob && blob.size > maxBytes && quality > qualityMin) {
      quality = Math.max(parseFloat((quality - 0.08).toFixed(2)), qualityMin)
      blob    = await blobAt(quality)
    }

    if (!blob) {
      result.error = 'blob_null'
      result.notes.push('canvas.toBlob returned null.')
      return result
    }

    const origMB = (file.size  / 1_048_576).toFixed(1)
    const outMB  = (blob.size  / 1_048_576).toFixed(1)
    if (blob.size < file.size || file.type !== 'image/jpeg') {
      result.notes.push(`Compressed image from ${origMB} MB to ${outMB} MB for mobile upload.`)
    }

    const base    = file.name.replace(/\.[^.]+$/, '')
    const outFile = new File([blob], `${base}-plantnet.jpg`, { type: 'image/jpeg' })

    result.file         = outFile
    result.wasConverted = true
    result.outputType   = 'image/jpeg'
    result.outputBytes  = blob.size
    return result

  } catch (err) {
    result.error = err.message ?? 'unknown error'
    result.notes.push(`Image processing failed: ${result.error}`)
    return result
  }
}
