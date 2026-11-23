import type { AtmpsDocument, Layer } from '@shared/types'
import type { EditorSession } from '@core/editor/session'

interface Props {
  document: AtmpsDocument
  session: EditorSession
  brushSize: number
  brushColor: string
  tool: string
}

export function PropertiesPanel({ document, session, brushSize, brushColor, tool }: Props) {
  const layer = document.layers.find((l) => l.id === document.activeLayerId) ?? null

  return (
    <div className="panel">
      <div className="panel-header">Properties</div>
      <div className="panel-body">
        {(tool === 'brush' || tool === 'eraser') && (
          <>
            <div className="props-row">
              <label>Brush size</label>
              <input
                type="range"
                min={1}
                max={120}
                value={brushSize}
                onChange={(e) => session.setBrushSize(Number(e.target.value))}
              />
            </div>
            {tool === 'brush' && (
              <div className="props-row">
                <label>Color</label>
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => session.setBrushColor(e.target.value)}
                />
              </div>
            )}
          </>
        )}

        {!layer && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Select a layer</div>}

        {layer && (
          <>
            <div className="props-row">
              <label>Opacity</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(layer.opacity * 100)}
                onChange={(e) => session.setOpacity(layer.id, Number(e.target.value) / 100)}
              />
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
              <label>Rotation</label>
              <input
                type="number"
                value={Math.round(layer.transform.rotation)}
                onChange={(e) =>
                  session.applyTransform(layer.id, { rotation: Number(e.target.value) }, 'Rotate')
                }
              />
            </div>
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
    <div className="props-row">
      <label>Fill</label>
      <input
        type="color"
        value={layer.fill}
        onChange={(e) => session.patchLayer(layer.id, { fill: e.target.value }, 'Shape fill')}
      />
    </div>
  )
}
