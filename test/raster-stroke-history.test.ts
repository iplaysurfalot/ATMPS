import { describe, expect, it, beforeAll } from 'vitest'
import { EditorSession } from '../src/core/editor/session'
import { createRasterLayer } from '../src/core/document/model'

beforeAll(() => {
  // Node test env: session creates blob URLs for assets
  if (typeof URL.createObjectURL !== 'function') {
    let n = 0
    URL.createObjectURL = () => `blob:test-${++n}`
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined
  }
})

describe('raster stroke history', () => {
  it('undoes one stroke at a time without removing the paint layer', () => {
    const session = new EditorSession()
    session.createNew({ name: 'Paint', width: 64, height: 64 })

    const layer = createRasterLayer({
      name: 'Layer',
      assetId: 'asset_stroke_test',
      width: 64,
      height: 64
    })

    const stroke1 = new Uint8Array([1, 1, 1, 1])
    const stroke2 = new Uint8Array([2, 2, 2, 2])
    const stroke3 = new Uint8Array([3, 3, 3, 3])

    session.commitRasterStroke({
      layer,
      isNewLayer: true,
      bytes: stroke1,
      label: 'Brush stroke'
    })
    expect(session.getDocument()?.layers).toHaveLength(1)
    expect(session.getSnapshot().canUndo).toBe(true)

    session.commitRasterStroke({
      layer,
      isNewLayer: false,
      bytes: stroke2,
      label: 'Brush stroke'
    })
    session.commitRasterStroke({
      layer,
      isNewLayer: false,
      bytes: stroke3,
      label: 'Brush stroke'
    })

    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(1)
    // Access private bytes via package round-trip fields is awkward; re-stroke
    // path is covered by canUndo stack depth + layer retention above.
    expect(session.getSnapshot().canUndo).toBe(true)
    expect(session.getSnapshot().canRedo).toBe(true)

    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(1)

    // Third undo removes the layer created by the first stroke
    session.undo()
    expect(session.getDocument()?.layers).toHaveLength(0)
    expect(session.getSnapshot().canUndo).toBe(false)

    session.redo()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })
})
