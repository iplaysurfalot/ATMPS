import { createId } from '../ids'
import type {
  AssetRecord,
  AtmpsDocument,
  CreateDocumentOptions,
  ImageLayer,
  Layer,
  RasterLayer,
  ShapeLayer,
  TextLayer,
  Transform2D
} from '@shared/types'

export function defaultTransform(x = 0, y = 0): Transform2D {
  return { x, y, scaleX: 1, scaleY: 1, rotation: 0 }
}

export function createDocument(options: CreateDocumentOptions): AtmpsDocument {
  const now = new Date().toISOString()
  return {
    version: 1,
    id: createId('doc'),
    name: options.name.trim() || 'Untitled',
    width: Math.max(1, Math.floor(options.width)),
    height: Math.max(1, Math.floor(options.height)),
    background: options.background ?? '#ffffff',
    layers: [],
    activeLayerId: null,
    createdAt: now,
    updatedAt: now
  }
}

export function touchDocument(doc: AtmpsDocument): AtmpsDocument {
  return { ...doc, updatedAt: new Date().toISOString() }
}

export function cloneDocument(doc: AtmpsDocument): AtmpsDocument {
  return structuredClone(doc)
}

export function findLayer(doc: AtmpsDocument, layerId: string): Layer | undefined {
  return doc.layers.find((l) => l.id === layerId)
}

export function withLayers(doc: AtmpsDocument, layers: Layer[], activeLayerId?: string | null): AtmpsDocument {
  return touchDocument({
    ...doc,
    layers,
    activeLayerId: activeLayerId === undefined ? doc.activeLayerId : activeLayerId
  })
}

export function addLayer(doc: AtmpsDocument, layer: Layer, setActive = true): AtmpsDocument {
  return withLayers(doc, [...doc.layers, layer], setActive ? layer.id : doc.activeLayerId)
}

export function removeLayer(doc: AtmpsDocument, layerId: string): AtmpsDocument {
  const layers = doc.layers.filter((l) => l.id !== layerId)
  const activeLayerId =
    doc.activeLayerId === layerId ? (layers[layers.length - 1]?.id ?? null) : doc.activeLayerId
  return withLayers(doc, layers, activeLayerId)
}

export function duplicateLayer(doc: AtmpsDocument, layerId: string): AtmpsDocument {
  const layer = findLayer(doc, layerId)
  if (!layer) return doc
  const copy: Layer = {
    ...structuredClone(layer),
    id: createId('layer'),
    name: `${layer.name} copy`,
    transform: { ...layer.transform, x: layer.transform.x + 16, y: layer.transform.y + 16 }
  }
  const index = doc.layers.findIndex((l) => l.id === layerId)
  const layers = [...doc.layers]
  layers.splice(index + 1, 0, copy)
  return withLayers(doc, layers, copy.id)
}

export function renameLayer(doc: AtmpsDocument, layerId: string, name: string): AtmpsDocument {
  const trimmed = name.trim() || 'Layer'
  return withLayers(
    doc,
    doc.layers.map((l) => (l.id === layerId ? { ...l, name: trimmed } : l))
  )
}

export function setLayerVisibility(doc: AtmpsDocument, layerId: string, visible: boolean): AtmpsDocument {
  return withLayers(
    doc,
    doc.layers.map((l) => (l.id === layerId ? { ...l, visible } : l))
  )
}

export function setLayerOpacity(doc: AtmpsDocument, layerId: string, opacity: number): AtmpsDocument {
  const clamped = Math.min(1, Math.max(0, opacity))
  return withLayers(
    doc,
    doc.layers.map((l) => (l.id === layerId ? { ...l, opacity: clamped } : l))
  )
}

export function reorderLayer(doc: AtmpsDocument, layerId: string, toIndex: number): AtmpsDocument {
  const fromIndex = doc.layers.findIndex((l) => l.id === layerId)
  if (fromIndex < 0) return doc
  const layers = [...doc.layers]
  const [item] = layers.splice(fromIndex, 1)
  const clamped = Math.min(layers.length, Math.max(0, toIndex))
  layers.splice(clamped, 0, item)
  return withLayers(doc, layers)
}

export function setActiveLayer(doc: AtmpsDocument, layerId: string | null): AtmpsDocument {
  if (layerId && !findLayer(doc, layerId)) return doc
  return touchDocument({ ...doc, activeLayerId: layerId })
}

export function updateLayerTransform(
  doc: AtmpsDocument,
  layerId: string,
  transform: Partial<Transform2D>
): AtmpsDocument {
  return withLayers(
    doc,
    doc.layers.map((l) =>
      l.id === layerId ? { ...l, transform: { ...l.transform, ...transform } } : l
    )
  )
}

export function updateLayer(doc: AtmpsDocument, layerId: string, patch: Partial<Layer>): AtmpsDocument {
  return withLayers(
    doc,
    doc.layers.map((l) => {
      if (l.id !== layerId) return l
      return { ...l, ...patch, id: l.id, kind: l.kind } as Layer
    })
  )
}

export function createImageLayer(params: {
  name: string
  assetId: string
  naturalWidth: number
  naturalHeight: number
  x?: number
  y?: number
}): ImageLayer {
  return {
    id: createId('layer'),
    name: params.name,
    kind: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    transform: defaultTransform(params.x ?? 0, params.y ?? 0),
    assetId: params.assetId,
    naturalWidth: params.naturalWidth,
    naturalHeight: params.naturalHeight
  }
}

export function createShapeLayer(params: {
  name: string
  shape: 'rect' | 'ellipse'
  width: number
  height: number
  fill?: string
  x?: number
  y?: number
}): ShapeLayer {
  return {
    id: createId('layer'),
    name: params.name,
    kind: 'shape',
    visible: true,
    locked: false,
    opacity: 1,
    transform: defaultTransform(params.x ?? 40, params.y ?? 40),
    shape: params.shape,
    width: params.width,
    height: params.height,
    fill: params.fill ?? '#4f8cff',
    stroke: '#1e293b',
    strokeWidth: 0
  }
}

export function createTextLayer(params: {
  name?: string
  text?: string
  x?: number
  y?: number
}): TextLayer {
  return {
    id: createId('layer'),
    name: params.name ?? 'Text',
    kind: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    transform: defaultTransform(params.x ?? 80, params.y ?? 80),
    text: params.text ?? 'Text',
    fontFamily: 'Segoe UI',
    fontSize: 32,
    fill: '#111827',
    fontWeight: 'normal'
  }
}

export function createRasterLayer(params: {
  name: string
  assetId: string
  width: number
  height: number
}): RasterLayer {
  return {
    id: createId('layer'),
    name: params.name,
    kind: 'raster',
    visible: true,
    locked: false,
    opacity: 1,
    transform: defaultTransform(0, 0),
    assetId: params.assetId,
    width: params.width,
    height: params.height
  }
}

export function createAssetRecord(params: {
  name: string
  mimeType: AssetRecord['mimeType']
  byteLength: number
  id?: string
}): AssetRecord {
  const id = params.id ?? createId('asset')
  const ext =
    params.mimeType === 'image/jpeg' ? 'jpg' : params.mimeType === 'image/webp' ? 'webp' : 'png'
  return {
    id,
    name: params.name,
    mimeType: params.mimeType,
    relativePath: `assets/${id}.${ext}`,
    byteLength: params.byteLength
  }
}

export function mimeFromPath(filePath: string): AssetRecord['mimeType'] {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
