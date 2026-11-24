import { describe, expect, it, beforeAll } from 'vitest'
import { dabSpacing } from '../src/core/rendering/stroke-engine'
import { EditorSession } from '../src/core/editor/session'

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
  it('seeds a blank layer on new document', () => {
    const session = new EditorSession()
    session.createNew({ name: 'Seed', width: 32, height: 32 })
    expect(session.getDocument()?.layers).toHaveLength(1)
    expect(session.getDocument()?.activeLayerId).toBeTruthy()
  })

  it('refuses locked layers instead of spawning a sibling', async () => {
    const session = new EditorSession()
    session.createNew({ name: 'Lock', width: 32, height: 32 })
    const layerId = session.getDocument()!.activeLayerId!
    session.toggleLock(layerId)
    const target = await session.prepareRasterStrokeTarget()
    expect(target).toBeNull()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })

  it('Delete without selection does not remove the layer', async () => {
    const session = new EditorSession()
    session.createNew({ name: 'Del', width: 16, height: 16 })
    expect(session.getDocument()?.layers).toHaveLength(1)
    await session.deleteSelectionOrLayer()
    expect(session.getDocument()?.layers).toHaveLength(1)
  })
})
