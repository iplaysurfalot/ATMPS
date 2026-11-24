import { describe, expect, it } from 'vitest'
import {
  addLayer,
  createDocument,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  duplicateLayer,
  removeLayer,
  renameLayer,
  reorderLayer,
  setLayerBlendMode,
  setLayerLocked,
  setLayerVisibility
} from '../src/core/document/model'

describe('document model', () => {
  it('creates documents with configurable dimensions', () => {
    const doc = createDocument({ name: 'Poster', width: 1920, height: 1080 })
    expect(doc.name).toBe('Poster')
    expect(doc.width).toBe(1920)
    expect(doc.height).toBe(1080)
    expect(doc.layers).toEqual([])
    expect(doc.version).toBe(1)
  })

  it('adds, renames, hides, duplicates, reorders, and removes layers', () => {
    let doc = createDocument({ name: 'T', width: 100, height: 100 })
    const a = createShapeLayer({ name: 'A', shape: 'rect', width: 10, height: 10 })
    const b = createTextLayer({ name: 'B', text: 'Hi' })
    doc = addLayer(doc, a)
    doc = addLayer(doc, b)
    expect(doc.layers).toHaveLength(2)
    expect(doc.activeLayerId).toBe(b.id)

    doc = renameLayer(doc, a.id, 'Alpha')
    expect(doc.layers[0]?.name).toBe('Alpha')

    doc = setLayerVisibility(doc, a.id, false)
    expect(doc.layers[0]?.visible).toBe(false)

    doc = duplicateLayer(doc, b.id)
    expect(doc.layers).toHaveLength(3)
    expect(doc.layers[2]?.name).toBe('B copy')

    doc = reorderLayer(doc, a.id, 2)
    expect(doc.layers[2]?.id).toBe(a.id)

    doc = removeLayer(doc, a.id)
    expect(doc.layers.find((l) => l.id === a.id)).toBeUndefined()
  })

  it('tracks image layer asset references without embedding pixels', () => {
    const layer = createImageLayer({
      name: 'photo.png',
      assetId: 'asset_1',
      naturalWidth: 640,
      naturalHeight: 480
    })
    expect(layer.kind).toBe('image')
    expect(layer.assetId).toBe('asset_1')
    expect(layer.naturalWidth).toBe(640)
    expect(layer.blendMode).toBe('normal')
  })

  it('supports lock and blend mode updates', () => {
    let doc = createDocument({ name: 'T', width: 100, height: 100 })
    const layer = createShapeLayer({ name: 'A', shape: 'rect', width: 10, height: 10 })
    doc = addLayer(doc, layer)
    doc = setLayerLocked(doc, layer.id, true)
    expect(doc.layers[0]?.locked).toBe(true)
    doc = setLayerBlendMode(doc, layer.id, 'multiply')
    expect(doc.layers[0]?.blendMode).toBe('multiply')
  })
})
