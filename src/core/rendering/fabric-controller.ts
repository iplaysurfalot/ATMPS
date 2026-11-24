import {
  Canvas,
  Circle,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Path,
  Pattern,
  Point,
  Rect,
  Shadow,
  type TPointerEventInfo
} from 'fabric'
import type { EditorSession } from '../editor/session'
import type {
  AtmpsDocument,
  BlendMode,
  Layer,
  MarqueeSelection,
  RasterLayer,
  ToolId
} from '@shared/types'
import {
  applyLinearGradient,
  cutSelection,
  floodFill,
  hexToRgbaTuple,
  imageDataToPng,
  loadImageData,
  pasteImageData,
  rgbaToHex,
  samplePixel
} from './raster-ops'
import {
  bakeOverlayOntoLayer,
  renderStrokePreview,
  stampSegment,
  type BrushStrokeParams,
  type SelectionClip
} from './stroke-engine'

const LAYER_ID_KEY = 'atmpsLayerId'
const DOC_FRAME_KEY = 'atmpsDocFrame'
const BRUSH_CURSOR_KEY = '__brushCursor__'
const MARQUEE_KEY = '__marquee__'
const LASSO_KEY = '__lasso__'
const CROP_KEY = '__crop__'
const FLOAT_KEY = '__floatSel__'

const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion'
}

