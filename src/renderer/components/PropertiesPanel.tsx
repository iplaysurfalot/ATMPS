import type { AtmpsDocument, Layer } from '@shared/types'
import type { EditorSession } from '@core/editor/session'

interface Props {
  document: AtmpsDocument
  session: EditorSession
  tool: string
}

export function PropertiesPanel({ document, session, tool }: Props) {
  const layer = document.layers.find((l) => l.id === document.activeLayerId) ?? null

  return (
    <div className="panel properties-panel">
      <div className="panel-header">Properties</div>
      <div className="panel-body">
        {!layer && (
          <div className="props-empty">
            <div className="props-empty-title">No selection</div>
            <div>Select a layer or use the {tool} tool.</div>
          </div>
        )}

        {layer && (
          <>
            <div className="props-section-title">{layer.name}</div>
            <div className="props-row">
              <label>Kind</label>
              <span className="props-static">{layer.kind}</span>
            </div>
            <div className="props-row">
              <label>X</label>
              <input
                type="number"
                value={Math.round(layer.transform.x)}
                onChange={(e) =>
                  session.applyTransform(layer.id, { x: Number(e.target.value) }, 'Move')
                }
              />
            </div>
            <div className="props-row">
              <label>Y</label>
              <input
                type="number"
                value={Math.round(layer.transform.y)}
                onChange={(e) =>
                  session.applyTransform(layer.id, { y: Number(e.target.value) }, 'Move')
                }
              />
            </div>
            <div className="props-row">
              <label>W%</label>
              <input
                type="number"
                step={1}
                value={Math.round(layer.transform.scaleX * 100)}
                onChange={(e) =>
                  session.applyTransform(
                    layer.id,
                    { scaleX: Number(e.target.value) / 100 },
                    'Scale'
                  )
                }
              />
            </div>
            <div className="props-row">
              <label>H%</label>
              <input
                type="number"
                step={1}
                value={Math.round(layer.transform.scaleY * 100)}
                onChange={(e) =>
                  session.applyTransform(
                    layer.id,
                    { scaleY: Number(e.target.value) / 100 },
                    'Scale'
                  )
                }
              />
            </div>
            <div className="props-row">
              <label>Angle</label>
              <input
                type="number"
                value={Math.round(layer.transform.rotation)}
                onChange={(e) =>
                  session.applyTransform(layer.id, { rotation: Number(e.target.value) }, 'Rotate')
                }
              />
            </div>
            {(layer.kind === 'text' || layer.kind === 'shape') && (
              <div className="props-row">
                <label />
                <button type="button" onClick={() => void session.rasterizeLayer(layer.id)}>
                  Rasterize Layer
                </button>
              </div>
            )}
            {layer.kind === 'text' && <TextProps layer={layer} session={session} />}
            {layer.kind === 'shape' && <ShapeProps layer={layer} session={session} />}
          </>
        )}
      </div>
    </div>
  )
}

function TextProps({
  layer,
  session
}: {
  layer: Extract<Layer, { kind: 'text' }>
  session: EditorSession
}) {
  return (
    <>
      <div className="props-section-title">Character</div>
      <div className="props-row">
        <label>Text</label>
        <input
          type="text"
          value={layer.text}
          onChange={(e) => session.patchLayer(layer.id, { text: e.target.value }, 'Edit text')}
        />
      </div>
      <div className="props-row">
        <label>Size</label>
        <input
          type="number"
          min={8}
          max={512}
          value={layer.fontSize}
          onChange={(e) =>
            session.patchLayer(layer.id, { fontSize: Number(e.target.value) }, 'Font size')
          }
        />
      </div>
      <div className="props-row">
        <label>Color</label>
        <input
          type="color"
          value={layer.fill}
          onChange={(e) => session.patchLayer(layer.id, { fill: e.target.value }, 'Text color')}
        />
      </div>
      <div className="props-row">
        <label>Weight</label>
        <select
          value={layer.fontWeight}
          onChange={(e) =>
            session.patchLayer(
              layer.id,
              { fontWeight: e.target.value as 'normal' | 'bold' },
              'Font weight'
            )
          }
        >
          <option value="normal">Regular</option>
          <option value="bold">Bold</option>
        </select>
      </div>
    </>
  )
}

function ShapeProps({
  layer,
  session
}: {
  layer: Extract<Layer, { kind: 'shape' }>
  session: EditorSession
}) {
  return (
    <>
      <div className="props-section-title">Shape</div>
      <div className="props-row">
        <label>Fill</label>
        <input
          type="color"
          value={layer.fill}
          onChange={(e) => session.patchLayer(layer.id, { fill: e.target.value }, 'Shape fill')}
        />
      </div>
      <div className="props-row">
        <label>W</label>
        <input
          type="number"
          min={1}
          value={layer.width}
          onChange={(e) =>
            session.patchLayer(layer.id, { width: Number(e.target.value) }, 'Shape size')
          }
        />
      </div>
      <div className="props-row">
        <label>H</label>
        <input
          type="number"
          min={1}
          value={layer.height}
          onChange={(e) =>
            session.patchLayer(layer.id, { height: Number(e.target.value) }, 'Shape size')
          }
        />
      </div>
    </>
  )
}
