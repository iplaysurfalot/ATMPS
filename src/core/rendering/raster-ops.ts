/** Pixel helpers for flood fill, selection clear/move, crop, eyedropper. */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export async function loadImageData(
  url: string,
  width: number,
  height: number
): Promise<ImageData> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No 2d context')
  ctx.clearRect(0, 0, width, height)
  await drawUrl(ctx, url, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export async function imageDataToPng(data: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = data.width
  canvas.height = data.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2d context')
  ctx.putImageData(data, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (!blob) throw new Error('PNG encode failed')
  return new Uint8Array(await blob.arrayBuffer())
}

export function clearRectInImageData(data: ImageData, rect: Rect, points?: Point[]): void {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(data.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(data.height, Math.ceil(rect.y + rect.height))
  const px = data.data
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (points && points.length >= 3 && !pointInPolygon(x + 0.5, y + 0.5, points)) continue
      const i = (y * data.width + x) * 4
      px[i] = 0
      px[i + 1] = 0
      px[i + 2] = 0
      px[i + 3] = 0
    }
  }
}

export function fillRectInImageData(
  data: ImageData,
  rect: Rect,
  rgba: [number, number, number, number],
  points?: Point[]
): void {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(data.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(data.height, Math.ceil(rect.y + rect.height))
  const px = data.data
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (points && points.length >= 3 && !pointInPolygon(x + 0.5, y + 0.5, points)) continue
      const i = (y * data.width + x) * 4
      px[i] = rgba[0]
      px[i + 1] = rgba[1]
      px[i + 2] = rgba[2]
      px[i + 3] = rgba[3]
    }
  }
}

/** Cut rect (or polygon) into a new ImageData of rect size; clear source. */
export function cutSelection(
  data: ImageData,
  rect: Rect,
  points?: Point[]
): ImageData {
  const w = Math.max(1, Math.ceil(rect.width))
  const h = Math.max(1, Math.ceil(rect.height))
  const out = new ImageData(w, h)
  const x0 = Math.floor(rect.x)
  const y0 = Math.floor(rect.y)
  const src = data.data
  const dst = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x
      const sy = y0 + y
      if (sx < 0 || sy < 0 || sx >= data.width || sy >= data.height) continue
      if (points && points.length >= 3 && !pointInPolygon(sx + 0.5, sy + 0.5, points)) continue
      const si = (sy * data.width + sx) * 4
      const di = (y * w + x) * 4
      dst[di] = src[si]
      dst[di + 1] = src[si + 1]
      dst[di + 2] = src[si + 2]
      dst[di + 3] = src[si + 3]
      src[si] = 0
      src[si + 1] = 0
      src[si + 2] = 0
      src[si + 3] = 0
    }
  }
  return out
}

export function pasteImageData(
  dest: ImageData,
  src: ImageData,
  destX: number,
  destY: number
): void {
  const dx0 = Math.floor(destX)
  const dy0 = Math.floor(destY)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = dx0 + x
      const dy = dy0 + y
      if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) continue
      const si = (y * src.width + x) * 4
      if (src.data[si + 3] === 0) continue
      const di = (dy * dest.width + dx) * 4
      // source-over blend
      const sa = src.data[si + 3] / 255
      const da = dest.data[di + 3] / 255
      const outA = sa + da * (1 - sa)
      if (outA <= 0) {
        dest.data[di] = 0
        dest.data[di + 1] = 0
        dest.data[di + 2] = 0
        dest.data[di + 3] = 0
        continue
      }
      dest.data[di] = Math.round(
        (src.data[si] * sa + dest.data[di] * da * (1 - sa)) / outA
      )
      dest.data[di + 1] = Math.round(
        (src.data[si + 1] * sa + dest.data[di + 1] * da * (1 - sa)) / outA
      )
      dest.data[di + 2] = Math.round(
        (src.data[si + 2] * sa + dest.data[di + 2] * da * (1 - sa)) / outA
      )
      dest.data[di + 3] = Math.round(outA * 255)
    }
  }
}

export function floodFill(
  data: ImageData,
  startX: number,
  startY: number,
  fill: [number, number, number, number],
  tolerance = 32
): void {
  const x = Math.floor(startX)
  const y = Math.floor(startY)
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return
  const px = data.data
  const w = data.width
  const h = data.height
  const startI = (y * w + x) * 4
  const tr = px[startI]
  const tg = px[startI + 1]
  const tb = px[startI + 2]
  const ta = px[startI + 3]
  if (colorsMatch(tr, tg, tb, ta, fill[0], fill[1], fill[2], fill[3], 0)) return

  const visited = new Uint8Array(w * h)
  const stack: number[] = [x, y]
  while (stack.length) {
    const cy = stack.pop()!
    const cx = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
    const vi = cy * w + cx
    if (visited[vi]) continue
    visited[vi] = 1
    const i = vi * 4
    if (!colorsMatch(px[i], px[i + 1], px[i + 2], px[i + 3], tr, tg, tb, ta, tolerance)) continue
    px[i] = fill[0]
    px[i + 1] = fill[1]
    px[i + 2] = fill[2]
    px[i + 3] = fill[3]
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1)
  }
}

export function samplePixel(
  data: ImageData,
  x: number,
  y: number
): [number, number, number, number] | null {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  if (ix < 0 || iy < 0 || ix >= data.width || iy >= data.height) return null
  const i = (iy * data.width + ix) * 4
  return [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]]
}

export function applyLinearGradient(
  data: ImageData,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c0: [number, number, number, number],
  c1: [number, number, number, number],
  clip?: Rect
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  const px = data.data
  const left = clip ? Math.max(0, Math.floor(clip.x)) : 0
  const top = clip ? Math.max(0, Math.floor(clip.y)) : 0
  const right = clip ? Math.min(data.width, Math.ceil(clip.x + clip.width)) : data.width
  const bottom = clip ? Math.min(data.height, Math.ceil(clip.y + clip.height)) : data.height
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2))
      const i = (y * data.width + x) * 4
      px[i] = Math.round(c0[0] + (c1[0] - c0[0]) * t)
      px[i + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * t)
      px[i + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * t)
      px[i + 3] = Math.round(c0[3] + (c1[3] - c0[3]) * t)
    }
  }
}

export function cropImageData(data: ImageData, rect: Rect): ImageData {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const w = Math.max(1, Math.min(data.width - x0, Math.ceil(rect.width)))
  const h = Math.max(1, Math.min(data.height - y0, Math.ceil(rect.height)))
  const out = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * data.width + (x0 + x)) * 4
      const di = (y * w + x) * 4
      out.data[di] = data.data[si]
      out.data[di + 1] = data.data[si + 1]
      out.data[di + 2] = data.data[si + 2]
      out.data[di + 3] = data.data[si + 3]
    }
  }
  return out
}

export function hexToRgbaTuple(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
    alpha
  ]
}

export function rgbaToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function colorsMatch(
  r1: number,
  g1: number,
  b1: number,
  a1: number,
  r2: number,
  g2: number,
  b2: number,
  a2: number,
  tol: number
): boolean {
  return (
    Math.abs(r1 - r2) <= tol &&
    Math.abs(g1 - g2) <= tol &&
    Math.abs(b1 - b2) <= tol &&
    Math.abs(a1 - a2) <= tol
  )
}

function pointInPolygon(x: number, y: number, points: Point[]): boolean {
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

function drawUrl(
  ctx: CanvasRenderingContext2D,
  url: string,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)
      resolve()
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = url
  })
}
