const ANALYSIS_MAX_DIM = 320

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else                h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

// Returns 1=sky, 2=foliage, 3=trunk, 0=other
function classifyPixel(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  if (l > 0.75 && s < 0.2)                              return 1 // bright/hazy sky
  if (l > 0.52 && s < 0.38 && h >= 170 && h <= 275)    return 1 // blue sky
  if (h >= 55  && h <= 168 && s > 0.1 && l > 0.04 && l < 0.78) return 2 // foliage
  if (s < 0.28 && l > 0.08 && l < 0.68)                return 3 // trunk/bark
  return 0
}

/**
 * Analyses a tree photo URL using canvas pixel sampling.
 * Returns normalized (0–1) geometry suitable for SVG overlay.
 *
 * @param {string} imageUrl — blob: or data: URL
 * @returns {Promise<{
 *   imageWidth: number, imageHeight: number,
 *   subjectBounds: {x,y,width,height},
 *   canopyEllipse: {cx,cy,rx,ry},
 *   trunkLine: {x1,y1,x2,y2},
 *   crownPixelWidth: number, crownPixelHeight: number,
 *   canopyDensity: number, asymmetry: number, skyGap: number,
 *   debugOverlayData: {columnProfile:number[], rowProfile:number[], analysisWidth:number, analysisHeight:number}
 * }>}
 */
export function analyzeImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.onload = () => {
      try {
        const imageWidth  = img.naturalWidth
        const imageHeight = img.naturalHeight

        const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(imageWidth, imageHeight))
        const aw = Math.max(1, Math.round(imageWidth  * scale))
        const ah = Math.max(1, Math.round(imageHeight * scale))

        const canvas = document.createElement('canvas')
        canvas.width  = aw
        canvas.height = ah
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, aw, ah)

        const { data } = ctx.getImageData(0, 0, aw, ah)

        // Per-pixel classification
        const labels = new Uint8Array(aw * ah)
        for (let i = 0; i < aw * ah; i++) {
          labels[i] = classifyPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
        }

        // Column and row foliage profiles
        const columnProfile = new Array(aw).fill(0)
        const rowProfile    = new Array(ah).fill(0)
        for (let y = 0; y < ah; y++) {
          for (let x = 0; x < aw; x++) {
            if (labels[y * aw + x] === 2) {
              columnProfile[x]++
              rowProfile[y]++
            }
          }
        }

        const colThresh = ah * 0.04
        const rowThresh = aw * 0.03

        let leftCol = aw, rightCol = 0, topRow = ah, bottomRow = 0
        for (let x = 0; x < aw; x++) {
          if (columnProfile[x] > colThresh) { leftCol = Math.min(leftCol, x); rightCol = Math.max(rightCol, x) }
        }
        for (let y = 0; y < ah; y++) {
          if (rowProfile[y] > rowThresh) { topRow = Math.min(topRow, y); bottomRow = Math.max(bottomRow, y) }
        }

        // Fallback when no foliage detected
        if (leftCol > rightCol) { leftCol = Math.round(aw * 0.1); rightCol = Math.round(aw * 0.9) }
        if (topRow > bottomRow) { topRow  = Math.round(ah * 0.05); bottomRow = Math.round(ah * 0.85) }

        const nx = (v) => v / aw
        const ny = (v) => v / ah

        const subjectBounds = {
          x:      nx(leftCol),
          y:      ny(topRow),
          width:  nx(rightCol - leftCol),
          height: ny(bottomRow - topRow),
        }

        // Canopy = upper 60% of detected crown
        const canopyBottomRow = topRow + Math.round((bottomRow - topRow) * 0.6)
        const cx = (leftCol + rightCol) / 2
        const cy = (topRow + canopyBottomRow) / 2
        const rx = (rightCol - leftCol) / 2 * 1.05
        const ry = (canopyBottomRow - topRow) / 2

        const canopyEllipse = {
          cx: nx(cx), cy: ny(cy),
          rx: nx(rx), ry: ny(ry),
        }

        // Trunk: scan middle 50% of crown width, lower 45% of crown height
        const trunkSearchL = Math.round(leftCol + (rightCol - leftCol) * 0.25)
        const trunkSearchR = Math.round(rightCol - (rightCol - leftCol) * 0.25)
        const trunkSearchT = Math.round(topRow + (bottomRow - topRow) * 0.55)

        let bestTrunkCol   = Math.round(cx)
        let bestTrunkScore = -1
        for (let x = trunkSearchL; x <= trunkSearchR; x++) {
          let score = 0
          for (let y = trunkSearchT; y <= bottomRow; y++) {
            if (labels[y * aw + x] === 3) score++
          }
          if (score > bestTrunkScore) { bestTrunkScore = score; bestTrunkCol = x }
        }

        const trunkLine = {
          x1: nx(bestTrunkCol), y1: ny(trunkSearchT),
          x2: nx(bestTrunkCol), y2: Math.min(ny(bottomRow) + 0.04, 0.99),
        }

        // Canopy density: foliage fraction within canopy bounding box
        let canopyTotal = 0, canopyFoliage = 0
        for (let y = topRow; y <= canopyBottomRow; y++) {
          for (let x = leftCol; x <= rightCol; x++) {
            canopyTotal++
            if (labels[y * aw + x] === 2) canopyFoliage++
          }
        }
        const canopyDensity = canopyTotal > 0 ? canopyFoliage / canopyTotal : 0

        // Asymmetry: left vs right foliage mass
        let leftMass = 0, rightMass = 0
        for (let y = topRow; y <= bottomRow; y++) {
          for (let x = leftCol; x <= rightCol; x++) {
            if (labels[y * aw + x] === 2) {
              if (x < cx) leftMass++; else rightMass++
            }
          }
        }
        const totalMass = leftMass + rightMass
        const asymmetry = totalMass > 0 ? Math.abs(leftMass - rightMass) / totalMass : 0

        // Sky-gap: sky fraction inside canopy bounding box
        let skyInCanopy = 0
        for (let y = topRow; y <= canopyBottomRow; y++) {
          for (let x = leftCol; x <= rightCol; x++) {
            if (labels[y * aw + x] === 1) skyInCanopy++
          }
        }
        const skyGap = canopyTotal > 0 ? skyInCanopy / canopyTotal : 0

        resolve({
          imageWidth, imageHeight,
          subjectBounds,
          canopyEllipse,
          trunkLine,
          crownPixelWidth:  Math.round((rightCol - leftCol) / scale),
          crownPixelHeight: Math.round((bottomRow - topRow) / scale),
          canopyDensity,
          asymmetry,
          skyGap,
          debugOverlayData: { columnProfile, rowProfile, analysisWidth: aw, analysisHeight: ah },
        })
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => reject(new Error('Image load failed for vision analysis'))
    img.src = imageUrl
  })
}
