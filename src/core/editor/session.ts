import {
  addLayer,
  cloneDocument,
  createAssetRecord,
  createDocument,
  createImageLayer,
  createRasterLayer,
  createShapeLayer,
  createTextLayer,
  duplicateLayer,
  mimeFromPath,
  normalizeDocument,
  removeLayer,
  renameLayer,
  reorderLayer,
  setActiveLayer,
  setLayerBlendMode,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility,
  updateLayer,
  updateLayerTransform
} from '../document/model'
import { HistoryStack, type AssetByteDelta } from '../history/history-stack'
import {
  buildProjectPackage,
  deserializePackage,
  serializePackage
} from '../file/project-io'
import { bytesToBlob } from '../bytes'
import { createId } from '../ids'
import type {
  AssetRecord,
  AtmpsDocument,
  BlendMode,
  CreateDocumentOptions,
  DocumentTabInfo,
  HistoryPanelState,
  ImageLayer,
  Layer,
  MarqueeSelection,
  RasterLayer,
  SerializedProjectPackage,
  ToolId,
  Transform2D
} from '@shared/types'
import {
  clearRectInImageData,
  cropImageData,
  imageDataToPng,
  loadImageData
} from '../rendering/raster-ops'

type PaintLayer = RasterLayer | ImageLayer

export type EditorListener = () => void

interface OpenDocumentState {
  id: string
  history: HistoryStack
  assets: AssetRecord[]
  assetBytes: Record<string, Uint8Array>
  assetUrls: Record<string, string>
  filePath: string | null
  dirty: boolean
}

export interface EditorSnapshot {
  document: AtmpsDocument | null
  documents: DocumentTabInfo[]
  activeDocumentId: string | null
  assets: AssetRecord[]
  assetUrls: Record<string, string>
  filePath: string | null
  dirty: boolean
  tool: ToolId
  previousTool: ToolId
  brushSize: number
  brushHardness: number
  brushOpacity: number
  brushFlow: number
  brushColor: string
  fillTolerance: number
  zoom: number
  showRulers: boolean
  selection: MarqueeSelection | null
  canUndo: boolean
  canRedo: boolean
  historyPanel: HistoryPanelState
  status: string
  toolTip: string
}

const TOOL_STATUS: Record<ToolId, string> = {
  move: 'Move Tool',
  marquee: 'Rectangular Marquee Tool',
  lasso: 'Lasso Tool',
  polylasso: 'Polygonal Lasso Tool',
  crop: 'Crop Tool',
  brush: 'Brush Tool',
  eraser: 'Eraser Tool',
  eyedropper: 'Eyedropper Tool',
  bucket: 'Paint Bucket Tool',
  gradient: 'Gradient Tool',
  clone: 'Clone Stamp Tool',
  text: 'Type Tool',
  rect: 'Rectangle Tool',
  ellipse: 'Ellipse Tool',
  hand: 'Hand Tool',
  zoom: 'Zoom Tool'
}

/**
 * Application session: multi-document workspace + assets + history.
 * Image bytes and history live outside React.
 */