/**
 * Fabric is a view. Document model remains source of truth.
 * Brush/eraser: stroke buffer on overlay → bake once to layer bitmap → one history delta.
 * Never remount the Fabric scene for selection or asset-only paint updates.
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
  private lassoPoints: { x: number; y: number }[] = []
  private lassoPath: Path | null = null
  private cropStart: { x: number; y: number } | null = null
  private cropRect: Rect | null = null
  private gradientStart: { x: number; y: number } | null = null
  private gradientLine: Rect | null = null
  private polyPoints: { x: number; y: number }[] = []
  private cloneSource: { x: number; y: number } | null = null
  private zoomDragStart: { y: number; zoom: number } | null = null
  private onRasterStrokeEnd: ((layerId: string, png: Uint8Array) => void) | null = null
  private checkerPattern: Pattern | null = null
  /** After an in-place stroke update, skip the next React-driven full resync (prevents blink). */
  private ignoreNextExternalSync = false
  private brushCursor: Circle | null = null
  private antsOffset = 0
  private antsRaf = 0
  private activeStroke: {
    overlay: HTMLCanvasElement
    overlayCtx: CanvasRenderingContext2D
    preview: HTMLCanvasElement
    baseImage: HTMLImageElement | null
    layer: RasterLayer
    isNewLayer: boolean
    promoteFromImage: boolean
    params: BrushStrokeParams
    lastStamped: { x: number; y: number } | null
    clip: SelectionClip | null
    sourceUrl: string | null
    previewObj: FabricImage | null
    raf: number
  } | null = null
  private selectionFloat: {
    imageData: ImageData
    origin: MarqueeSelection
    fabricImg: FabricImage
    startDoc: { x: number; y: number }
    layerId: string
    baseData: ImageData
    restoreUrl: string
    layerMeta: {
      id: string
      width: number
      height: number
      transform: Layer['transform']
      opacity: number
      blendMode?: BlendMode
      locked?: boolean
    }
  } | null = null

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
    this.canvas.on('mouse:down', (opt) => void this.handleMouseDown(opt))
    this.canvas.on('mouse:move', (opt) => void this.handleMouseMove(opt))
    this.canvas.on('mouse:up', (opt) => void this.handleMouseUp(opt))
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

    this.startMarchingAnts()
  }

  dispose(): void {
    if (this.antsRaf) cancelAnimationFrame(this.antsRaf)
    this.canvas.dispose()
  }

  getFabricCanvas(): Canvas {
    return this.canvas
  }

  setRasterStrokeHandler(handler: (layerId: string, png: Uint8Array) => void): void {
    this.onRasterStrokeEnd = handler
  }

  setTool(
    tool: ToolId,
    brushSize: number,
    brushColor: string,
    brushOpacity = 100,
    brushHardness = 100,
    brushFlow = 100
  ): void {
    // Mid-stroke: only nudge size/hardness for the *next* dab — never rebuild tool mode.
    if (this.activeStroke && (tool === 'brush' || tool === 'eraser')) {
      const rgb = hexToRgb(brushColor)
      this.activeStroke.params = {
        size: brushSize,
        hardness: brushHardness,
        opacity: brushOpacity,
        flow: brushFlow,
        color: rgb,
        eraser: tool === 'eraser'
      }
      this.ensureBrushCursor(brushSize)
      return
    }

    this.canvas.isDrawingMode = false
    ;(this.canvas as Canvas & { __atmpsEraser?: boolean }).__atmpsEraser = tool === 'eraser'

    if (tool === 'brush' || tool === 'eraser' || tool === 'clone') {
      this.canvas.selection = false
      this.canvas.defaultCursor = 'none'
      this.ensureBrushCursor(brushSize)
      this.canvas.forEachObject((obj) => {
        const id = obj.get(LAYER_ID_KEY) as string | undefined
        if (!id || id.startsWith('__') || id === DOC_FRAME_KEY) {
          obj.selectable = false
          obj.evented = false
          return
        }
        obj.selectable = false
        obj.evented = false
      })
      return
    }

    this.hideBrushCursor()
    this.canvas.selection = tool === 'move'
    this.canvas.defaultCursor =
      tool === 'hand'
        ? 'grab'
        : tool === 'zoom'
          ? 'zoom-in'
          : tool === 'marquee' ||
              tool === 'lasso' ||
              tool === 'polylasso' ||
              tool === 'crop' ||
              tool === 'eyedropper'
            ? 'crosshair'
            : tool === 'bucket' || tool === 'gradient'
              ? 'cell'
              : 'default'
    this.canvas.forEachObject((obj) => {
      const id = obj.get(LAYER_ID_KEY) as string | undefined
      if (
        id === '__background__' ||
        id === DOC_FRAME_KEY ||
        id === MARQUEE_KEY ||
        id === LASSO_KEY ||
        id === CROP_KEY ||
        id === BRUSH_CURSOR_KEY ||
        id === FLOAT_KEY
      ) {
        obj.selectable = false
        obj.evented = false
        return
      }
      const selectable = tool === 'move'
      obj.selectable = selectable
      obj.evented = selectable || tool === 'text'
    })
  }

  /** Selection overlay only — never clears the Fabric scene. */
  syncSelectionOverlay(): void {
    this.drawMarqueeOverlay()
    this.canvas.requestRenderAll()
  }

  /** Live opacity / blend without remount. */
  applyLayerVisuals(
    layerId: string,
    visuals: { opacity?: number; blendMode?: BlendMode }
  ): void {
    const obj = this.canvas.getObjects().find((o) => o.get(LAYER_ID_KEY) === layerId)
    if (!obj) return
    if (visuals.opacity !== undefined) obj.set({ opacity: visuals.opacity })
    if (visuals.blendMode !== undefined) {
      obj.set({ globalCompositeOperation: BLEND_TO_COMPOSITE[visuals.blendMode] })
    }
    this.canvas.requestRenderAll()
  }

  /**
   * Cancel an in-progress selection move (Esc): restore cut hole, drop float.
   * Returns true if a float was cancelled.
   */
  async cancelSelectionFloat(): Promise<boolean> {
    const float = this.selectionFloat
    if (!float) return false
    this.canvas.remove(float.fabricImg)
    await this.upsertRasterLayerImage(float.layerMeta, float.restoreUrl)
    this.selectionFloat = null
    this.drawMarqueeOverlay()
    this.canvas.requestRenderAll()
    return true
  }

  isStrokeActive(): boolean {
    return this.activeStroke !== null
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
    const vpt = this.canvas.viewportTransform
    if (!vpt) {
      return { x: clientX - rect.left, y: clientY - rect.top }
    }
    const x = (clientX - rect.left - vpt[4]) / vpt[0]
    const y = (clientY - rect.top - vpt[5]) / vpt[3]
    return { x, y }
  }

  /**
   * Refresh image/raster object sources in place (no canvas.clear).
   * Used for undo/redo of brush strokes and other asset-only updates.
   */
  async refreshAssetUrls(doc: AtmpsDocument, assetUrls: Record<string, string>): Promise<void> {
    if (this.activeStroke) return
    if (this.ignoreNextExternalSync) {
      this.ignoreNextExternalSync = false
      return
    }
    for (const layer of doc.layers) {
      if (layer.kind !== 'image' && layer.kind !== 'raster') continue
      if (!layer.visible) continue
      const url = assetUrls[layer.assetId]
      if (!url) continue
      await this.upsertRasterLayerImage(
        layer.kind === 'raster'
          ? layer
          : {
              id: layer.id,
              width: layer.naturalWidth,
              height: layer.naturalHeight,
              transform: layer.transform,
              opacity: layer.opacity,
              blendMode: layer.blendMode,
              locked: layer.locked
            },
        url
      )
    }
  }

  async syncFromDocument(doc: AtmpsDocument, assetUrls: Record<string, string>): Promise<void> {
    if (this.dragLayerId) return
    if (this.activeStroke) return
    if (this.ignoreNextExternalSync) {
      this.ignoreNextExternalSync = false
      return
    }
    this.syncing = true
    try {
      if (this.selectionFloat) {
        this.canvas.remove(this.selectionFloat.fabricImg)
        this.selectionFloat = null
      }
      const keepSelection = this.canvas.getActiveObject()?.get(LAYER_ID_KEY) as string | undefined
      this.canvas.clear()
      this.brushCursor = null
      this.marqueeRect = null
      this.lassoPath = null
      this.cropRect = null
      this.canvas.backgroundColor = '#1e1e1e'

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

  private startMarchingAnts(): void {
    const tick = () => {
      this.antsOffset = (this.antsOffset + 0.4) % 16
      const sel = this.session.getSnapshot().selection
      if (!sel) {
        this.antsRaf = requestAnimationFrame(tick)
        return
      }
      // Animate both white and black underlay dashes (Photoshop dual-ant look).
      for (const obj of this.canvas.getObjects()) {
        const key = obj.get(LAYER_ID_KEY) as string | undefined
        if (key !== MARQUEE_KEY && key !== LASSO_KEY) continue
        const stroke = obj.stroke
        const offset = stroke === '#000000' || stroke === '#000' ? 4 - this.antsOffset : -this.antsOffset
        obj.set({ strokeDashOffset: offset })
      }
      this.canvas.requestRenderAll()
      this.antsRaf = requestAnimationFrame(tick)
    }
    this.antsRaf = requestAnimationFrame(tick)
  }

  private drawMarqueeOverlay(): void {
    this.removeOverlayByKey(MARQUEE_KEY)
    this.removeOverlayByKey(LASSO_KEY)
    const sel = this.session.getSnapshot().selection
    if (!sel || sel.width === 0 || sel.height === 0) {
      this.marqueeRect = null
      this.lassoPath = null
      return
    }

    if (sel.points && sel.points.length >= 3) {
      const d =
        sel.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
      this.lassoPath = new Path(d, {
        fill: 'rgba(70,147,236,0.06)',
        stroke: '#ffffff',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.lassoPath.set(LAYER_ID_KEY, LASSO_KEY)
      this.canvas.add(this.lassoPath)
      // Black ants underneath for PS-like dual dash
      const under = new Path(d, {
        fill: '',
        stroke: '#000000',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        strokeDashOffset: 4,
        selectable: false,
        evented: false
      })
      under.set(LAYER_ID_KEY, LASSO_KEY)
      this.canvas.add(under)
      this.marqueeRect = null
      return
    }

    this.marqueeRect = new Rect({
      left: sel.x,
      top: sel.y,
      width: sel.width,
      height: sel.height,
      fill: 'rgba(70,147,236,0.06)',
      stroke: '#ffffff',
      strokeWidth: 1 / Math.max(0.01, this.canvas.getZoom()),
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false
    })
    this.marqueeRect.set(LAYER_ID_KEY, MARQUEE_KEY)
    this.canvas.add(this.marqueeRect)
    const under = new Rect({
      left: sel.x,
      top: sel.y,
      width: sel.width,
      height: sel.height,
      fill: '',
      stroke: '#000000',
      strokeWidth: 1 / Math.max(0.01, this.canvas.getZoom()),
      strokeDashArray: [4, 4],
      strokeDashOffset: 4,
      selectable: false,
      evented: false
    })
    under.set(LAYER_ID_KEY, MARQUEE_KEY)
    this.canvas.add(under)
  }

  private removeOverlayByKey(key: string): void {
    const doomed = this.canvas.getObjects().filter((o) => o.get(LAYER_ID_KEY) === key)
    for (const o of doomed) this.canvas.remove(o)
  }

  private ensureBrushCursor(size: number): void {
    if (!this.brushCursor) {
      this.brushCursor = new Circle({
        radius: size / 2,
        fill: '',
        stroke: '#ffffff',
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        excludeFromExport: true
      })
      this.brushCursor.set(LAYER_ID_KEY, BRUSH_CURSOR_KEY)
      this.canvas.add(this.brushCursor)
    } else {
      this.brushCursor.set({ radius: Math.max(0.5, size / 2) })
    }
    // Black outline for contrast
    this.brushCursor.set({
      stroke: '#ffffff',
      shadow: new Shadow({ color: '#000000', blur: 0, offsetX: 1, offsetY: 0 })
    })
    this.canvas.bringObjectToFront(this.brushCursor)
  }

  private hideBrushCursor(): void {
    if (this.brushCursor) {
      this.canvas.remove(this.brushCursor)
      this.brushCursor = null
    }
  }

  private updateBrushCursor(docPt: { x: number; y: number }): void {
    const snap = this.session.getSnapshot()
    if (snap.tool !== 'brush' && snap.tool !== 'eraser' && snap.tool !== 'clone') return
    this.ensureBrushCursor(snap.brushSize)
    if (!this.brushCursor) return
    this.brushCursor.set({
      left: docPt.x,
      top: docPt.y,
      radius: snap.brushSize / 2,
      strokeWidth: 1 / Math.max(0.01, this.canvas.getZoom())
    })
    this.brushCursor.setCoords()
    this.canvas.bringObjectToFront(this.brushCursor)
    this.canvas.requestRenderAll()
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

  private async handleMouseDown(opt: TPointerEventInfo): Promise<void> {
    const tool = this.session.getSnapshot().tool
    const point = pointerClient(opt.e)
    if (!point) return
    const docPt = this.clientToDocument(point.x, point.y)

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

    if (tool === 'eyedropper') {
      await this.sampleAt(docPt)
      return
    }

    if (tool === 'bucket') {
      await this.bucketFillAt(docPt)
      return
    }

    if (tool === 'clone') {
      if (opt.e instanceof MouseEvent && opt.e.altKey) {
        this.cloneSource = docPt
        this.session.setStatus(
          `Clone source ${Math.round(docPt.x)}, ${Math.round(docPt.y)}`
        )
        return
      }
      if (!this.cloneSource) {
        this.session.setStatus('Alt+click to set clone source first')
        return
      }
      await this.cloneStampAt(docPt)
      return
    }

    if (tool === 'polylasso') {
      const dbl = opt.e instanceof MouseEvent && opt.e.detail >= 2
      if (dbl && this.polyPoints.length >= 3) {
        this.finishPolygonSelection(this.polyPoints)
        this.polyPoints = []
        this.removeOverlayByKey(LASSO_KEY)
        this.lassoPath = null
        return
      }
      this.polyPoints.push(docPt)
      const d = this.polyPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ')
      this.removeOverlayByKey(LASSO_KEY)
      this.lassoPath = new Path(d, {
        fill: 'rgba(70,147,236,0.06)',
        stroke: '#ffffff',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.lassoPath.set(LAYER_ID_KEY, LASSO_KEY)
      this.canvas.add(this.lassoPath)
      this.canvas.requestRenderAll()
      return
    }

    if (tool === 'gradient') {
      this.gradientStart = docPt
      this.gradientLine = new Rect({
        left: docPt.x,
        top: docPt.y,
        width: 1,
        height: 1,
        fill: 'rgba(70,147,236,0.35)',
        selectable: false,
        evented: false
      })
      this.canvas.add(this.gradientLine)
      return
    }

    if (tool === 'marquee') {
      this.marqueeStart = docPt
      this.removeOverlayByKey(MARQUEE_KEY)
      this.removeOverlayByKey(LASSO_KEY)
      this.marqueeRect = new Rect({
        left: docPt.x,
        top: docPt.y,
        width: 0,
        height: 0,
        fill: 'rgba(70,147,236,0.08)',
        stroke: '#ffffff',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.marqueeRect.set(LAYER_ID_KEY, MARQUEE_KEY)
      this.canvas.add(this.marqueeRect)
      this.canvas.requestRenderAll()
      return
    }

    if (tool === 'lasso') {
      this.lassoPoints = [docPt]
      this.removeOverlayByKey(MARQUEE_KEY)
      this.removeOverlayByKey(LASSO_KEY)
      this.lassoPath = new Path(`M ${docPt.x} ${docPt.y}`, {
        fill: 'rgba(70,147,236,0.06)',
        stroke: '#ffffff',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.lassoPath.set(LAYER_ID_KEY, LASSO_KEY)
      this.canvas.add(this.lassoPath)
      return
    }

    if (tool === 'crop') {
      this.cropStart = docPt
      this.removeOverlayByKey(CROP_KEY)
      this.cropRect = new Rect({
        left: docPt.x,
        top: docPt.y,
        width: 0,
        height: 0,
        fill: 'rgba(0,0,0,0.35)',
        stroke: '#f0c14b',
        strokeWidth: 1 / this.canvas.getZoom(),
        selectable: false,
        evented: false
      })
      this.cropRect.set(LAYER_ID_KEY, CROP_KEY)
      this.canvas.add(this.cropRect)
      return
    }

    if (tool === 'brush' || tool === 'eraser') {
      await this.beginStroke(docPt, tool === 'eraser')
      return
    }

    if (tool === 'move') {
      const sel = this.session.getSnapshot().selection
      if (sel && pointInSelection(docPt, sel)) {
        await this.beginSelectionMove(docPt, sel)
      }
    }
  }

  private async handleMouseMove(opt: TPointerEventInfo): Promise<void> {
    const point = pointerClient(opt.e)
    if (!point) return
    const docPt = this.clientToDocument(point.x, point.y)

    const snap = this.session.getSnapshot()
    if (snap.tool === 'brush' || snap.tool === 'eraser' || snap.tool === 'clone') {
      this.updateBrushCursor(docPt)
    }

    if (this.activeStroke) {
      this.continueStroke(docPt)
      return
    }

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

    if (this.selectionFloat) {
      const dx = docPt.x - this.selectionFloat.startDoc.x
      const dy = docPt.y - this.selectionFloat.startDoc.y
      const o = this.selectionFloat.origin
      this.selectionFloat.fabricImg.set({
        left: o.x + dx,
        top: o.y + dy
      })
      this.selectionFloat.fabricImg.setCoords()
      if (this.marqueeRect) {
        this.marqueeRect.set({ left: o.x + dx, top: o.y + dy })
        this.marqueeRect.setCoords()
      }
      this.canvas.requestRenderAll()
      return
    }

    if (this.marqueeStart && this.marqueeRect) {
      const x = Math.min(this.marqueeStart.x, docPt.x)
      const y = Math.min(this.marqueeStart.y, docPt.y)
      const w = Math.abs(docPt.x - this.marqueeStart.x)
      const h = Math.abs(docPt.y - this.marqueeStart.y)
      this.marqueeRect.set({ left: x, top: y, width: w, height: h })
      this.marqueeRect.setCoords()
      this.canvas.requestRenderAll()
      return
    }

    if (this.lassoPoints.length && this.lassoPath) {
      this.lassoPoints.push(docPt)
      const d =
        this.lassoPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      // Rebuild path geometry cheaply
      this.canvas.remove(this.lassoPath)
      this.lassoPath = new Path(d, {
        fill: 'rgba(70,147,236,0.06)',
        stroke: '#ffffff',
        strokeWidth: 1 / this.canvas.getZoom(),
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false
      })
      this.lassoPath.set(LAYER_ID_KEY, LASSO_KEY)
      this.canvas.add(this.lassoPath)
      this.canvas.requestRenderAll()
      return
    }

    if (this.cropStart && this.cropRect) {
      const x = Math.min(this.cropStart.x, docPt.x)
      const y = Math.min(this.cropStart.y, docPt.y)
      const w = Math.abs(docPt.x - this.cropStart.x)
      const h = Math.abs(docPt.y - this.cropStart.y)
      this.cropRect.set({ left: x, top: y, width: w, height: h })
      this.cropRect.setCoords()
      this.canvas.requestRenderAll()
      return
    }

    if (this.gradientStart && this.gradientLine) {
      const x = Math.min(this.gradientStart.x, docPt.x)
      const y = Math.min(this.gradientStart.y, docPt.y)
      const w = Math.max(1, Math.abs(docPt.x - this.gradientStart.x))
      const h = Math.max(1, Math.abs(docPt.y - this.gradientStart.y))
      this.gradientLine.set({ left: x, top: y, width: w, height: h })
      this.gradientLine.setCoords()
      this.canvas.requestRenderAll()
    }
  }

  private async handleMouseUp(opt: TPointerEventInfo): Promise<void> {
    this.panLast = null
    this.zoomDragStart = null
    const point = pointerClient(opt.e)
    const docPt = point ? this.clientToDocument(point.x, point.y) : null

    if (this.activeStroke) {
      if (docPt) this.continueStroke(docPt)
      await this.endStroke()
      return
    }

    if (this.selectionFloat && docPt) {
      await this.commitSelectionMove(docPt)
      return
    }

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
        this.marqueeRect = null
      }
      this.marqueeStart = null
      return
    }

    if (this.lassoPoints.length >= 3) {
      const xs = this.lassoPoints.map((p) => p.x)
      const ys = this.lassoPoints.map((p) => p.y)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      const width = Math.max(...xs) - x
      const height = Math.max(...ys) - y
      if (width > 1 && height > 1) {
        this.session.setSelection({
          x,
          y,
          width,
          height,
          points: [...this.lassoPoints]
        })
      } else {
        this.session.clearSelection()
      }
      this.lassoPoints = []
      return
    }
    this.lassoPoints = []

    if (this.cropStart && this.cropRect) {
      const left = this.cropRect.left ?? 0
      const top = this.cropRect.top ?? 0
      const width = this.cropRect.width ?? 0
      const height = this.cropRect.height ?? 0
      this.cropStart = null
      if (width > 2 && height > 2) {
        this.session.setSelection({ x: left, y: top, width, height })
        this.session.setStatus('Crop ready — press Enter to apply')
      } else {
        this.removeOverlayByKey(CROP_KEY)
        this.cropRect = null
      }
      return
    }

    if (this.gradientStart && docPt) {
      const start = this.gradientStart
      this.gradientStart = null
      if (this.gradientLine) {
        this.canvas.remove(this.gradientLine)
        this.gradientLine = null
      }
      await this.applyGradient(start, docPt)
    }
  }

  setSpacePan(active: boolean): void {
    this.spacePan = active
    if (active) {
      this.canvas.defaultCursor = 'grab'
      this.canvas.isDrawingMode = false
      this.canvas.selection = false
      this.hideBrushCursor()
    }
  }

  async applyPendingCrop(): Promise<void> {
    const sel = this.session.getSnapshot().selection
    if (!sel || sel.width < 2 || sel.height < 2) return
    this.ignoreNextExternalSync = false
    await this.session.cropToRect(sel)
    this.removeOverlayByKey(CROP_KEY)
    this.cropRect = null
  }

  private finishPolygonSelection(points: { x: number; y: number }[]): void {
    if (points.length < 3) return
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const width = Math.max(...xs) - x
    const height = Math.max(...ys) - y
    if (width <= 1 || height <= 1) return
    this.session.setSelection({
      x,
      y,
      width,
      height,
      points: points.map((p) => ({ ...p }))
    })
  }

  /** Single clone stamp dab (Alt+click sets source). */
  private async cloneStampAt(docPt: { x: number; y: number }): Promise<void> {
    if (!this.cloneSource) return
    const snap = this.session.getSnapshot()
    const radius = Math.max(1, snap.brushSize / 2)
    const soft = Math.max(0, (100 - snap.brushHardness) / 100)
    const dx = docPt.x - this.cloneSource.x
    const dy = docPt.y - this.cloneSource.y
    this.ignoreNextExternalSync = true
    const result = await this.session.applyRasterPixelEdit('Clone stamp', (data) => {
      const px = data.data
      const r0 = Math.ceil(radius)
      for (let oy = -r0; oy <= r0; oy++) {
        for (let ox = -r0; ox <= r0; ox++) {
          const dist = Math.sqrt(ox * ox + oy * oy)
          if (dist > radius) continue
          const tx = Math.floor(docPt.x + ox)
          const ty = Math.floor(docPt.y + oy)
          const sx = Math.floor(tx - dx)
          const sy = Math.floor(ty - dy)
          if (tx < 0 || ty < 0 || tx >= data.width || ty >= data.height) continue
          if (sx < 0 || sy < 0 || sx >= data.width || sy >= data.height) continue
          const edge = soft > 0.01 ? Math.max(0, 1 - dist / radius) ** (1 + soft * 3) : 1
          const si = (sy * data.width + sx) * 4
          const di = (ty * data.width + tx) * 4
          const sa = (px[si + 3] / 255) * edge * (snap.brushOpacity / 100)
          const da = px[di + 3] / 255
          const outA = sa + da * (1 - sa)
          if (outA <= 0) {
            px[di] = 0
            px[di + 1] = 0
            px[di + 2] = 0
            px[di + 3] = 0
            continue
          }
          px[di] = Math.round((px[si] * sa + px[di] * da * (1 - sa)) / outA)
          px[di + 1] = Math.round((px[si + 1] * sa + px[di + 1] * da * (1 - sa)) / outA)
          px[di + 2] = Math.round((px[si + 2] * sa + px[di + 2] * da * (1 - sa)) / outA)
          px[di + 3] = Math.round(outA * 255)
        }
      }
    })
    if (result) {
      const layer = this.session.getDocument()?.layers.find((l) => l.id === result.layerId)
      if (layer && (layer.kind === 'raster' || layer.kind === 'image')) {
        await this.upsertRasterLayerImage(
          layer.kind === 'raster'
            ? layer
            : {
                id: layer.id,
                width: layer.naturalWidth,
                height: layer.naturalHeight,
                transform: layer.transform,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                locked: layer.locked
              },
          result.url
        )
      }
    }
  }

  private async sampleAt(docPt: { x: number; y: number }): Promise<void> {
    const doc = this.session.getDocument()
    if (!doc) return
    // Sample flattened view at point via export canvas of visible layers
    const snap = this.session.getSnapshot()
    const bytes = await this.exportFlattened(doc, snap.assetUrls, 'png')
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }))
    try {
      const data = await loadImageData(url, doc.width, doc.height)
      const px = samplePixel(data, docPt.x, docPt.y)
      if (!px || px[3] === 0) {
        this.session.setStatus('Sampled transparent')
        return
      }
      const hex = rgbaToHex(px[0], px[1], px[2])
      this.session.setBrushColor(hex)
      this.session.setStatus(`Sampled ${hex}`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  private async bucketFillAt(docPt: { x: number; y: number }): Promise<void> {
    const snap = this.session.getSnapshot()
    const fill = hexToRgbaTuple(snap.brushColor, Math.round((snap.brushOpacity / 100) * 255))
    this.ignoreNextExternalSync = true
    const result = await this.session.applyRasterPixelEdit('Paint bucket', (data) => {
      floodFill(data, docPt.x, docPt.y, fill, snap.fillTolerance)
    })
    if (result) {
      const layer = this.session.getDocument()?.layers.find((l) => l.id === result.layerId)
      if (layer && (layer.kind === 'raster' || layer.kind === 'image')) {
        await this.upsertRasterLayerImage(
          layer.kind === 'raster'
            ? layer
            : {
                id: layer.id,
                width: layer.naturalWidth,
                height: layer.naturalHeight,
                transform: layer.transform,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                locked: layer.locked
              },
          result.url
        )
      }
    }
  }

  private async applyGradient(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): Promise<void> {
    const snap = this.session.getSnapshot()
    const c0 = hexToRgbaTuple(snap.brushColor, Math.round((snap.brushOpacity / 100) * 255))
    const c1: [number, number, number, number] = [c0[0], c0[1], c0[2], 0]
    const clip = snap.selection ?? undefined
    this.ignoreNextExternalSync = true
    const result = await this.session.applyRasterPixelEdit('Gradient', (data) => {
      applyLinearGradient(data, start.x, start.y, end.x, end.y, c0, c1, clip)
    })
    if (result) {
      const layer = this.session.getDocument()?.layers.find((l) => l.id === result.layerId)
      if (layer && (layer.kind === 'raster' || layer.kind === 'image')) {
        await this.upsertRasterLayerImage(
          layer.kind === 'raster'
            ? layer
            : {
                id: layer.id,
                width: layer.naturalWidth,
                height: layer.naturalHeight,
                transform: layer.transform,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                locked: layer.locked
              },
          result.url
        )
      }
    }
  }

  private async beginStroke(docPt: { x: number; y: number }, eraser: boolean): Promise<void> {
    const doc = this.session.getDocument()
    if (!doc || this.activeStroke) return

    const target = await this.session.prepareRasterStrokeTarget()
    if (!target) return

    const layer = target.layer
    const w = layer.width
    const h = layer.height
    const overlay = document.createElement('canvas')
    overlay.width = w
    overlay.height = h
    const overlayCtx = overlay.getContext('2d', { willReadFrequently: true })
    if (!overlayCtx) return

    const preview = document.createElement('canvas')
    preview.width = w
    preview.height = h

    let baseImage: HTMLImageElement | null = null
    if (target.sourceUrl) {
      try {
        baseImage = await loadHtmlImage(target.sourceUrl)
      } catch {
        baseImage = null
      }
    }

    const snap = this.session.getSnapshot()
    const params: BrushStrokeParams = {
      size: snap.brushSize,
      hardness: snap.brushHardness,
      opacity: snap.brushOpacity,
      flow: snap.brushFlow,
      color: hexToRgb(snap.brushColor),
      eraser
    }
    const clip: SelectionClip | null =
      snap.selection && snap.selection.width > 0 && snap.selection.height > 0
        ? {
            x: snap.selection.x,
            y: snap.selection.y,
            width: snap.selection.width,
            height: snap.selection.height,
            points: snap.selection.points
          }
        : null

    // Map doc point → layer bitmap space (inverse of layer transform).
    const local = docToLayerPoint(docPt, layer)
    // Prefer updating an existing FabricImage in place for live preview.
    const existing = this.canvas
      .getObjects()
      .find((o) => o.get(LAYER_ID_KEY) === layer.id) as FabricImage | undefined

    this.activeStroke = {
      overlay,
      overlayCtx,
      preview,
      baseImage,
      layer,
      isNewLayer: target.isNewLayer,
      promoteFromImage: Boolean(target.promoteFromImage),
      params,
      lastStamped: null,
      clip: clip
        ? {
            ...clip,
            x: clip.x - layer.transform.x,
            y: clip.y - layer.transform.y,
            points: clip.points?.map((p) => ({
              x: p.x - layer.transform.x,
              y: p.y - layer.transform.y
            }))
          }
        : null,
      sourceUrl: target.sourceUrl,
      previewObj: existing ?? null,
      raf: 0
    }
    this.activeStroke.lastStamped = stampSegment(
      overlayCtx,
      local,
      local,
      params,
      this.activeStroke.clip,
      null
    )
    this.scheduleStrokePreview()
  }

  private continueStroke(docPt: { x: number; y: number }): void {
    const stroke = this.activeStroke
    if (!stroke) return
    const local = docToLayerPoint(docPt, stroke.layer)
    const from = stroke.lastStamped ?? local
    stroke.lastStamped = stampSegment(
      stroke.overlayCtx,
      from,
      local,
      stroke.params,
      stroke.clip,
      stroke.lastStamped
    )
    this.scheduleStrokePreview()
  }

  /** Coalesce live previews to one RAF — never encode PNG while dragging. */
  private scheduleStrokePreview(): void {
    const stroke = this.activeStroke
    if (!stroke || stroke.raf) return
    stroke.raf = requestAnimationFrame(() => {
      if (!this.activeStroke) return
      this.activeStroke.raf = 0
      this.paintStrokePreviewFrame()
    })
  }

  private paintStrokePreviewFrame(): void {
    const stroke = this.activeStroke
    if (!stroke) return
    renderStrokePreview(
      stroke.preview,
      stroke.baseImage,
      stroke.overlay,
      stroke.params.opacity,
      stroke.params.eraser
    )

    const layer = stroke.layer
    const t = layer.transform
    if (stroke.previewObj) {
      stroke.previewObj.setElement(stroke.preview)
      stroke.previewObj.set({
        left: t.x,
        top: t.y,
        scaleX: (layer.width / (stroke.preview.width || layer.width || 1)) * t.scaleX,
        scaleY: (layer.height / (stroke.preview.height || layer.height || 1)) * t.scaleY,
        angle: t.rotation,
        opacity: layer.opacity
      })
      stroke.previewObj.setCoords()
      stroke.previewObj.dirty = true
    } else {
      const img = new FabricImage(stroke.preview, {
        left: t.x,
        top: t.y,
        scaleX: t.scaleX,
        scaleY: t.scaleY,
        angle: t.rotation,
        originX: 'left',
        originY: 'top',
        opacity: layer.opacity,
        selectable: false,
        evented: false
      })
      img.set(LAYER_ID_KEY, layer.id)
      this.canvas.add(img)
      stroke.previewObj = img
    }
    if (this.brushCursor) this.canvas.bringObjectToFront(this.brushCursor)
    this.canvas.requestRenderAll()
  }

  private async endStroke(): Promise<void> {
    const stroke = this.activeStroke
    if (!stroke) return
    if (stroke.raf) {
      cancelAnimationFrame(stroke.raf)
      stroke.raf = 0
    }
    // Final preview frame so bake matches what the user saw.
    this.paintStrokePreviewFrame()
    this.activeStroke = null

    const w = stroke.layer.width
    const h = stroke.layer.height
    const layerData = stroke.sourceUrl
      ? await loadImageData(stroke.sourceUrl, w, h)
      : new ImageData(w, h)

    bakeOverlayOntoLayer(
      layerData,
      stroke.overlay,
      stroke.params.opacity,
      stroke.params.eraser
    )
    const bytes = await imageDataToPng(layerData)

    this.ignoreNextExternalSync = true
    const committed = this.session.commitRasterStroke({
      layer: stroke.layer,
      isNewLayer: stroke.isNewLayer,
      bytes,
      label: stroke.params.eraser ? 'Eraser stroke' : 'Brush stroke',
      promoteFromImage: stroke.promoteFromImage
    })
    this.onRasterStrokeEnd?.(committed.layerId, bytes)
    await this.upsertRasterLayerImage(stroke.layer, committed.url)
    if (this.brushCursor) this.canvas.bringObjectToFront(this.brushCursor)
  }

  private async beginSelectionMove(
    docPt: { x: number; y: number },
    sel: MarqueeSelection
  ): Promise<void> {
    const prepared = await this.session.ensurePaintTargetLayer()
    if (!prepared || prepared.isNewLayer) return
    const layer = prepared.layer
    const width = layer.kind === 'image' ? layer.naturalWidth : layer.width
    const height = layer.kind === 'image' ? layer.naturalHeight : layer.height
    if (!prepared.url) return

    const restoreUrl = prepared.url
    const data = await loadImageData(prepared.url, width, height)
    const cut = cutSelection(data, sel, sel.points)

    // Visual hole only — session assets untouched until mouseup commit or Esc cancel.
    const clearedBytes = await imageDataToPng(data)
    const clearedUrl = URL.createObjectURL(
      new Blob([clearedBytes.buffer as ArrayBuffer], { type: 'image/png' })
    )
    const layerMeta = {
      id: layer.id,
      width,
      height,
      transform: layer.transform,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      locked: layer.locked
    }
    await this.upsertRasterLayerImage(layerMeta, clearedUrl)

    const floatCanvas = document.createElement('canvas')
    floatCanvas.width = cut.width
    floatCanvas.height = cut.height
    floatCanvas.getContext('2d')?.putImageData(cut, 0, 0)
    const floatUrl = floatCanvas.toDataURL('image/png')
    const fabricImg = await FabricImage.fromURL(floatUrl)
    fabricImg.set({
      left: sel.x,
      top: sel.y,
      selectable: false,
      evented: false
    })
    fabricImg.set(LAYER_ID_KEY, FLOAT_KEY)
    this.canvas.add(fabricImg)
    this.selectionFloat = {
      imageData: cut,
      origin: { ...sel, points: sel.points ? sel.points.map((p) => ({ ...p })) : undefined },
      fabricImg,
      startDoc: docPt,
      layerId: layer.id,
      baseData: data,
      restoreUrl,
      layerMeta
    }
  }

  private async commitSelectionMove(docPt: { x: number; y: number }): Promise<void> {
    const float = this.selectionFloat
    if (!float) return

    const dx = docPt.x - float.startDoc.x
    const dy = docPt.y - float.startDoc.y
    const destX = float.origin.x + dx
    const destY = float.origin.y + dy
    pasteImageData(float.baseData, float.imageData, destX, destY)
    const bytes = await imageDataToPng(float.baseData)
    this.canvas.remove(float.fabricImg)

    const layerMeta = float.layerMeta
    const layerId = float.layerId
    this.selectionFloat = null

    this.ignoreNextExternalSync = true
    const layer = this.session.getDocument()?.layers.find((l) => l.id === layerId)
    if (!layer || (layer.kind !== 'raster' && layer.kind !== 'image')) {
      // Restore visual if commit target vanished
      await this.upsertRasterLayerImage(layerMeta, float.restoreUrl)
      return
    }

    if (layer.kind === 'raster') {
      const committed = this.session.commitRasterStroke({
        layer,
        isNewLayer: false,
        bytes,
        label: 'Move selection'
      })
      await this.upsertRasterLayerImage(layer, committed.url)
    } else {
      const result = await this.session.applyRasterPixelEdit('Move selection', (data) => {
        data.data.set(float.baseData.data)
      })
      if (result) {
        await this.upsertRasterLayerImage(layerMeta, result.url)
      } else {
        await this.upsertRasterLayerImage(layerMeta, float.restoreUrl)
        return
      }
    }

    const newSel: MarqueeSelection = {
      x: destX,
      y: destY,
      width: float.origin.width,
      height: float.origin.height,
      points: float.origin.points?.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    }
    this.session.setSelection(newSel)
  }

  /** Legacy Fabric free-draw path — unused; brush uses overlay stroke buffer. */
  private async handlePathCreated(opt: { path?: FabricObject }): Promise<void> {
    const path = opt.path
    if (path) this.canvas.remove(path)
  }

  /**
   * Update or insert a single raster FabricImage without clearing other layers.
   */
  async upsertRasterLayerImage(
    layer: {
      id: string
      width: number
      height: number
      transform: Layer['transform']
      opacity: number
      blendMode?: BlendMode
      locked?: boolean
    },
    url: string
  ): Promise<void> {
    const existing = this.canvas
      .getObjects()
      .find((o) => o.get(LAYER_ID_KEY) === layer.id) as FabricImage | undefined

    if (existing && existing instanceof FabricImage) {
      await existing.setSrc(url, { crossOrigin: 'anonymous' })
      existing.set({
        left: layer.transform.x,
        top: layer.transform.y,
        scaleX: (layer.width / (existing.width || layer.width || 1)) * layer.transform.scaleX,
        scaleY: (layer.height / (existing.height || layer.height || 1)) * layer.transform.scaleY,
        angle: layer.transform.rotation,
        opacity: layer.opacity,
        globalCompositeOperation: BLEND_TO_COMPOSITE[layer.blendMode ?? 'normal']
      })
      existing.setCoords()
      this.canvas.requestRenderAll()
      return
    }

    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    img.set({
      left: layer.transform.x,
      top: layer.transform.y,
      scaleX: (layer.width / (img.width || layer.width || 1)) * layer.transform.scaleX,
      scaleY: (layer.height / (img.height || layer.height || 1)) * layer.transform.scaleY,
      angle: layer.transform.rotation,
      originX: 'left',
      originY: 'top',
      opacity: layer.opacity,
      globalCompositeOperation: BLEND_TO_COMPOSITE[layer.blendMode ?? 'normal'],
      selectable: !(layer.locked ?? false),
      evented: !(layer.locked ?? false)
    })
    img.set(LAYER_ID_KEY, layer.id)
    this.canvas.add(img)
    this.canvas.requestRenderAll()
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

function pointInSelection(pt: { x: number; y: number }, sel: MarqueeSelection): boolean {
  if (sel.points && sel.points.length >= 3) {
    let inside = false
    for (let i = 0, j = sel.points.length - 1; i < sel.points.length; j = i++) {
      const xi = sel.points[i]!.x
      const yi = sel.points[i]!.y
      const xj = sel.points[j]!.x
      const yj = sel.points[j]!.y
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + Number.EPSILON) + xi
      if (intersect) inside = !inside
    }
    return inside
  }
  return (
    pt.x >= sel.x &&
    pt.y >= sel.y &&
    pt.x <= sel.x + sel.width &&
    pt.y <= sel.y + sel.height
  )
}

function pointerClient(e: Event): { x: number; y: number } | null {
  if ('clientX' in e && typeof (e as MouseEvent).clientX === 'number') {
    const me = e as MouseEvent
    return { x: me.clientX, y: me.clientY }
  }
  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0
  ]
}

/** Document space → layer bitmap space (translation-only; scale/rotate identity for paint layers). */
function docToLayerPoint(
  pt: { x: number; y: number },
  layer: { transform: Layer['transform']; width: number; height: number }
): { x: number; y: number } {
  const t = layer.transform
  let x = pt.x - t.x
  let y = pt.y - t.y
  if (t.rotation !== 0) {
    const rad = (-t.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rx = x * cos - y * sin
    const ry = x * sin + y * cos
    x = rx
    y = ry
  }
  if (t.scaleX !== 0) x /= t.scaleX
  if (t.scaleY !== 0) y /= t.scaleY
  return { x, y }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = url
  })
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
