import type { EditorSession, EditorSnapshot } from '@core/editor/session'

interface Props {
  session: EditorSession
  snapshot: EditorSnapshot
}

export function HistoryPanel({ session, snapshot }: Props) {
  const { past, current, future } = snapshot.historyPanel

  return (
    <div className="panel history-panel">
      <div className="panel-header">
        <span>History</span>
        <div className="panel-header-actions">
          <button type="button" title="Undo" disabled={!snapshot.canUndo} onClick={() => session.undo()}>
            ↶
          </button>
          <button type="button" title="Redo" disabled={!snapshot.canRedo} onClick={() => session.redo()}>
            ↷
          </button>
        </div>
      </div>
      <div className="panel-body history-list">
        {past.length === 0 && future.length === 0 && (
          <div className="history-empty">No edits yet — each stroke is one step</div>
        )}
        {past.map((label, i) => (
          <div key={`p-${i}-${label}`} className="history-item past">
            {label}
          </div>
        ))}
        <div className="history-item current">{current}</div>
        {future.map((label, i) => (
          <div key={`f-${i}-${label}`} className="history-item future">
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
