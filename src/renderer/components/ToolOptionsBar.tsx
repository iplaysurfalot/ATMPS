import type { EditorSession, EditorSnapshot } from '@core/editor/session'
import type { ToolId } from '@shared/types'

interface Props {
  session: EditorSession
  snapshot: EditorSnapshot
}

const TOOL_LABEL: Record<ToolId, string> = {
  move: 'Move',
  marquee: 'Rectangular Marquee',
  brush: 'Brush',
  eraser: 'Eraser',
  text: 'Type',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  hand: 'Hand',
  zoom: 'Zoom'
}

export function ToolOptionsBar({ session, snapshot }: Props) {
  const tool = snapshot.tool
  const showBrush = tool === 'brush' || tool === 'eraser'

  return (
    <div className="options-bar">
      <span className="options-tool-name">{TOOL_LABEL[tool]}</span>
      <div className="options-sep" />

      {showBrush && (
        <>
          <label className="options-field">
            <span>Size</span>
            <input
              type="range"
              min={1}
              max={500}
              value={snapshot.brushSize}
              onChange={(e) => session.setBrushSize(Number(e.target.value))}
            />
            <input
              className="options-num"
              type="number"
              min={1}
              max={500}
              value={snapshot.brushSize}
              onChange={(e) => session.setBrushSize(Number(e.target.value))}
            />
          </label>
          <label className="options-field">
            <span>Hardness</span>
            <input
              type="range"
              min={0}
              max={100}
              value={snapshot.brushHardness}
              onChange={(e) => session.setBrushHardness(Number(e.target.value))}
            />
            <span className="options-val">{snapshot.brushHardness}%</span>
          </label>
          <label className="options-field">
            <span>Opacity</span>
            <input
              type="range"
              min={1}
              max={100}
              value={snapshot.brushOpacity}
              onChange={(e) => session.setBrushOpacity(Number(e.target.value))}
            />
            <span className="options-val">{snapshot.brushOpacity}%</span>
          </label>
          {tool === 'brush' && (
            <label className="options-field">
              <span>Color</span>
              <input
                type="color"
                value={snapshot.brushColor}
                onChange={(e) => session.setBrushColor(e.target.value)}
              />
            </label>
          )}
        </>
      )}

      {tool === 'move' && (
        <span className="options-hint">Drag to move · handles to scale/rotate · Esc clears selection</span>
      )}
      {tool === 'marquee' && (
        <span className="options-hint">Drag on canvas · Ctrl+D deselect</span>
      )}
      {tool === 'hand' && <span className="options-hint">Drag to pan · hold Space for temporary Hand</span>}
      {tool === 'zoom' && (
        <span className="options-hint">Click zoom in · Alt+click zoom out · Ctrl+scroll toward cursor</span>
      )}
      {(tool === 'rect' || tool === 'ellipse' || tool === 'text') && (
        <span className="options-hint">Click tool to place a new layer, then edit in Properties</span>
      )}
    </div>
  )
}
