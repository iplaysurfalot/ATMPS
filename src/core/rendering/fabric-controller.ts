import {
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  PencilBrush,
  Point,
  Rect,
  type TPointerEventInfo
} from 'fabric'
import type { EditorSession } from '../editor/session'
import type { AtmpsDocument, Layer, ToolId } from '@shared/types'

const LAYER_ID_KEY = 'atmpsLayerId'

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
  private onRasterStrokeEnd: ((layerId: string, png: Uint8Array) => void) | null = null

  constructor(canvasEl: HTMLCanvasElement, session: EditorSession) {
    this.session = session
    this.canvas = new Canvas(canvasEl, {
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '#2a2d34',
      fireRightClick: true,
      stopContextMenu: true
    })

    this.canvas.on('object:modified', (e) => this.handleObjectModified(e.target))
    this.canvas.on('object:moving', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('object:scaling', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('object:rotating', (e) => this.handleObjectTransforming(e.target))
    this.canvas.on('selection:created', (e) => this.handleSelection(e.selected?.[0]))
    this.canvas.on('selection:updated', (e) => this.handleSelection(e.selected?.[0]))
    this.canvas.on('selection:cleared', () => {
      // Avoid history spam on clear; UI can still show last active.
    })
    this.canvas.on('mouse:down', (opt) => this.handleMouseDown(opt))
    this.canvas.on('mouse:move', (opt) => this.handleMouseMove(opt))
    this.canvas.on('mouse:up', () => this.handleMouseUp())
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

  setTool(tool: ToolId, brushSize: number, brushColor: string): void {
    const brush = new PencilBrush(this.canvas)
    brush.width = brushSize
    brush.color = brushColor

    if (tool === 'brush') {
      this.canvas.isDrawingMode = true
      this.canvas.freeDrawingBrush = brush
      this.canvas.selection = false
      this.canvas.defaultCursor = 'crosshair'
    } else if (tool === 'eraser') {
      this.canvas.isDrawingMode = true
      brush.color = 'rgba(0,0,0,1)'
      // destination-out via custom brush color workaround: draw white then composite
      const eraser = new PencilBrush(this.canvas)
      eraser.width = brushSize
      eraser.color = 'rgba(0,0,0,1)'
      this.canvas.freeDrawingBrush = eraser
      this.canvas.selection = false
      this.canvas.defaultCursor = 'cell'
      // Mark eraser mode on canvas for path handler
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = true
    } else {
      this.canvas.isDrawingMode = false
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = false
      this.canvas.selection = tool === 'select'
      this.canvas.defaultCursor = tool === 'pan' ? 'grab' : 'default'
      this.canvas.forEachObject((obj) => {
        const selectable = tool === 'select'
        obj.selectable = selectable
        obj.evented = selectable || tool === 'text'
      })
    }

    if (tool !== 'eraser') {
      ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = false
    }
  }

  setZoom(zoom: number, center?: { x: number; y: number }): void {
    const point = center
      ? new Point(center.x, center.y)
      : new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2)
    this.canvas.zoomToPoint(point, zoom)
    this.canvas.requestRenderAll()
  }

  resizeViewport(width: number, height: number): void {
    this.canvas.setDimensions({ width, height })
    this.canvas.requestRenderAll()
  }

  async syncFromDocument(doc: AtmpsDocument, assetUrls: Record<string, string>): Promise<void> {
    if (this.dragLayerId) return
    this.syncing = true
    try {
      const keepSelection = this.canvas.getActiveObject()?.get(LAYER_ID_KEY) as string | undefined
      this.canvas.clear()
      this.canvas.backgroundColor = '#2a2d34'

      // Document background rect
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

      for (const layer of doc.layers) {
        if (!layer.visible) continue
        const obj = await this.createObjectForLayer(layer, assetUrls)
        if (obj) {
          obj.set({ opacity: layer.opacity })
          obj.set(LAYER_ID_KEY, layer.id)
          obj.set({
            selectable: !layer.locked,
            evented: !layer.locked
          })
          this.canvas.add(obj)
        }
      }

      if (keepSelection) {
        const match = this.canvas.getObjects().find((o) => o.get(LAYER_ID_KEY) === keepSelection)
        if (match) this.canvas.setActiveObject(match)
      }
      this.canvas.requestRenderAll()
    } finally {
      this.syncing = false
    }
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
    if (!layerId || layerId === '__background__') return
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
    // Do NOT push history or sync React-heavy state each move — preview only.
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

  private handleMouseDown(opt: TPointerEventInfo): void {
    const tool = this.session.getSnapshot().tool
    const point = pointerClient(opt.e)
    if (!point) return
    if (tool === 'pan' || this.spacePan) {
      this.panLast = point
      this.canvas.setCursor('grabbing')
    }
  }

  private handleMouseMove(opt: TPointerEventInfo): void {
    if (!this.panLast) return
    const point = pointerClient(opt.e)
    if (!point) return
    const vpt = this.canvas.viewportTransform
    if (!vpt) return
    const dx = point.x - this.panLast.x
    const dy = point.y - this.panLast.y
    vpt[4] += dx
    vpt[5] += dy
    this.panLast = point
    this.canvas.requestRenderAll()
  }

  private handleMouseUp(): void {
    this.panLast = null
  }

  setSpacePan(active: boolean): void {
    this.spacePan = active
    if (active) this.canvas.defaultCursor = 'grab'
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
    if (isEraser) {
      path.set({ globalCompositeOperation: 'destination-out', stroke: 'rgba(0,0,0,1)' })
    }

    // Bake stroke into active/new raster layer, then remove free path.
    const layerId = this.session.ensureRasterLayer()
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
      })
    }

    // Draw path into bake canvas using fabric path bounding relative to document.
    const pathCanvas = document.createElement('canvas')
    pathCanvas.width = doc.width
    pathCanvas.height = doc.height
    const temp = new Canvas(pathCanvas, { width: doc.width, height: doc.height })
    temp.add(path)
    temp.renderAll()
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out'
    }
    ctx.drawImage(pathCanvas, 0, 0)
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

    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, doc.width, doc.height)

    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      const t = layer.transform
      ctx.translate(t.x, t.y)
      ctx.rotate((t.rotation * Math.PI) / 180)
      ctx.scale(t.scaleX, t.scaleY)

      if (layer.kind === 'image' || layer.kind === 'raster') {
        const url = assetUrls[layer.assetId]
        if (url) {
          await drawImage(ctx, url, layer.kind === 'image' ? layer.naturalWidth : layer.width, layer.kind === 'image' ? layer.naturalHeight : layer.height)
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
