import JSZip from 'jszip'
import type {
  AssetRecord,
  AtmpsDocument,
  ProjectManifest,
  ProjectPackage,
  SerializedProjectPackage
} from '@shared/types'

const MANIFEST_PATH = 'manifest.json'
const DOCUMENT_PATH = 'document.json'
const ASSETS_META_PATH = 'assets.json'

export function serializePackage(pkg: ProjectPackage): SerializedProjectPackage {
  const assetBase64: Record<string, string> = {}
  for (const [id, bytes] of Object.entries(pkg.assetBytes)) {
    assetBase64[id] = bytesToBase64(bytes)
  }
  return {
    manifest: pkg.manifest,
    document: pkg.document,
    assets: pkg.assets,
    assetBase64
  }
}

export function deserializePackage(serialized: SerializedProjectPackage): ProjectPackage {
  const assetBytes: Record<string, Uint8Array> = {}
  for (const [id, b64] of Object.entries(serialized.assetBase64)) {
    assetBytes[id] = base64ToBytes(b64)
  }
  return {
    manifest: serialized.manifest,
    document: serialized.document,
    assets: serialized.assets,
    assetBytes
  }
}

export function buildProjectPackage(params: {
  document: AtmpsDocument
  assets: AssetRecord[]
  assetBytes: Record<string, Uint8Array>
}): ProjectPackage {
  const savedAt = new Date().toISOString()
  const manifest: ProjectManifest = {
    format: 'atmps',
    formatVersion: 1,
    documentId: params.document.id,
    name: params.document.name,
    savedAt
  }
  return {
    manifest,
    document: { ...params.document, updatedAt: savedAt },
    assets: params.assets,
    assetBytes: params.assetBytes
  }
}

/** Pack project into .atmps zip bytes. Original asset bytes are stored as-is. */
export async function packProject(pkg: ProjectPackage): Promise<Uint8Array> {
  validatePackage(pkg)
  const zip = new JSZip()
  zip.file(MANIFEST_PATH, JSON.stringify(pkg.manifest, null, 2))
  zip.file(DOCUMENT_PATH, JSON.stringify(pkg.document, null, 2))
  zip.file(ASSETS_META_PATH, JSON.stringify(pkg.assets, null, 2))

  for (const asset of pkg.assets) {
    const bytes = pkg.assetBytes[asset.id]
    if (!bytes) {
      throw new Error(`Missing bytes for asset ${asset.id}`)
    }
    zip.file(asset.relativePath, bytes)
  }

  const out = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  return out
}

export async function unpackProject(data: Uint8Array): Promise<ProjectPackage> {
  const zip = await JSZip.loadAsync(data)
  const manifestRaw = await readZipText(zip, MANIFEST_PATH)
  const documentRaw = await readZipText(zip, DOCUMENT_PATH)
  const assetsRaw = await readZipText(zip, ASSETS_META_PATH)

  const manifest = JSON.parse(manifestRaw) as ProjectManifest
  const document = JSON.parse(documentRaw) as AtmpsDocument
  const assets = JSON.parse(assetsRaw) as AssetRecord[]

  if (manifest.format !== 'atmps') {
    throw new Error('Not an ATMPS project')
  }
  if (document.version !== 1) {
    throw new Error(`Unsupported document version: ${document.version}`)
  }

  const assetBytes: Record<string, Uint8Array> = {}
  for (const asset of assets) {
    const file = zip.file(asset.relativePath)
    if (!file) {
      throw new Error(`Missing asset file: ${asset.relativePath}`)
    }
    assetBytes[asset.id] = await file.async('uint8array')
  }

  const pkg: ProjectPackage = { manifest, document, assets, assetBytes }
  validatePackage(pkg)
  return pkg
}

function validatePackage(pkg: ProjectPackage): void {
  if (!pkg.document?.id) throw new Error('Invalid document')
  if (!Array.isArray(pkg.assets)) throw new Error('Invalid assets list')
  const assetIds = new Set(pkg.assets.map((a) => a.id))
  for (const layer of pkg.document.layers) {
    if (layer.kind === 'image' || layer.kind === 'raster') {
      if (!assetIds.has(layer.assetId)) {
        throw new Error(`Layer ${layer.id} references missing asset ${layer.assetId}`)
      }
    }
  }
  for (const asset of pkg.assets) {
    if (!pkg.assetBytes[asset.id]) {
      throw new Error(`Missing bytes for asset ${asset.id}`)
    }
  }
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`Missing ${path} in project package`)
  return file.async('string')
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function extensionForMime(mime: AssetRecord['mimeType']): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}
