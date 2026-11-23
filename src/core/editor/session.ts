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
  removeLayer,
  renameLayer,
  reorderLayer,
  setActiveLayer,
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
  CreateDocumentOptions,
  Layer,
  SerializedProjectPackage,
  ToolId,
  Transform2D
} from '@shared/types'

export type EditorListener = () => void

export interface EditorSnapshot {
  document: AtmpsDocument | null
  assets: AssetRecord[]
  assetUrls: Record<string, string>
  filePath: string | null
  dirty: boolean
  tool: ToolId
  brushSize: number
  brushColor: string
  zoom: number
  canUndo: boolean
  canRedo: boolean
  status: string
}

/**
 * Application session: document + assets + history.
 * Image bytes and history live outside React.
 */
export class EditorSession {
  private history: HistoryStack | null = null
  private assets: AssetRecord[] = []
  private assetBytes: Record<string, Uint8Array> = {}
  private assetUrls: Record<string, string> = {}
  private filePath: string | null = null
  private dirty = false
  private tool: ToolId = 'select'
  private brushSize = 12
  private brushColor = '#111827'
  private zoom = 1
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

  getSnapshot(): EditorSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        document: this.history ? cloneDocument(this.history.document) : null,
        assets: [...this.assets],
        assetUrls: { ...this.assetUrls },
        filePath: this.filePath,
        dirty: this.dirty,
        tool: this.tool,
        brushSize: this.brushSize,
        brushColor: this.brushColor,
        zoom: this.zoom,
        canUndo: this.history?.canUndo ?? false,
        canRedo: this.history?.canRedo ?? false,
        status: this.status
      }
    }
    return this.cachedSnapshot
  }

  getDocument(): AtmpsDocument | null {
    return this.history?.document ?? null
  }

  setStatus(status: string): void {
    this.status = status
    this.emit()
  }

  setTool(tool: ToolId): void {
    this.tool = tool
    this.emit()
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.min(200, Math.max(1, size))
    this.emit()
  }

  setBrushColor(color: string): void {
    this.brushColor = color
    this.emit()
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(8, Math.max(0.1, zoom))
    this.emit()
  }

  createNew(options: CreateDocumentOptions): AtmpsDocument {
    this.revokeUrls()
    const doc = createDocument(options)
    this.history = new HistoryStack(doc)
    this.assets = []
    this.assetBytes = {}
    this.assetUrls = {}
    this.filePath = null
    this.dirty = false
    this.status = `Created “${doc.name}” (${doc.width}×${doc.height})`
    this.emit()
    return doc
  }

  private revokeUrls(): void {
    for (const url of Object.values(this.assetUrls)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }

  private ensureHistory(): HistoryStack {
    if (!this.history) throw new Error('No document open')
    return this.history
  }

  commit(label: string, mutator: (doc: AtmpsDocument) => AtmpsDocument): void {
    const history = this.ensureHistory()
    history.commit(label, mutator)
    this.dirty = true
    this.emit()
  }

  /**
   * Non-history live update for pointer moves.
   * Does not notify React by default — Fabric already mirrors the interaction.
   */
  preview(mutator: (doc: AtmpsDocument) => AtmpsDocument, notify = false): void {
    const history = this.ensureHistory()
    history.preview(mutator)
    if (notify) this.emit()
  }

  undo(): void {
    const history = this.ensureHistory()
    if (!history.canUndo) return
    history.undo()
    this.dirty = true
    this.status = 'Undo'
    this.emit()
  }

  redo(): void {
    const history = this.ensureHistory()
    if (!history.canRedo) return
    history.redo()
    this.dirty = true
    this.status = 'Redo'
    this.emit()
  }

  addAssetFromBytes(params: {
    name: string
    mimeType: AssetRecord['mimeType']
    bytes: Uint8Array
  }): AssetRecord {
    const asset = createAssetRecord({
      name: params.name,
      mimeType: params.mimeType,
      byteLength: params.bytes.byteLength
    })
    this.assets.push(asset)
    this.assetBytes[asset.id] = params.bytes
    this.assetUrls[asset.id] = URL.createObjectURL(bytesToBlob(params.bytes, params.mimeType))
    return asset
  }

  importImageBytes(params: {
    name: string
    filePath: string
    bytes: Uint8Array
    naturalWidth: number
    naturalHeight: number
  }): void {
    const doc = this.ensureHistory().document
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
  }

  addText(): void {
    const layer = createTextLayer({})
    this.commit('Add text', (d) => addLayer(d, layer))
  }

  ensureRasterLayer(): string {
    const doc = this.ensureHistory().document
    const active = doc.layers.find((l) => l.id === doc.activeLayerId)
    if (active?.kind === 'raster') return active.id

    const empty = blankPng(doc.width, doc.height)
    const asset = this.addAssetFromBytes({
      name: 'Paint',
      mimeType: 'image/png',
      bytes: empty
    })
    const layer = createRasterLayer({
      name: 'Paint',
      assetId: asset.id,
      width: doc.width,
      height: doc.height
    })
    this.commit('Add paint layer', (d) => addLayer(d, layer))
    return layer.id
  }

  replaceAssetBytes(assetId: string, bytes: Uint8Array, mimeType: AssetRecord['mimeType']): void {
    const prev = this.assetUrls[assetId]
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
    this.assetBytes[assetId] = bytes
    this.assets = this.assets.map((a) =>
      a.id === assetId ? { ...a, byteLength: bytes.byteLength, mimeType } : a
    )
    this.assetUrls[assetId] = URL.createObjectURL(bytesToBlob(bytes, mimeType))
    this.dirty = true
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
    const layer = this.ensureHistory().document.layers.find((l) => l.id === layerId)
    if (!layer) return
    this.commit(layer.visible ? 'Hide layer' : 'Show layer', (d) =>
      setLayerVisibility(d, layerId, !layer.visible)
    )
  }

  setOpacity(layerId: string, opacity: number): void {
    this.commit('Layer opacity', (d) => setLayerOpacity(d, layerId, opacity))
  }

  reorder(layerId: string, toIndex: number): void {
    this.commit('Reorder layer', (d) => reorderLayer(d, layerId, toIndex))
  }

  selectLayer(layerId: string | null): void {
    this.commit('Select layer', (d) => setActiveLayer(d, layerId))
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
    const doc = this.ensureHistory().document
    const pkg = buildProjectPackage({
      document: doc,
      assets: this.assets,
      assetBytes: this.assetBytes
    })
    return serializePackage(pkg)
  }

  loadSerializedPackage(serialized: SerializedProjectPackage, filePath: string | null): void {
    this.revokeUrls()
    const pkg = deserializePackage(serialized)
    this.history = new HistoryStack(pkg.document)
    this.assets = pkg.assets
    this.assetBytes = pkg.assetBytes
    this.assetUrls = {}
    for (const asset of pkg.assets) {
      const bytes = pkg.assetBytes[asset.id]!
      this.assetUrls[asset.id] = URL.createObjectURL(bytesToBlob(bytes, asset.mimeType))
    }
    this.filePath = filePath
    this.dirty = false
    this.status = `Opened “${pkg.document.name}”`
    this.emit()
  }

  markSaved(filePath: string): void {
    this.filePath = filePath
    this.dirty = false
    this.status = `Saved ${filePath}`
    this.emit()
  }
}

/** Minimal opaque PNG for empty raster layers. */
function blankPng(width: number, height: number): Uint8Array {
  // Create via offscreen if available; otherwise 1x1 and stretch via layer size.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, width, height)
    }
    // sync conversion not available; fall through to tiny PNG
  }
  void width
  void height
  // 1x1 transparent PNG
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2fQAAAAASUVORK5CYII='
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function createSessionId(): string {
  return createId('session')
}
