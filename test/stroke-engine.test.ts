import { describe, expect, it, beforeAll } from 'vitest'
import { dabSpacing } from '../src/core/rendering/stroke-engine'
import { EditorSession } from '../src/core/editor/session'
import { createRasterLayer } from '../src/core/document/model'

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    let n = 0
    URL.createObjectURL = () => `blob:test-${++n}`
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined
  }
})

describe('stroke engine', () => {
  it('spaces dabs as a fraction of brush size', () => {
    expect(dabSpacing(20)).toBe(5)
    expect(dabSpacing(1)).toBe(0.5)
  })
})

describe('paint target rules', () => {
  it('refuses locked layers instead of spawning a sibling', async () => {
    const session = new EditorSession()
    session.createNew({ name: 'Lock', width: 32, height: 32 })
    const layer = createRasterLayer({
      name: 'Paint',
      assetId: 'asset_locked',
      width: 32,
      height: 32
    })
    session.commitRasterStroke({
      layer,
      isNewLayer: true,
      bytes: new Uint8Array([1, 2, 3, 4]),
      label: 'Brush stroke'
    })
    session.toggleLock(layer.id)
    const target = await session.prepareRasterStrokeTarget()
    expect(target).toBeNull()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })

  it('Delete without selection does not remove the layer', async () => {
    const session = new EditorSession()
    session.createNew({ name: 'Del', width: 16, height: 16 })
    const layer = createRasterLayer({
      name: 'Keep',
      assetId: 'asset_keep',
      width: 16,
      height: 16
    })
    session.commitRasterStroke({
      layer,
      isNewLayer: true,
      bytes: new Uint8Array([9, 9, 9, 9]),
      label: 'Brush stroke'
    })
    await session.deleteSelectionOrLayer()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })
})
