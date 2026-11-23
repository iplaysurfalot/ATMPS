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
import { HistoryStack } from '../history/history-stack'
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
  Layer,
  MarqueeSelection,
  SerializedProjectPackage,
  ToolId,
  Transform2D
} from '@shared/types'

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
  brushColor: string
  zoom: number
  showRulers: boolean
  selection: MarqueeSelection | null
  canUndo: boolean
  canRedo: boolean
  status: string
  toolTip: string
}

const TOOL_STATUS: Record<ToolId, string> = {
  move: 'Move Tool',
  marquee: 'Rectangular Marquee Tool',
  brush: 'Brush Tool',
  eraser: 'Eraser Tool',
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
  private brushColor = '#000000'
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
        brushColor: this.brushColor,
        zoom: this.zoom,
        showRulers: this.showRulers,
        selection: this.selection ? { ...this.selection } : null,
        canUndo: active?.history.canUndo ?? false,
        canRedo: active?.history.canRedo ?? false,
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

  setBrushColor(color: string): void {
    this.brushColor = color
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

  createNew(options: CreateDocumentOptions): AtmpsDocument {
    const doc = createDocument(options)
    const state: OpenDocumentState = {
      id: doc.id,
      history: new HistoryStack(doc),
      assets: [],
      assetBytes: {},
      assetUrls: {},
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
    active.history.undo()
    active.dirty = true
    this.status = 'Undo'
    this.emit()
  }

  redo(): void {
    const active = this.ensureActive()
    if (!active.history.canRedo) return
    active.history.redo()
    active.dirty = true
    this.status = 'Redo'
    this.emit()
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

  async ensureRasterLayer(): Promise<string> {
    const active = this.ensureActive()
    const doc = active.history.document
    const current = doc.layers.find((l) => l.id === doc.activeLayerId)
    if (current?.kind === 'raster' && !current.locked) return current.id

    // Auto-rasterize text/shape when painting on them
    if (current && (current.kind === 'text' || current.kind === 'shape') && !current.locked) {
      await this.rasterizeLayer(current.id)
      const after = this.getDocument()?.layers.find((l) => l.id === current.id)
      if (after?.kind === 'raster') return after.id
    }

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

/** Full-size transparent PNG for paint layers. */
export async function blankPngBytes(width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  )
  if (!blob) {
    // 1x1 transparent fallback
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2fQAAAAASUVORK5CYII='
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return new Uint8Array(await blob.arrayBuffer())
}

export function createSessionId(): string {
  return createId('session')
}
