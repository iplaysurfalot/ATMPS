import { describe, expect, it } from 'vitest'
import {
  addLayer,
  createAssetRecord,
  createDocument,
  createImageLayer
} from '../src/core/document/model'
import {
  buildProjectPackage,
  deserializePackage,
  packProject,
  serializePackage,
  unpackProject
} from '../src/core/file/project-io'

describe('project I/O', () => {
  it('round-trips document, layers, and original asset bytes', async () => {
    let doc = createDocument({ name: 'Album', width: 800, height: 600 })
    const originalBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5])
    const asset = createAssetRecord({
      name: 'shot.png',
      mimeType: 'image/png',
      byteLength: originalBytes.byteLength
    })
    const layer = createImageLayer({
      name: 'shot.png',
      assetId: asset.id,
      naturalWidth: 100,
      naturalHeight: 80,
      x: 12,
      y: 24
    })
    doc = addLayer(doc, layer)

    const pkg = buildProjectPackage({
      document: doc,
      assets: [asset],
      assetBytes: { [asset.id]: originalBytes }
    })

    const packed = await packProject(pkg)
    expect(packed.byteLength).toBeGreaterThan(32)

    const restored = await unpackProject(packed)
    expect(restored.document.name).toBe('Album')
    expect(restored.document.layers).toHaveLength(1)
    expect(restored.document.layers[0]?.kind).toBe('image')
    if (restored.document.layers[0]?.kind === 'image') {
      expect(restored.document.layers[0].assetId).toBe(asset.id)
      expect(restored.document.layers[0].transform.x).toBe(12)
    }
    expect(restored.assets[0]?.name).toBe('shot.png')
    expect(Array.from(restored.assetBytes[asset.id]!)).toEqual(Array.from(originalBytes))
  })

  it('serializes for IPC without losing bytes', () => {
    const doc = createDocument({ name: 'IPC', width: 10, height: 10 })
    const bytes = new Uint8Array([9, 8, 7])
    const asset = createAssetRecord({ name: 'a.webp', mimeType: 'image/webp', byteLength: 3 })
    const pkg = buildProjectPackage({
      document: doc,
      assets: [asset],
      assetBytes: { [asset.id]: bytes }
    })
    const serialized = serializePackage(pkg)
    const back = deserializePackage(serialized)
    expect(Array.from(back.assetBytes[asset.id]!)).toEqual([9, 8, 7])
  })

  it('rejects packages with missing asset bytes', async () => {
    const doc = createDocument({ name: 'Bad', width: 10, height: 10 })
    const asset = createAssetRecord({ name: 'x.png', mimeType: 'image/png', byteLength: 1 })
    const layer = createImageLayer({
      name: 'x',
      assetId: asset.id,
      naturalWidth: 1,
      naturalHeight: 1
    })
    const broken = buildProjectPackage({
      document: addLayer(doc, layer),
      assets: [asset],
      assetBytes: {}
    })
    await expect(packProject(broken)).rejects.toThrow(/Missing bytes/)
  })
})