export class EditorSession {
  private openDocs: OpenDocumentState[] = []
  private activeDocumentId: string | null = null
  private tool: ToolId = 'move'
  private previousTool: ToolId = 'move'
  private brushSize = 20
  private brushHardness = 100
  private brushOpacity = 100
  private brushFlow = 100
  private brushColor = '#000000'
  private fillTolerance = 32
  private zoom = 1
  private showRulers = true
  private selection: MarqueeSelection | null = null
  private status = 'Ready'
  private listeners = new Set<EditorListener>()
  /** Cached for useSyncExternalStore — must be referentially stable until emit(). */
  private cachedSnapshot: EditorSnapshot | null = null

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.cachedSnapshot = null
    for (const l of this.listeners) l()
  }

  private active(): OpenDocumentState | null {
    if (!this.activeDocumentId) return null
    return this.openDocs.find((d) => d.id === this.activeDocumentId) ?? null
  }

  getSnapshot(): EditorSnapshot {
    if (!this.cachedSnapshot) {
      const active = this.active()
      const doc = active ? cloneDocument(active.history.document) : null
      this.cachedSnapshot = {
        document: doc,
        documents: this.openDocs.map((d) => ({
          id: d.id,
          name: d.history.document.name,
          dirty: d.dirty,
          width: d.history.document.width,
          height: d.history.document.height,
          filePath: d.filePath
        })),
        activeDocumentId: this.activeDocumentId,
        assets: active ? [...active.assets] : [],
        assetUrls: active ? { ...active.assetUrls } : {},
        filePath: active?.filePath ?? null,
        dirty: active?.dirty ?? false,
        tool: this.tool,
        previousTool: this.previousTool,
        brushSize: this.brushSize,
        brushHardness: this.brushHardness,
        brushOpacity: this.brushOpacity,
        brushFlow: this.brushFlow,
        brushColor: this.brushColor,
        fillTolerance: this.fillTolerance,
        zoom: this.zoom,
        showRulers: this.showRulers,
        selection: this.selection ? { ...this.selection } : null,
        canUndo: active?.history.canUndo ?? false,
        canRedo: active?.history.canRedo ?? false,
        historyPanel: active?.history.getHistoryLabels() ?? {
          past: [],
          current: 'No document',
          future: []
        },
        status: this.status,
        toolTip: TOOL_STATUS[this.tool]
      }
    }
    return this.cachedSnapshot
  }

  getDocument(): AtmpsDocument | null {
    return this.active()?.history.document ?? null
  }

  setStatus(status: string): void {
    this.status = status
    this.emit()
  }

  setTool(tool: ToolId): void {
    if (tool !== 'hand') this.previousTool = this.tool === 'hand' ? this.previousTool : this.tool
    this.tool = tool
    if (tool !== 'marquee') {
      // keep selection when switching away; clear only via Select > Deselect
    }
    this.status = TOOL_STATUS[tool]
    this.emit()
  }

  setTemporaryTool(tool: ToolId): void {
    if (this.tool !== tool) {
      this.previousTool = this.tool
      this.tool = tool
      this.emit()
    }
  }

  restorePreviousTool(): void {
    this.tool = this.previousTool || 'move'
    this.status = TOOL_STATUS[this.tool]
    this.emit()
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.min(500, Math.max(1, size))
    this.emit()
  }

  setBrushHardness(hardness: number): void {
    this.brushHardness = Math.min(100, Math.max(0, hardness))
    this.emit()
  }

  setBrushOpacity(opacity: number): void {
    this.brushOpacity = Math.min(100, Math.max(1, opacity))
    this.emit()
  }

  setBrushFlow(flow: number): void {
    this.brushFlow = Math.min(100, Math.max(1, flow))
    this.emit()
  }

  /** Photoshop-like brush size nudge (`[`/`]` or `{`/`}`). */
  nudgeBrushSize(delta: number): void {
    this.setBrushSize(this.brushSize + delta)
  }

  setBrushColor(color: string): void {
    this.brushColor = color
    this.emit()
  }

  setFillTolerance(tolerance: number): void {
    this.fillTolerance = Math.min(255, Math.max(0, Math.round(tolerance)))
    this.emit()
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(32, Math.max(0.05, zoom))
    this.emit()
  }

  setShowRulers(show: boolean): void {
    this.showRulers = show
    this.emit()
  }

  setSelection(selection: MarqueeSelection | null): void {
    this.selection = selection
    this.emit()
  }

  clearSelection(): void {
    this.selection = null
    this.emit()
  }

  /**
   * Photoshop-like Delete / Backspace:
   * - With an active marquee/lasso → clear those pixels on the active unlocked paint layer
   * - Without a selection → no-op (layer delete is Layers panel / menu only)
   */
  async deleteSelectionOrLayer(): Promise<void> {
    if (this.selection && this.selection.width > 0 && this.selection.height > 0) {
      const doc = this.getDocument()
      const layer = doc?.layers.find((l) => l.id === doc.activeLayerId)
      if (layer?.locked) {
        this.status = 'Layer is locked'
        this.emit()
        return
      }
      await this.clearSelectionPixels()
      return
    }
  }

  /**
   * Create a document with one blank paintable layer (Photoshop-like).
   * Initial asset is a 1×1 transparent PNG; paint/load paths stretch to layer size.
   */
  createNew(options: CreateDocumentOptions): AtmpsDocument {
    let doc = createDocument(options)
    const assetId = createId('asset')
    const empty = transparentPng1x1()
    const layer = createRasterLayer({
      name: 'Layer 1',
      assetId,
      width: doc.width,
      height: doc.height
    })
    doc = {
      ...doc,
      layers: [layer],
      activeLayerId: layer.id
    }
    const url = URL.createObjectURL(bytesToBlob(empty, 'image/png'))
    const state: OpenDocumentState = {
      id: doc.id,
      history: new HistoryStack(doc),
      assets: [
        createAssetRecord({
          id: assetId,
          name: 'Layer 1',
          mimeType: 'image/png',
          byteLength: empty.byteLength
        })
      ],
      assetBytes: { [assetId]: empty },
      assetUrls: { [assetId]: url },
      filePath: null,
      dirty: false
    }
    this.openDocs.push(state)
    this.activeDocumentId = doc.id
    this.selection = null
    this.zoom = 1
    this.status = `Created “${doc.name}” (${doc.width}×${doc.height})`
    this.emit()
    return doc
  }

  switchDocument(documentId: string): void {
    if (!this.openDocs.some((d) => d.id === documentId)) return
    this.activeDocumentId = documentId
    this.selection = null
    this.zoom = 1
    const doc = this.active()!.history.document
    this.status = `“${doc.name}”`
    this.emit()
  }

  closeDocument(documentId: string): void {
    const idx = this.openDocs.findIndex((d) => d.id === documentId)
    if (idx < 0) return
    const [removed] = this.openDocs.splice(idx, 1)
    this.revokeUrls(removed)
    if (this.activeDocumentId === documentId) {
      const next = this.openDocs[Math.min(idx, this.openDocs.length - 1)]
      this.activeDocumentId = next?.id ?? null
      this.selection = null
      this.zoom = 1
    }
    this.status = this.activeDocumentId ? 'Document closed' : 'No document open'
    this.emit()
  }

  private revokeUrls(state?: OpenDocumentState): void {
    const urls = state ? Object.values(state.assetUrls) : []
    for (const url of urls) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }

  private ensureActive(): OpenDocumentState {
    const active = this.active()
    if (!active) throw new Error('No document open')
    return active
  }

  commit(label: string, mutator: (doc: AtmpsDocument) => AtmpsDocument): void {
    const active = this.ensureActive()
    active.history.commit(label, mutator)
    active.dirty = true
    this.emit()
  }

  /**
   * Non-history live update for pointer moves.
   * Does not notify React by default — Fabric already mirrors the interaction.
   */
  preview(mutator: (doc: AtmpsDocument) => AtmpsDocument, notify = false): void {
    const active = this.ensureActive()
    active.history.preview(mutator)
    if (notify) this.emit()
  }

  undo(): void {
    const active = this.ensureActive()
    if (!active.history.canUndo) return
    const snap = active.history.undo()
    if (snap?.assets?.length) {
      this.applyAssetDeltas(active, snap.assets, 'before')
    }
    active.dirty = true
    this.status = snap?.label ? `Undo ${snap.label}` : 'Undo'
    this.emit()
  }

  redo(): void {
    const active = this.ensureActive()
    if (!active.history.canRedo) return
    const snap = active.history.redo()
    if (snap?.assets?.length) {
      this.applyAssetDeltas(active, snap.assets, 'after')
    }
    active.dirty = true
    this.status = snap?.label ? `Redo ${snap.label}` : 'Redo'
    this.emit()
  }

  /** Restore asset bytes for an undo (before) or redo (after) side. */
  private applyAssetDeltas(
    active: OpenDocumentState,
    deltas: AssetByteDelta[],
    side: 'before' | 'after'
  ): void {
    for (const delta of deltas) {
      const bytes = side === 'before' ? delta.before : delta.after
      const prevUrl = active.assetUrls[delta.assetId]
      if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl)

      if (!bytes) {
        delete active.assetBytes[delta.assetId]
        delete active.assetUrls[delta.assetId]
        active.assets = active.assets.filter((a) => a.id !== delta.assetId)
        continue
      }

      active.assetBytes[delta.assetId] = new Uint8Array(bytes)
      const existing = active.assets.find((a) => a.id === delta.assetId)
      const mimeType = existing?.mimeType ?? 'image/png'
      if (existing) {
        active.assets = active.assets.map((a) =>
          a.id === delta.assetId ? { ...a, byteLength: bytes.byteLength, mimeType } : a
        )
      } else {
        active.assets.push(
          createAssetRecord({
            id: delta.assetId,
            name: 'Layer',
            mimeType,
            byteLength: bytes.byteLength
          })
        )
      }
      active.assetUrls[delta.assetId] = URL.createObjectURL(bytesToBlob(bytes, mimeType))
    }
  }

  addAssetFromBytes(params: {
    name: string
    mimeType: AssetRecord['mimeType']
    bytes: Uint8Array
  }): AssetRecord {
    const active = this.ensureActive()
    const asset = createAssetRecord({
      name: params.name,
      mimeType: params.mimeType,
      byteLength: params.bytes.byteLength
    })
    active.assets.push(asset)
    active.assetBytes[asset.id] = params.bytes
    active.assetUrls[asset.id] = URL.createObjectURL(bytesToBlob(params.bytes, params.mimeType))
    return asset
  }

  importImageBytes(params: {
    name: string
    filePath: string
    bytes: Uint8Array
    naturalWidth: number
    naturalHeight: number
  }): void {
    const active = this.ensureActive()
    const doc = active.history.document
    const mime = mimeFromPath(params.filePath)
    const asset = this.addAssetFromBytes({
      name: params.name,
      mimeType: mime,
      bytes: params.bytes
    })
    const x = Math.max(0, (doc.width - params.naturalWidth) / 2)
    const y = Math.max(0, (doc.height - params.naturalHeight) / 2)
    const layer = createImageLayer({
      name: params.name,
      assetId: asset.id,
      naturalWidth: params.naturalWidth,
      naturalHeight: params.naturalHeight,
      x,
      y
    })
    this.commit('Import image', (d) => addLayer(d, layer))
    this.status = `Imported ${params.name}`
    this.emit()
  }

  addShape(shape: 'rect' | 'ellipse'): void {
    const layer = createShapeLayer({
      name: shape === 'rect' ? 'Rectangle' : 'Ellipse',
      shape,
      width: 200,
      height: 140
    })
    this.commit(`Add ${shape}`, (d) => addLayer(d, layer))
    this.setTool('move')
  }

  addText(): void {
    const layer = createTextLayer({})
    this.commit('Add text', (d) => addLayer(d, layer))
    this.setTool('move')
  }

  /**
   * Resolve paint target for a stroke (Photoshop rules):
   * - Paint active unlocked raster/image (image promotes to raster on commit)
   * - Rasterize unlocked text/shape in place
   * - Locked / hidden → refuse (null); never spawn a silent sibling layer
   * - No active layer → deferred new raster folded into the stroke undo step
   */
  async prepareRasterStrokeTarget(): Promise<{
    layer: RasterLayer
    isNewLayer: boolean
    sourceUrl: string | null
    promoteFromImage?: boolean
  } | null> {
    const active = this.ensureActive()
    const doc = active.history.document
    const current = doc.layers.find((l) => l.id === doc.activeLayerId)

    if (current?.locked) {
      this.status = 'Layer is locked'
      this.emit()
      return null
    }
    if (current && !current.visible) {
      this.status = 'Layer is hidden'
      this.emit()
      return null
    }

    if (current?.kind === 'raster') {
      return {
        layer: current,
        isNewLayer: false,
        sourceUrl: active.assetUrls[current.assetId] ?? null
      }
    }

    if (current?.kind === 'image') {
      const asRaster = createRasterLayer({
        name: current.name,
        assetId: current.assetId,
        width: current.naturalWidth,
        height: current.naturalHeight
      })
      asRaster.id = current.id
      asRaster.visible = current.visible
      asRaster.locked = current.locked
      asRaster.opacity = current.opacity
      asRaster.blendMode = current.blendMode
      asRaster.transform = { ...current.transform }
      return {
        layer: asRaster,
        isNewLayer: false,
        sourceUrl: active.assetUrls[current.assetId] ?? null,
        promoteFromImage: true
      }
    }

    if (current && (current.kind === 'text' || current.kind === 'shape')) {
      await this.rasterizeLayer(current.id)
      const after = this.getDocument()?.layers.find((l) => l.id === current.id)
      if (after?.kind === 'raster') {
        return {
          layer: after,
          isNewLayer: false,
          sourceUrl: this.active()?.assetUrls[after.assetId] ?? null
        }
      }
    }

    // No active paint layer — deferred blank layer created with first stroke.
    if (!current) {
      const assetId = createId('asset')
      const layer = createRasterLayer({
        name: 'Layer',
        assetId,
        width: doc.width,
        height: doc.height
      })
      return { layer, isNewLayer: true, sourceUrl: null }
    }

    this.status = 'Cannot paint on this layer'
    this.emit()
    return null
  }

  /** Layers panel "+" — explicit new blank layer (its own undo step). */
  async ensureRasterLayer(): Promise<string> {
    const active = this.ensureActive()
    const doc = active.history.document
    const empty = await blankPngBytes(doc.width, doc.height)
    const asset = this.addAssetFromBytes({
      name: 'Layer',
      mimeType: 'image/png',
      bytes: empty
    })
    const layer = createRasterLayer({
      name: 'Layer',
      assetId: asset.id,
      width: doc.width,
      height: doc.height
    })
    this.commit('New layer', (d) => addLayer(d, layer))
    return layer.id
  }

  /**
   * Commit one completed brush/eraser stroke as a single undoable edit.
   * Caller should refresh Fabric in-place (no full canvas clear).
   */
  commitRasterStroke(params: {
    layer: RasterLayer
    isNewLayer: boolean
    bytes: Uint8Array
    label: string
    promoteFromImage?: boolean
  }): { layerId: string; assetId: string; url: string } {
    const active = this.ensureActive()
    const assetId = params.layer.assetId
    const afterBytes = new Uint8Array(params.bytes)
    const prevBytes =
      !params.isNewLayer && active.assetBytes[assetId]
        ? new Uint8Array(active.assetBytes[assetId]!)
        : null

    const deltas: AssetByteDelta[] = [
      {
        assetId,
        before: params.isNewLayer ? null : prevBytes,
        after: afterBytes
      }
    ]

    if (params.isNewLayer) {
      // Register asset metadata + bytes as part of this commit
      if (!active.assets.some((a) => a.id === assetId)) {
        active.assets.push(
          createAssetRecord({
            id: assetId,
            name: params.layer.name,
            mimeType: 'image/png',
            byteLength: afterBytes.byteLength
          })
        )
      }
      active.history.commit(params.label, (d) => addLayer(d, params.layer), { assets: deltas })
    } else if (params.promoteFromImage) {
      active.history.commit(
        params.label,
        (d) => ({
          ...d,
          layers: d.layers.map((l) => (l.id === params.layer.id ? { ...params.layer } : l)),
          updatedAt: new Date().toISOString()
        }),
        { assets: deltas }
      )
    } else {
      active.history.commit(params.label, (d) => d, { assets: deltas })
    }

    const prevUrl = active.assetUrls[assetId]
    if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl)
    active.assetBytes[assetId] = afterBytes
    active.assets = active.assets.map((a) =>
      a.id === assetId ? { ...a, byteLength: afterBytes.byteLength, mimeType: 'image/png' } : a
    )
    if (!active.assets.some((a) => a.id === assetId)) {
      active.assets.push(
        createAssetRecord({
          id: assetId,
          name: params.layer.name,
          mimeType: 'image/png',
          byteLength: afterBytes.byteLength
        })
      )
    }
    const url = URL.createObjectURL(bytesToBlob(afterBytes, 'image/png'))
    active.assetUrls[assetId] = url
    active.dirty = true
    this.status = params.label
    this.emit()
    return { layerId: params.layer.id, assetId, url }
  }

  /**
   * Generic raster pixel edit on the active paint target (raster or image).
   * One undo step with asset deltas.
   */
  async applyRasterPixelEdit(
    label: string,
    mutate: (data: ImageData, layer: PaintLayer) => void | Promise<void>
  ): Promise<{ layerId: string; url: string } | null> {
    const prepared = await this.ensurePaintTargetLayer()
    if (!prepared) return null
    const { layer, url: sourceUrl, isNewLayer } = prepared
    const width = layer.kind === 'image' ? layer.naturalWidth : layer.width
    const height = layer.kind === 'image' ? layer.naturalHeight : layer.height
    const data = sourceUrl
      ? await loadImageData(sourceUrl, width, height)
      : new ImageData(width, height)
    await mutate(data, layer)
    const bytes = await imageDataToPng(data)

    // Normalize image layers to raster for destructive pixel edits
    if (layer.kind === 'image') {
      const raster = createRasterLayer({
        name: layer.name,
        assetId: layer.assetId,
        width: layer.naturalWidth,
        height: layer.naturalHeight
      })
      raster.id = layer.id
      raster.visible = layer.visible
      raster.locked = layer.locked
      raster.opacity = layer.opacity
      raster.blendMode = layer.blendMode
      raster.transform = { ...layer.transform }
      const active = this.ensureActive()
      const afterBytes = new Uint8Array(bytes)
      const prevBytes = active.assetBytes[layer.assetId]
        ? new Uint8Array(active.assetBytes[layer.assetId]!)
        : null
      const deltas: AssetByteDelta[] = [
        { assetId: layer.assetId, before: prevBytes, after: afterBytes }
      ]
      active.history.commit(label, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === layer.id ? { ...raster } : l)),
        updatedAt: new Date().toISOString()
      }), { assets: deltas })
      const prevUrl = active.assetUrls[layer.assetId]
      if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl)
      active.assetBytes[layer.assetId] = afterBytes
      active.assets = active.assets.map((a) =>
        a.id === layer.assetId ? { ...a, byteLength: afterBytes.byteLength, mimeType: 'image/png' } : a
      )
      const newUrl = URL.createObjectURL(bytesToBlob(afterBytes, 'image/png'))
      active.assetUrls[layer.assetId] = newUrl
      active.dirty = true
      this.status = label
      this.emit()
      return { layerId: layer.id, url: newUrl }
    }

    const committed = this.commitRasterStroke({
      layer: layer as RasterLayer,
      isNewLayer,
      bytes,
      label
    })
    return { layerId: committed.layerId, url: committed.url }
  }

  async clearSelectionPixels(): Promise<void> {
    const sel = this.selection
    if (!sel || sel.width <= 0 || sel.height <= 0) return
    const result = await this.applyRasterPixelEdit('Clear selection', (data) => {
      clearRectInImageData(data, sel, sel.points)
    })
    if (result) this.status = 'Cleared selection'
  }

  /** Ensure active layer can receive pixels; returns paint target info. */
  async ensurePaintTargetLayer(): Promise<{
    layer: PaintLayer
    url: string | null
    isNewLayer: boolean
  } | null> {
    const active = this.active()
    if (!active) return null
    const doc = active.history.document
    const current = doc.layers.find((l) => l.id === doc.activeLayerId)
    if (current?.locked) {
      this.status = 'Layer is locked'
      this.emit()
      return null
    }
    if (current && !current.visible) {
      this.status = 'Layer is hidden'
      this.emit()
      return null
    }
    if (current?.kind === 'raster') {
      return {
        layer: current,
        url: active.assetUrls[current.assetId] ?? null,
        isNewLayer: false
      }
    }
    if (current?.kind === 'image') {
      return {
        layer: current,
        url: active.assetUrls[current.assetId] ?? null,
        isNewLayer: false
      }
    }
    if (current && (current.kind === 'text' || current.kind === 'shape')) {
      await this.rasterizeLayer(current.id)
      const after = this.getDocument()?.layers.find((l) => l.id === current.id)
      if (after?.kind === 'raster') {
        return {
          layer: after,
          url: this.active()?.assetUrls[after.assetId] ?? null,
          isNewLayer: false
        }
      }
    }
    const target = await this.prepareRasterStrokeTarget()
    if (!target) return null
    return {
      layer: target.layer,
      url: target.sourceUrl,
      isNewLayer: target.isNewLayer
    }
  }

  async cropToRect(rect: MarqueeSelection): Promise<void> {
    const active = this.ensureActive()
    const doc = active.history.document
    const x = Math.max(0, Math.floor(rect.x))
    const y = Math.max(0, Math.floor(rect.y))
    const width = Math.max(1, Math.min(doc.width - x, Math.ceil(rect.width)))
    const height = Math.max(1, Math.min(doc.height - y, Math.ceil(rect.height)))
    if (width >= doc.width && height >= doc.height && x === 0 && y === 0) return

    const deltas: AssetByteDelta[] = []
    const newUrls: Record<string, string> = {}
    const newBytes: Record<string, Uint8Array> = {}

    for (const layer of doc.layers) {
      if (layer.kind !== 'raster' && layer.kind !== 'image') continue
      const url = active.assetUrls[layer.assetId]
      if (!url) continue
      const lw = layer.kind === 'image' ? layer.naturalWidth : layer.width
      const lh = layer.kind === 'image' ? layer.naturalHeight : layer.height
      // Layers are typically full-canvas for raster; for image, crop in document space
      // relative to layer transform — simplified: crop document window from layer pixels
      // when layer is origin-aligned full size; otherwise shift transform.
      if (layer.kind === 'raster' && layer.width === doc.width && layer.height === doc.height) {
        const data = await loadImageData(url, lw, lh)
        const cropped = cropImageData(data, { x, y, width, height })
        const bytes = await imageDataToPng(cropped)
        const prev = active.assetBytes[layer.assetId]
          ? new Uint8Array(active.assetBytes[layer.assetId]!)
          : null
        deltas.push({ assetId: layer.assetId, before: prev, after: bytes })
        newBytes[layer.assetId] = bytes
        newUrls[layer.assetId] = URL.createObjectURL(bytesToBlob(bytes, 'image/png'))
      }
    }

    active.history.commit(
      'Crop',
      (d) => ({
        ...d,
        width,
        height,
        layers: d.layers.map((l) => {
          if (l.kind === 'raster' && l.width === d.width && l.height === d.height) {
            return { ...l, width, height, transform: { ...l.transform, x: 0, y: 0 } }
          }
          if (l.kind === 'image' || l.kind === 'raster' || l.kind === 'shape' || l.kind === 'text') {
            return {
              ...l,
              transform: {
                ...l.transform,
                x: l.transform.x - x,
                y: l.transform.y - y
              }
            }
          }
          return l
        }),
        updatedAt: new Date().toISOString()
      }),
      { assets: deltas }
    )

    for (const [assetId, bytes] of Object.entries(newBytes)) {
      const prevUrl = active.assetUrls[assetId]
      if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl)
      active.assetBytes[assetId] = bytes
      active.assetUrls[assetId] = newUrls[assetId]!
      active.assets = active.assets.map((a) =>
        a.id === assetId ? { ...a, byteLength: bytes.byteLength, mimeType: 'image/png' } : a
      )
    }
    this.selection = null
    active.dirty = true
    this.status = `Cropped to ${width}×${height}`
    this.emit()
  }

  async rasterizeLayer(layerId: string): Promise<void> {
    const active = this.ensureActive()
    const doc = active.history.document
    const layer = doc.layers.find((l) => l.id === layerId)
    if (!layer || layer.kind === 'raster' || layer.kind === 'image') return

    const canvas = document.createElement('canvas')
    canvas.width = doc.width
    canvas.height = doc.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, doc.width, doc.height)
    const t = layer.transform
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(t.x, t.y)
    ctx.rotate((t.rotation * Math.PI) / 180)
    ctx.scale(t.scaleX, t.scaleY)

    if (layer.kind === 'shape') {
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

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
    if (!blob) return
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const asset = this.addAssetFromBytes({
      name: `${layer.name} raster`,
      mimeType: 'image/png',
      bytes
    })
    const raster = createRasterLayer({
      name: layer.name,
      assetId: asset.id,
      width: doc.width,
      height: doc.height
    })
    raster.id = layer.id
    raster.visible = layer.visible
    raster.locked = layer.locked
    raster.opacity = 1
    raster.blendMode = layer.blendMode
    raster.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }

    this.commit('Rasterize layer', (d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === layerId ? { ...raster } : l)),
      updatedAt: new Date().toISOString()
    }))
    this.status = `Rasterized “${layer.name}”`
  }

  replaceAssetBytes(assetId: string, bytes: Uint8Array, mimeType: AssetRecord['mimeType']): void {
    const active = this.ensureActive()
    const prev = active.assetUrls[assetId]
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    active.assetBytes[assetId] = bytes
    active.assets = active.assets.map((a) =>
      a.id === assetId ? { ...a, byteLength: bytes.byteLength, mimeType } : a
    )
    active.assetUrls[assetId] = URL.createObjectURL(bytesToBlob(bytes, mimeType))
    active.dirty = true
    this.emit()
  }

  deleteLayer(layerId: string): void {
    this.commit('Delete layer', (d) => removeLayer(d, layerId))
  }

  duplicateActiveLayer(layerId: string): void {
    this.commit('Duplicate layer', (d) => duplicateLayer(d, layerId))
  }

  renameLayer(layerId: string, name: string): void {
    this.commit('Rename layer', (d) => renameLayer(d, layerId, name))
  }

  toggleVisibility(layerId: string): void {
    const layer = this.ensureActive().history.document.layers.find((l) => l.id === layerId)
    if (!layer) return
    this.commit(layer.visible ? 'Hide layer' : 'Show layer', (d) =>
      setLayerVisibility(d, layerId, !layer.visible)
    )
  }

  toggleLock(layerId: string): void {
    const layer = this.ensureActive().history.document.layers.find((l) => l.id === layerId)
    if (!layer) return
    this.commit(layer.locked ? 'Unlock layer' : 'Lock layer', (d) =>
      setLayerLocked(d, layerId, !layer.locked)
    )
  }

  /** Live opacity while dragging the slider — no history entry. */
  previewOpacity(layerId: string, opacity: number): void {
    this.preview((d) => setLayerOpacity(d, layerId, opacity), true)
  }

  /** Commit opacity once (e.g. slider pointerup / change). */
  setOpacity(layerId: string, opacity: number): void {
    this.commit('Layer opacity', (d) => setLayerOpacity(d, layerId, opacity))
  }

  setBlendMode(layerId: string, blendMode: BlendMode): void {
    this.commit('Blend mode', (d) => setLayerBlendMode(d, layerId, blendMode))
  }

  reorder(layerId: string, toIndex: number): void {
    this.commit('Reorder layer', (d) => reorderLayer(d, layerId, toIndex))
  }

  selectLayer(layerId: string | null): void {
    // Selection is not an undoable edit
    this.preview((d) => setActiveLayer(d, layerId), true)
  }

  applyTransform(layerId: string, transform: Partial<Transform2D>, commitLabel?: string): void {
    if (commitLabel) {
      this.commit(commitLabel, (d) => updateLayerTransform(d, layerId, transform))
    } else {
      this.preview((d) => updateLayerTransform(d, layerId, transform))
    }
  }

  patchLayer(layerId: string, patch: Partial<Layer>, label: string): void {
    this.commit(label, (d) => updateLayer(d, layerId, patch))
  }

  renameDocument(name: string): void {
    this.commit('Rename document', (d) => ({ ...d, name: name.trim() || d.name }))
  }

  toSerializedPackage(): SerializedProjectPackage {
    const active = this.ensureActive()
    const pkg = buildProjectPackage({
      document: active.history.document,
      assets: active.assets,
      assetBytes: active.assetBytes
    })
    return serializePackage(pkg)
  }

  loadSerializedPackage(serialized: SerializedProjectPackage, filePath: string | null): void {
    const pkg = deserializePackage(serialized)
    const doc = normalizeDocument(pkg.document)
    const state: OpenDocumentState = {
      id: doc.id,
      history: new HistoryStack(doc),
      assets: pkg.assets,
      assetBytes: pkg.assetBytes,
      assetUrls: {},
      filePath,
      dirty: false
    }
    for (const asset of pkg.assets) {
      const bytes = pkg.assetBytes[asset.id]!
      state.assetUrls[asset.id] = URL.createObjectURL(bytesToBlob(bytes, asset.mimeType))
    }
    // Replace if same path already open; otherwise add tab
    const existingIdx = filePath
      ? this.openDocs.findIndex((d) => d.filePath === filePath)
      : -1
    if (existingIdx >= 0) {
      this.revokeUrls(this.openDocs[existingIdx])
      this.openDocs[existingIdx] = state
    } else {
      this.openDocs.push(state)
    }
    this.activeDocumentId = doc.id
    this.selection = null
    this.zoom = 1
    this.status = `Opened “${doc.name}”`
    this.emit()
  }

  markSaved(filePath: string): void {
    const active = this.ensureActive()
    active.filePath = filePath
    active.dirty = false
    this.status = `Saved ${filePath}`
    this.emit()
  }
}

/**
 * 1×1 truly transparent PNG (RGBA). Do NOT use the common “mP8/x8A” 1×1 —
 * Chromium decodes that asset as opaque white, which flooded every paint bake.
 */
export function transparentPng1x1(): Uint8Array {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAAtJREFUGFdjYAACAAAFAAGq1chRAAAAAElFTkSuQmCC'
  if (typeof atob === 'function') {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

/** Full-size transparent PNG for paint layers. */
export async function blankPngBytes(width: number, height: number): Promise<Uint8Array> {
  if (typeof document === 'undefined') return transparentPng1x1()
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (!blob) return transparentPng1x1()
  return new Uint8Array(await blob.arrayBuffer())
}

export function createSessionId(): string {
  return createId('session')
}
