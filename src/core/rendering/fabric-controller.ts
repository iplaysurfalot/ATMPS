import {
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Pattern,
  PencilBrush,
  Point,
  Rect,
  type TPointerEventInfo
} from 'fabric'
import type { EditorSession } from '../editor/session'
import type { AtmpsDocument, BlendMode, Layer, ToolId } from '@shared/types'

const LAYER_ID_KEY = 'atmpsLayerId'
const DOC_FRAME_KEY = 'atmpsDocFrame'

const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen'
}

/**
 * Fabric is a view. Document model remains source of truth.
 * Pointer-move transforms update Fabric objects only; document commits on mouse-up.
 */
export class FabricController {
  private canvas: Canvas
  private session: EditorSession
  private syncing = false
  private panLast: { x: number; y: number } | null = null
  private spacePan = false
  private dragLayerId: string | null = null
  private marqueeStart: { x: number; y: number } | null = null
  private marqueeRect: Rect | null = null
  private zoomDragStart: { y: number; zoom: number } | null = null
  private onRasterStrokeEnd: ((layerId: string, png: Uint8Array) => void) | null = null
  private checkerPattern: Pattern | null = null

  constructor(canvasEl: HTMLCanvasElement, session: EditorSession) {
    this.session = session
    this.canvas = new Canvas(canvasEl, {
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '#1e1e1e',
      fireRightClick: true,
      stopContextMenu: true,
      uniformScaling: false,
      centeredScaling: false
    })

    // Photoshop-like selection chrome
    FabricObject.prototype.set({
      borderColor: '#4693ec',
      cornerColor: '#ffffff',
      cornerStrokeColor: '#4693ec',
      cornerStyle: 'rect',
      cornerSize: 8,
      transparentCorners: false,
      borderScaleFactor: 1.5,
      padding: 0
    })

    this.canvas.on('object:modified', (e) => this.handleObjectModified(e.target))
    this.canvas.on('object:moving', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('object:scaling', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('object:rotating', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('selection:created', (e) => this.handleSelection(e.selected?.[0]))
    this.canvas.on('selection:updated', (e) => this.handleSelection(e.selected?.[0]))
    this.canvas.on('selection:cleared', () => {})
    this.canvas.on('mouse:down', (opt) => this.handleMouseDown(opt))
    this.canvas.on('mouse:move', (opt) => this.handleMouseMove(opt))
    this.canvas.on('mouse:up', (opt) => this.handleMouseUp(opt))
    this.canvas.on('mouse:wheel', (opt) => this.handleWheel(opt))
    this.canvas.on('path:created', (opt) => {
      void this.handlePathCreated(opt as { path?: FabricObject })
    })
    this.canvas.on('text:editing:exited', (e) => {
      const target = e.target as IText | undefined
      if (!target) return
      const layerId = target.get(LAYER_ID_KEY) as string | undefined
      if (!layerId) return
      this.session.patchLayer(layerId, { text: target.text ?? '' } as Partial<Layer>, 'Edit text')
    })
  }

  dispose(): void {
    this.canvas.dispose()
  }

  getFabricCanvas(): Canvas {
    return this.canvas
  }

  setRasterStrokeHandler(handler: (layerId: string, png: Uint8Array) => void): void {
    this.onRasterStrokeEnd = handler
  }

  setTool(tool: ToolId, brushSize: number, brushColor: string, brushOpacity = 100, brushHardness = 100): void {
    const alpha = Math.max(0.01, brushOpacity / 100)
    const color = hexToRgba(brushColor, alpha)

    if (tool === 'brush') {
      const brush = new PencilBrush(this.canvas)
      brush.width = brushSize
      brush.color = color
      brush.shadow = null
      void brushHardness
      this.canvas.isDrawingMode = true
      this.canvas.freeDrawingBrush = brush
      this.canvas.selection = false
      this.canvas.defaultCursor = 'crosshair'
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = false
    } else if (tool === 'eraser') {
      const eraser = new PencilBrush(this.canvas)
      eraser.width = brushSize
      eraser.color = 'rgba(0,0,0,1)'
      this.canvas.isDrawingMode = true
      this.canvas.freeDrawingBrush = eraser
      this.canvas.selection = false
      this.canvas.defaultCursor = 'cell'
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = true
    } else {
      this.canvas.isDrawingMode = false
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = false
      this.canvas.selection = tool === 'move'
      this.canvas.defaultCursor =
        tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : tool === 'marquee' ? 'crosshair' : 'default'
      this.canvas.forEachObject((obj) => {
        const id = obj.get(LAYER_ID_KEY) as string | undefined
        if (id === '__background__' || id === DOC_FRAME_KEY || id === '__marquee__') {
          obj.selectable = false
          obj.evented = false
          return
        }
        const selectable = tool === 'move'
        obj.selectable = selectable
        obj.evented = selectable || tool === 'text'
      })
    }
  }

  setZoom(zoom: number, center?: { x: number; y: number }): void {
    const point = center
      ? new Point(center.x, center.y)
      : new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2)
    this.canvas.zoomToPoint(point, zoom)
    this.canvas.requestRenderAll()
  }

  zoomToFit(docWidth: number, docHeight: number, padding = 48): number {
    const vw = this.canvas.getWidth()
    const vh = this.canvas.getHeight()
    const scale = Math.min((vw - padding * 2) / docWidth, (vh - padding * 2) / docHeight, 1)
    const zoom = Math.max(0.05, scale)
    this.canvas.setZoom(zoom)
    const vpt = this.canvas.viewportTransform
    if (vpt) {
      vpt[4] = (vw - docWidth * zoom) / 2
      vpt[5] = (vh - docHeight * zoom) / 2
    }
    this.canvas.requestRenderAll()
    return zoom
  }

  zoomToActual(docWidth: number, docHeight: number): number {
    this.canvas.setZoom(1)
    const vw = this.canvas.getWidth()
    const vh = this.canvas.getHeight()
    const vpt = this.canvas.viewportTransform
    if (vpt) {
      vpt[4] = (vw - docWidth) / 2
      vpt[5] = (vh - docHeight) / 2
    }
    this.canvas.requestRenderAll()
    return 1
  }

  resizeViewport(width: number, height: number): void {
    this.canvas.setDimensions({ width, height })
    this.canvas.requestRenderAll()
  }

  clientToDocument(clientX: number, clientY: number): { x: number; y: number } {
    const el = this.canvas.getElement()
    const rect = el.getBoundingClientRect()
    const point = this.canvas.getScenePoint({
      clientX,
      clientY,
      // fabric expects offset relative to canvas element in some paths
    } as unknown as MouseEvent)
    // Fallback manual transform
    const vpt = this.canvas.viewportTransform
    if (!vpt) {
      return { x: clientX - rect.left, y: clientY - rect.top }
    }
    const x = (clientX - rect.left - vpt[4]) / vpt[0]
    const y = (clientY - rect.top - vpt[5]) / vpt[3]
    return { x, y }
  }

  async syncFromDocument(doc: AtmpsDocument, assetUrls: Record<string, string>): Promise<void> {
    if (this.dragLayerId) return
    this.syncing = true
    try {
      const keepSelection = this.canvas.getActiveObject()?.get(LAYER_ID_KEY) as string | undefined
      this.canvas.clear()
      this.canvas.backgroundColor = '#1e1e1e'

      // Checkerboard under transparent document
      const checker = this.getCheckerPattern()
      const frame = new Rect({
        left: 0,
        top: 0,
        width: doc.width,
        height: doc.height,
        fill: checker ?? '#cccccc',
        selectable: false,
        evented: false,
        hoverCursor: 'default'
      })
      frame.set(LAYER_ID_KEY, DOC_FRAME_KEY)
      this.canvas.add(frame)

      // Document background (may be transparent)
      if (doc.background && doc.background !== 'transparent') {
        const bg = new Rect({
          left: 0,
          top: 0,
          width: doc.width,
          height: doc.height,
          fill: doc.background,
          selectable: false,
          evented: false,
          hoverCursor: 'default'
        })
        bg.set(LAYER_ID_KEY, '__background__')
        this.canvas.add(bg)
      }

      for (const layer of doc.layers) {
        if (!layer.visible) continue
        const obj = await this.createObjectForLayer(layer, assetUrls)
        if (obj) {
          obj.set({
            opacity: layer.opacity,
            globalCompositeOperation: BLEND_TO_COMPOSITE[layer.blendMode ?? 'normal']
          })
          obj.set(LAYER_ID_KEY, layer.id)
          obj.set({
            selectable: !layer.locked,
            evented: !layer.locked
          })
          this.canvas.add(obj)
        }
      }

      this.drawMarqueeOverlay()

      if (keepSelection) {
        const match = this.canvas.getObjects().find((o) => o.get(LAYER_ID_KEY) === keepSelection)
        if (match) this.canvas.setActiveObject(match)
      }
      this.canvas.requestRenderAll()
    } finally {
      this.syncing = false
    }
  }

  private getCheckerPattern(): Pattern | null {
    if (this.checkerPattern) return this.checkerPattern
    const size = 8
    const c = document.createElement('canvas')
    c.width = size * 2
    c.height = size * 2
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size * 2, size * 2)
    ctx.fillStyle = '#c8c8c8'
    ctx.fillRect(0, 0, size, size)
    ctx.fillRect(size, size, size, size)
    this.checkerPattern = new Pattern({ source: c, repeat: 'repeat' })
    return this.checkerPattern
  }

  private drawMarqueeOverlay(): void {
    const sel = this.session.getSnapshot().selection
    if (!sel || sel.width === 0 || sel.height === 0) return
    const outline = new Rect({
      left: sel.x,
      top: sel.y,
      width: sel.width,
      height: sel.height,
      fill: 'rgba(70,147,236,0.08)',
      stroke: '#4693ec',
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false
    })
    outline.set(LAYER_ID_KEY, '__marquee__')
    this.canvas.add(outline)
  }

  private async createObjectForLayer(
    layer: Layer,
    assetUrls: Record<string, string>
  ): Promise<FabricObject | null> {
    const t = layer.transform
    if (layer.kind === 'image' || layer.kind === 'raster') {
      const url = assetUrls[layer.assetId]
      if (!url) return null
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
      if (layer.kind === 'image') {
        img.set({
          left: t.x,
          top: t.y,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          angle: t.rotation,
          originX: 'left',
          originY: 'top'
        })
      } else {
        img.set({
          left: t.x,
          top: t.y,
          scaleX: (layer.width / (img.width || 1)) * t.scaleX,
          scaleY: (layer.height / (img.height || 1)) * t.scaleY,
          angle: t.rotation,
          originX: 'left',
          originY: 'top'
        })
      }
      return img
    }

    if (layer.kind === 'shape') {
      if (layer.shape === 'ellipse') {
        return new Ellipse({
          left: t.x,
          top: t.y,
          rx: layer.width / 2,
          ry: layer.height / 2,
          fill: layer.fill,
          stroke: layer.stroke,
          strokeWidth: layer.strokeWidth,
          scaleX: t.scaleX,
          scaleY: t.scaleY,
          angle: t.rotation,
          originX: 'left',
          originY: 'top'
        })
      }
      return new Rect({
        left: t.x,
        top: t.y,
        width: layer.width,
        height: layer.height,
        fill: layer.fill,
        stroke: layer.stroke,
        strokeWidth: layer.strokeWidth,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        angle: t.rotation,
        originX: 'left',
        originY: 'top'
      })
    }

    if (layer.kind === 'text') {
      return new IText(layer.text, {
        left: t.x,
        top: t.y,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fill: layer.fill,
        fontWeight: layer.fontWeight,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        angle: t.rotation,
        originX: 'left',
        originY: 'top'
      })
    }

    return null
  }

  private handleSelection(obj?: FabricObject): void {
    if (this.syncing || !obj) return
    const layerId = obj.get(LAYER_ID_KEY) as string | undefined
    if (!layerId || layerId === '__background__' || layerId === DOC_FRAME_KEY) return
    const doc = this.session.getDocument()
    if (doc?.activeLayerId !== layerId) {
      this.session.selectLayer(layerId)
    }
  }

  private handleObjectTransforming(obj?: FabricObject): void {
    if (this.syncing || !obj) return
    const layerId = obj.get(LAYER_ID_KEY) as string | undefined
    if (!layerId || layerId === '__background__') return
    this.dragLayerId = layerId
    this.session.applyTransform(layerId, {
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
      rotation: obj.angle ?? 0
    })
  }

  private handleObjectModified(obj?: FabricObject): void {
    if (this.syncing || !obj) return
    const layerId = obj.get(LAYER_ID_KEY) as string | undefined
    if (!layerId || layerId === '__background__') return
    this.dragLayerId = null
    this.session.applyTransform(
      layerId,
      {
        x: obj.left ?? 0,
        y: obj.top ?? 0,
        scaleX: obj.scaleX ?? 1,
        scaleY: obj.scaleY ?? 1,
        rotation: obj.angle ?? 0
      },
      'Transform'
    )
  }

  private handleWheel(opt: TPointerEventInfo & { e: WheelEvent }): void {
    const e = opt.e
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY
    const zoom = this.canvas.getZoom()
    const next = Math.min(32, Math.max(0.05, zoom * (delta > 0 ? 0.9 : 1.1)))
    const el = this.canvas.getElement()
    const rect = el.getBoundingClientRect()
    const point = new Point(e.clientX - rect.left, e.clientY - rect.top)
    this.canvas.zoomToPoint(point, next)
    this.session.setZoom(next)
    this.canvas.requestRenderAll()
  }

  private handleMouseDown(opt: TPointerEventInfo): void {
    const tool = this.session.getSnapshot().tool
    const point = pointerClient(opt.e)
    if (!point) return

    if (tool === 'hand' || this.spacePan) {
      this.panLast = point
      this.canvas.setCursor('grabbing')
      return
    }

    if (tool === 'zoom') {
      const snap = this.session.getSnapshot()
      const doc = snap.document
      if (!doc) return
      const el = this.canvas.getElement()
      const rect = el.getBoundingClientRect()
      const center = { x: point.x - rect.left, y: point.y - rect.top }
      if (opt.e instanceof MouseEvent && opt.e.altKey) {
        const next = Math.max(0.05, snap.zoom / 1.25)
        this.setZoom(next, center)
        this.session.setZoom(next)
      } else {
        const next = Math.min(32, snap.zoom * 1.25)
        this.setZoom(next, center)
        this.session.setZoom(next)
      }
      return
    }

    if (tool === 'marquee') {
      const docPt = this.clientToDocument(point.x, point.y)
      this.marqueeStart = docPt
      if (this.marqueeRect) {
        this.canvas.remove(this.marqueeRect)
        this.marqueeRect = null
      }
      this.marqueeRect = new Rect({
        left: docPt.x,
        top: docPt.y,
        width: 0,
        height: 0,
        fill: 'rgba(70,147,236,0.12)',
        stroke: '#4693ec',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.marqueeRect.set(LAYER_ID_KEY, '__marquee__')
      this.canvas.add(this.marqueeRect)
      this.canvas.requestRenderAll()
    }
  }

  private handleMouseMove(opt: TPointerEventInfo): void {
    const point = pointerClient(opt.e)
    if (!point) return

    if (this.panLast) {
      const vpt = this.canvas.viewportTransform
      if (!vpt) return
      const dx = point.x - this.panLast.x
      const dy = point.y - this.panLast.y
      vpt[4] += dx
      vpt[5] += dy
      this.panLast = point
      this.canvas.requestRenderAll()
      return
    }

    if (this.marqueeStart && this.marqueeRect) {
      const docPt = this.clientToDocument(point.x, point.y)
      const x = Math.min(this.marqueeStart.x, docPt.x)
      const y = Math.min(this.marqueeStart.y, docPt.y)
      const w = Math.abs(docPt.x - this.marqueeStart.x)
      const h = Math.abs(docPt.y - this.marqueeStart.y)
      this.marqueeRect.set({ left: x, top: y, width: w, height: h })
      this.marqueeRect.setCoords()
      this.canvas.requestRenderAll()
    }
  }

  private handleMouseUp(opt: TPointerEventInfo): void {
    this.panLast = null
    this.zoomDragStart = null

    if (this.marqueeStart && this.marqueeRect) {
      const left = this.marqueeRect.left ?? 0
      const top = this.marqueeRect.top ?? 0
      const width = this.marqueeRect.width ?? 0
      const height = this.marqueeRect.height ?? 0
      if (width > 1 && height > 1) {
        this.session.setSelection({ x: left, y: top, width, height })
      } else {
        this.session.clearSelection()
        this.canvas.remove(this.marqueeRect)
      }
      this.marqueeStart = null
      // keep rect as visual until next sync
    }

    void opt
  }

  setSpacePan(active: boolean): void {
    this.spacePan = active
    if (active) {
      this.canvas.defaultCursor = 'grab'
      this.canvas.isDrawingMode = false
      this.canvas.selection = false
    }
  }

  private async handlePathCreated(opt: { path?: FabricObject }): Promise<void> {
    const path = opt.path
    if (!path) return

    const doc = this.session.getDocument()
    if (!doc) {
      this.canvas.remove(path)
      return
    }

    const isEraser = Boolean((this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser)
    const snap = this.session.getSnapshot()

    const layerId = await this.session.ensureRasterLayer()
    const layer = this.session.getDocument()?.layers.find((l) => l.id === layerId)
    if (!layer || layer.kind !== 'raster') {
      this.canvas.remove(path)
      return
    }

    const url = this.session.getSnapshot().assetUrls[layer.assetId]
    const bakeCanvas = document.createElement('canvas')
    bakeCanvas.width = doc.width
    bakeCanvas.height = doc.height
    const ctx = bakeCanvas.getContext('2d')
    if (!ctx) {
      this.canvas.remove(path)
      return
    }

    if (url) {
      await new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, doc.width, doc.height)
          resolve()
        }
        img.onerror = () => reject(new Error('Failed to load raster'))
        img.src = url
      }).catch(() => {
        /* empty layer */
      })
    }

    // Stroke path onto bake canvas with correct composite
    const pathCanvas = document.createElement('canvas')
    pathCanvas.width = doc.width
    pathCanvas.height = doc.height
    const temp = new Canvas(pathCanvas, { width: doc.width, height: doc.height })
    // Clone path without viewport transform — path is already in scene coords
    path.set({
      stroke: isEraser ? 'rgba(0,0,0,1)' : hexToRgba(snap.brushColor, snap.brushOpacity / 100),
      fill: '',
      globalCompositeOperation: 'source-over'
    })
    temp.add(path)
    temp.renderAll()

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out'
    } else {
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.drawImage(pathCanvas, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    temp.dispose()

    const blob = await new Promise<Blob | null>((resolve) =>
      bakeCanvas.toBlob((b) => resolve(b), 'image/png')
    )
    this.canvas.remove(path)
    if (!blob) return
    const buf = new Uint8Array(await blob.arrayBuffer())
    this.session.replaceAssetBytes(layer.assetId, buf, 'image/png')
    this.session.setStatus(isEraser ? 'Erased' : 'Brush stroke')
    this.onRasterStrokeEnd?.(layerId, buf)
    await this.syncFromDocument(this.session.getDocument()!, this.session.getSnapshot().assetUrls)
  }

  async exportFlattened(
    doc: AtmpsDocument,
    assetUrls: Record<string, string>,
    format: 'png' | 'jpeg',
    quality = 0.92
  ): Promise<Uint8Array> {
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = doc.width
    exportCanvas.height = doc.height
    const ctx = exportCanvas.getContext('2d')
    if (!ctx) throw new Error('No 2d context')

    if (format === 'jpeg' || (doc.background && doc.background !== 'transparent')) {
      ctx.fillStyle = doc.background === 'transparent' ? '#ffffff' : doc.background
      ctx.fillRect(0, 0, doc.width, doc.height)
    } else {
      ctx.clearRect(0, 0, doc.width, doc.height)
    }

    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation = BLEND_TO_COMPOSITE[layer.blendMode ?? 'normal']
      const t = layer.transform
      ctx.translate(t.x, t.y)
      ctx.rotate((t.rotation * Math.PI) / 180)
      ctx.scale(t.scaleX, t.scaleY)

      if (layer.kind === 'image' || layer.kind === 'raster') {
        const url = assetUrls[layer.assetId]
        if (url) {
          await drawImage(
            ctx,
            url,
            layer.kind === 'image' ? layer.naturalWidth : layer.width,
            layer.kind === 'image' ? layer.naturalHeight : layer.height
          )
        }
      } else if (layer.kind === 'shape') {
        ctx.fillStyle = layer.fill
        if (layer.shape === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(0, 0, layer.width, layer.height)
        }
      } else if (layer.kind === 'text') {
        ctx.fillStyle = layer.fill
        ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`
        ctx.textBaseline = 'top'
        ctx.fillText(layer.text, 0, 0)
      }
      ctx.restore()
    }

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await new Promise<Blob | null>((resolve) =>
      exportCanvas.toBlob((b) => resolve(b), mime, quality)
    )
    if (!blob) throw new Error('Export failed')
    return new Uint8Array(await blob.arrayBuffer())
  }
}

function pointerClient(e: Event): { x: number; y: number } | null {
  if ('clientX' in e && typeof (e as MouseEvent).clientX === 'number') {
    const me = e as MouseEvent
    return { x: me.clientX, y: me.clientY }
  }
  return null
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  return `rgba(${r},${g},${b},${alpha})`
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  url: string,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width || img.naturalWidth, height || img.naturalHeight)
      resolve()
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = url
  })
}
