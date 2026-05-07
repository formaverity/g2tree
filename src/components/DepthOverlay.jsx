import { useEffect, useRef } from 'react'

/**
 * Turbo-inspired false-colour map.
 * t = 0 → closest (warm red/orange)
 * t = 1 → farthest (deep blue/purple)
 */
function falseColor(t) {
  // Piecewise linear approximation of the turbo colormap
  const r = Math.round(255 * clamp(
    t < 0.25 ? lerp(0.18, 0.97, t / 0.25)     :
    t < 0.5  ? lerp(0.97, 0.95, (t - 0.25) / 0.25) :
    t < 0.75 ? lerp(0.95, 0.12, (t - 0.5)  / 0.25) :
               lerp(0.12, 0.10, (t - 0.75) / 0.25)
  ))
  const g = Math.round(255 * clamp(
    t < 0.25 ? lerp(0.07, 0.78, t / 0.25)     :
    t < 0.5  ? lerp(0.78, 0.98, (t - 0.25) / 0.25) :
    t < 0.75 ? lerp(0.98, 0.35, (t - 0.5)  / 0.25) :
               lerp(0.35, 0.04, (t - 0.75) / 0.25)
  ))
  const b = Math.round(255 * clamp(
    t < 0.25 ? lerp(0.23, 0.21, t / 0.25)     :
    t < 0.5  ? lerp(0.21, 0.07, (t - 0.25) / 0.25) :
    t < 0.75 ? lerp(0.07, 0.77, (t - 0.5)  / 0.25) :
               lerp(0.77, 0.70, (t - 0.75) / 0.25)
  ))
  return [r, g, b]
}

function clamp(v) { return Math.max(0, Math.min(1, v)) }
function lerp(a, b, t) { return a + (b - a) * t }

/**
 * Renders a normalised depth map (Float32Array) as a false-colour canvas
 * overlay, absolutely positioned over its parent container.
 *
 * @param {{ depthData: {depthMap:Float32Array, width:number, height:number}, opacity: number }} props
 */
export default function DepthOverlay({ depthData, opacity = 0.68 }) {
  const canvasRef = useRef()

  useEffect(() => {
    if (!depthData || !canvasRef.current) return

    const { depthMap, width, height } = depthData
    const canvas = canvasRef.current
    canvas.width  = width
    canvas.height = height

    const ctx  = canvas.getContext('2d')
    const imgd = ctx.createImageData(width, height)
    const a    = Math.round(clamp(opacity) * 255)

    for (let i = 0; i < depthMap.length; i++) {
      // Depth Anything V2 outputs inverse depth: high value = closer.
      // Invert so the false-colour map reads: warm = close, cool = far.
      const t = 1 - depthMap[i]
      const [r, g, b] = falseColor(t)
      imgd.data[i * 4]     = r
      imgd.data[i * 4 + 1] = g
      imgd.data[i * 4 + 2] = b
      imgd.data[i * 4 + 3] = a
    }

    ctx.putImageData(imgd, 0, 0)
  }, [depthData, opacity])

  if (!depthData) return null

  return (
    <canvas
      ref={canvasRef}
      className="depth-overlay-canvas"
      aria-hidden="true"
    />
  )
}
