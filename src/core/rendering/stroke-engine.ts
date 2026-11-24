/**
 * Photoshop-like brush stroke engine:
 * stamp soft circular dabs into an overlay buffer, then bake once onto the layer.
 */

export interface BrushStrokeParams {
  size: number
  hardness: number
  opacity: number
  flow: number
  color: [number, number, number]
  eraser: boolean
}

export interface SelectionClip {
  x: number
  y: number
  width: number
  height: number
  points?: { x: number; y: number }[]
}

/** Spacing as fraction of brush diameter (PS soft brushes ~25%). */
export function dabSpacing(size: number): number {
  return Math.max(0.5, size * 0.25)
}

/**
 * Stamp one soft circular dab into overlay (alpha channel = coverage).
 * Hardness 100 = hard edge; 0 = full falloff to edge.
 * Flow scales per-dab alpha; opacity is applied at bake time for the stroke.
 */
export function stampDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  params: BrushStrokeParams
): void {
  const radius = Math.max(0.5, params.size / 2)
  const hardness = Math.min(100, Math.max(0, params.hardness)) / 100
  const flow = Math.min(100, Math.max(1, params.flow)) / 100
  const [r, g, b] = params.color

  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
  // Inner solid core grows with hardness; outer edge fades.
  const core = Math.max(0, Math.min(0.999, hardness * 0.92))
  const dabAlpha = flow
  if (params.eraser) {
    grad.addColorStop(0, `rgba(0,0,0,${dabAlpha})`)
    grad.addColorStop(core, `rgba(0,0,0,${dabAlpha})`)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
  } else {
    grad.addColorStop(0, `rgba(${r},${g},${b},${dabAlpha})`)
    grad.addColorStop(core, `rgba(${r},${g},${b},${dabAlpha})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  }

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Stamp dabs along a segment; returns new last stamped point. */
export function stampSegment(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  params: BrushStrokeParams,
  clip: SelectionClip | null,
  lastStamped: { x: number; y: number } | null
): { x: number; y: number } {
  const spacing = dabSpacing(params.size)

  if (!lastStamped) {
    if (pointAllowed(from.x, from.y, clip)) stampDab(ctx, from.x, from.y, params)
    lastStamped = { ...from }
  }

  const startX = lastStamped.x
  const startY = lastStamped.y
  const remDx = to.x - startX
  const remDy = to.y - startY
  const rem = Math.hypot(remDx, remDy)
  if (rem < spacing) return lastStamped

  const rx = remDx / rem
  const ry = remDy / rem
  let stamped = lastStamped
  let d = spacing
  while (d <= rem) {
    const px = startX + rx * d
    const py = startY + ry * d
    if (pointAllowed(px, py, clip)) stampDab(ctx, px, py, params)
    stamped = { x: px, y: py }
    d += spacing
  }
  return stamped
}

export function applyClipPath(
  ctx: CanvasRenderingContext2D,
  clip: SelectionClip | null
): void {
  if (!clip || clip.width <= 0 || clip.height <= 0) return
  ctx.beginPath()
  if (clip.points && clip.points.length >= 3) {
    clip.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
  } else {
    ctx.rect(clip.x, clip.y, clip.width, clip.height)
  }
  ctx.clip()
}

/** Composite overlay onto layer ImageData (brush source-over / eraser destination-out). */
export function bakeOverlayOntoLayer(
  layer: ImageData,
  overlay: HTMLCanvasElement,
  opacity: number,
  eraser: boolean
): void {
  const w = layer.width
  const h = layer.height
  const octx = overlay.getContext('2d')
  if (!octx) return
  const over = octx.getImageData(0, 0, w, h)
  const lp = layer.data
  const op = over.data
  const strokeOpacity = Math.min(1, Math.max(0, opacity / 100))

  for (let i = 0; i < lp.length; i += 4) {
    const oa = (op[i + 3]! / 255) * strokeOpacity
    if (oa <= 0.001) continue
    if (eraser) {
      const da = lp[i + 3]! / 255
      const outA = da * (1 - oa)
      if (outA <= 0.001) {
        lp[i] = 0
        lp[i + 1] = 0
        lp[i + 2] = 0
        lp[i + 3] = 0
      } else {
        lp[i + 3] = Math.round(outA * 255)
      }
    } else {
      const sa = oa
      const da = lp[i + 3]! / 255
      const outA = sa + da * (1 - sa)
      if (outA <= 0) {
        lp[i] = 0
        lp[i + 1] = 0
        lp[i + 2] = 0
        lp[i + 3] = 0
        continue
      }
      lp[i] = Math.round((op[i]! * sa + lp[i]! * da * (1 - sa)) / outA)
      lp[i + 1] = Math.round((op[i + 1]! * sa + lp[i + 1]! * da * (1 - sa)) / outA)
      lp[i + 2] = Math.round((op[i + 2]! * sa + lp[i + 2]! * da * (1 - sa)) / outA)
      lp[i + 3] = Math.round(outA * 255)
    }
  }
}

/** Live preview: draw base layer then overlay (eraser punches). */
export function renderStrokePreview(
  dest: HTMLCanvasElement,
  base: HTMLCanvasElement | ImageBitmap | HTMLImageElement | null,
  overlay: HTMLCanvasElement,
  opacity: number,
  eraser: boolean
): void {
  const ctx = dest.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, dest.width, dest.height)
  if (base) ctx.drawImage(base, 0, 0)
  ctx.save()
  if (eraser) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity / 100))
    ctx.drawImage(overlay, 0, 0)
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity / 100))
    ctx.drawImage(overlay, 0, 0)
  }
  ctx.restore()
}

function pointAllowed(x: number, y: number, clip: SelectionClip | null): boolean {
  if (!clip || clip.width <= 0 || clip.height <= 0) return true
  if (clip.points && clip.points.length >= 3) {
    return pointInPolygon(x, y, clip.points)
  }
  return (
    x >= clip.x &&
    y >= clip.y &&
    x <= clip.x + clip.width &&
    y <= clip.y + clip.height
  )
}

function pointInPolygon(x: number, y: number, points: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]!.x
    const yi = points[i]!.y
    const xj = points[j]!.x
    const yj = points[j]!.y
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}
