import type { EditorSession, EditorSnapshot } from '@core/editor/session'
import type { ToolId } from '@shared/types'

interface Props {
  session: EditorSession
  snapshot: EditorSnapshot
  onApplyCrop?: () => void
}

const TOOL_LABEL: Record<ToolId, string> = {
  move: 'Move',
  marquee: 'Rectangular Marquee',
  lasso: 'Lasso',
  polylasso: 'Polygonal Lasso',
  crop: 'Crop',
  brush: 'Brush',
  eraser: 'Eraser',
  eyedropper: 'Eyedropper',
  bucket: 'Paint Bucket',
  gradient: 'Gradient',
  clone: 'Clone Stamp',
  text: 'Type',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  hand: 'Hand',
  zoom: 'Zoom'
}

export function ToolOptionsBar({ session, snapshot, onApplyCrop }: Props) {
  const tool = snapshot.tool
  const showBrush = tool === 'brush' || tool === 'eraser' || tool === 'clone'
  const showFill = tool === 'bucket' || tool === 'gradient'

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
            <span className="options-hint-inline">[ ] {'{ }'}</span>
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
              <span>Flow</span>
              <input
                type="range"
                min={1}
                max={100}
                value={snapshot.brushFlow}
                onChange={(e) => session.setBrushFlow(Number(e.target.value))}
              />
              <span className="options-val">{snapshot.brushFlow}%</span>
            </label>
          )}
          {(tool === 'brush' || tool === 'clone') && (
            <label className="options-field">
              <span>Color</span>
              <input
                type="color"
                value={snapshot.brushColor}
                onChange={(e) => session.setBrushColor(e.target.value)}
              />
            </label>
          )}
          {tool === 'clone' && (
            <span className="options-hint">Alt+click to set source, then paint</span>
          )}
        </>
      )}

      {showFill && (
        <>
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
          <label className="options-field">
            <span>Color</span>
            <input
              type="color"
              value={snapshot.brushColor}
              onChange={(e) => session.setBrushColor(e.target.value)}
            />
          </label>
          {tool === 'bucket' && (
            <label className="options-field">
              <span>Tolerance</span>
              <input
                type="range"
                min={0}
                max={255}
                value={snapshot.fillTolerance}
                onChange={(e) => session.setFillTolerance(Number(e.target.value))}
              />
              <span className="options-val">{snapshot.fillTolerance}</span>
            </label>
          )}
          {tool === 'gradient' && (
            <span className="options-hint">Drag to paint a linear fade to transparent</span>
          )}
        </>
      )}

      {tool === 'move' && (
        <span className="options-hint">
          Drag selection to move pixels · Esc cancels float / deselects · Ctrl+D deselect
        </span>
      )}
      {tool === 'marquee' && (
        <span className="options-hint">Drag · Delete clears pixels · Esc / Ctrl+D deselect</span>
      )}
      {tool === 'lasso' && <span className="options-hint">Drag a freeform selection</span>}
      {tool === 'polylasso' && (
        <span className="options-hint">Click to add points · double-click to close</span>
      )}
      {tool === 'crop' && (
        <>
          <span className="options-hint">Drag crop · Enter applies · Esc cancels</span>
          <button
            type="button"
            className="options-btn"
            disabled={!snapshot.selection}
            onClick={() =>
              onApplyCrop
                ? onApplyCrop()
                : snapshot.selection && void session.cropToRect(snapshot.selection)
            }
          >
            Apply Crop
          </button>
        </>
      )}
      {tool === 'eyedropper' && <span className="options-hint">Click canvas to sample foreground color</span>}
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
