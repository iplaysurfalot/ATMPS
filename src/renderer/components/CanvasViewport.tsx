import { useEffect, useRef } from 'react'
import { FabricController } from '@core/rendering/fabric-controller'
import type { EditorSession } from '@core/editor/session'
import type { EditorSnapshot } from '@core/editor/session'

interface Props {
  session: EditorSession
  snapshot: EditorSnapshot
  controllerRef: React.MutableRefObject<FabricController | null>
  onRequestNew: () => void
  onRequestOpen: () => void
}

export function CanvasViewport({
  session,
  snapshot,
  controllerRef,
  onRequestNew,
  onRequestOpen
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDocId = useRef<string | null>(null)
  const lastStructureSig = useRef<string>('')
  const lastUrlsSig = useRef<string>('')
  const lastVisualsSig = useRef<string>('')
  const lastSelectionSig = useRef<string>('')

  useEffect(() => {
    const canvasEl = canvasRef.current
    const host = hostRef.current
    if (!canvasEl || !host) return

    const controller = new FabricController(canvasEl, session)
    controllerRef.current = controller

    const resize = () => {
      const rect = host.getBoundingClientRect()
      controller.resizeViewport(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    return () => {
      ro.disconnect()
      controller.dispose()
      controllerRef.current = null
    }
  }, [session, controllerRef])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    // Mid-stroke size/hardness nudges update next dab only (controller guards rebuild).
    controller.setTool(
      snapshot.tool,
      snapshot.brushSize,
      snapshot.brushColor,
      snapshot.brushOpacity,
      snapshot.brushHardness,
      snapshot.brushFlow
    )
  }, [
    snapshot.tool,
    snapshot.brushSize,
    snapshot.brushColor,
    snapshot.brushOpacity,
    snapshot.brushHardness,
    snapshot.brushFlow,
    controllerRef
  ])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setZoom(snapshot.zoom)
  }, [snapshot.zoom, controllerRef])

  // Selection overlay only — never canvas.clear()
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller || !snapshot.document) return
    const sig = JSON.stringify(snapshot.selection)
    if (sig === lastSelectionSig.current) return
    lastSelectionSig.current = sig
    controller.syncSelectionOverlay()
  }, [snapshot.selection, snapshot.document, controllerRef])

  // Opacity / blend live without remount
  useEffect(() => {
    const controller = controllerRef.current
    const doc = snapshot.document
    if (!controller || !doc) return
    const visualsSig = JSON.stringify(
      doc.layers.map((l) => ({ id: l.id, opacity: l.opacity, blendMode: l.blendMode }))
    )
    if (visualsSig === lastVisualsSig.current) return
    lastVisualsSig.current = visualsSig
    for (const layer of doc.layers) {
      controller.applyLayerVisuals(layer.id, {
        opacity: layer.opacity,
        blendMode: layer.blendMode
      })
    }
  }, [snapshot.document, controllerRef])

  useEffect(() => {
    const controller = controllerRef.current
    const doc = snapshot.document
    if (!controller || !doc) return

    // Structure excludes selection / opacity / blend — those are patched in place.
    // Omit updatedAt / opacity / blend / selection — those must not remount Fabric.
    const structureSig = JSON.stringify({
      id: doc.id,
      active: doc.activeLayerId,
      layers: doc.layers.map((l) => ({
        id: l.id,
        kind: l.kind,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        transform: l.transform,
        ...(l.kind === 'shape'
          ? { shape: l.shape, width: l.width, height: l.height, fill: l.fill }
          : {}),
        ...(l.kind === 'text'
          ? { text: l.text, fontSize: l.fontSize, fill: l.fill, fontWeight: l.fontWeight }
          : {}),
        ...(l.kind === 'image' || l.kind === 'raster' ? { assetId: l.assetId } : {})
      }))
    })
    const urlsSig = JSON.stringify(snapshot.assetUrls)

    const isNewDoc = doc.id !== lastDocId.current
    const structureChanged = isNewDoc || structureSig !== lastStructureSig.current
    const urlsChanged = urlsSig !== lastUrlsSig.current

    if (!structureChanged && !urlsChanged) return

    lastDocId.current = doc.id
    lastStructureSig.current = structureSig
    lastUrlsSig.current = urlsSig

    if (!structureChanged && urlsChanged) {
      void controller.refreshAssetUrls(doc, snapshot.assetUrls)
      return
    }

    void controller.syncFromDocument(doc, snapshot.assetUrls).then(() => {
      lastSelectionSig.current = JSON.stringify(snapshot.selection)
      lastVisualsSig.current = JSON.stringify(
        doc.layers.map((l) => ({ id: l.id, opacity: l.opacity, blendMode: l.blendMode }))
      )
      if (isNewDoc) {
        const z = controller.zoomToFit(doc.width, doc.height)
        session.setZoom(z)
      }
    })
  }, [snapshot.document, snapshot.assetUrls, controllerRef, session])

  const ruler = snapshot.showRulers && snapshot.document

  return (
    <div className={`canvas-stage${ruler ? ' with-rulers' : ''}`}>
      {ruler && (
        <>
          <div className="ruler-corner" />
          <div className="ruler ruler-h" aria-hidden>
            <RulerMarks length={snapshot.document!.width} zoom={snapshot.zoom} horizontal />
          </div>
          <div className="ruler ruler-v" aria-hidden>
            <RulerMarks length={snapshot.document!.height} zoom={snapshot.zoom} horizontal={false} />
          </div>
        </>
      )}
      <div className="canvas-host" ref={hostRef}>
        <canvas ref={canvasRef} />
        {!snapshot.document && (
          <div className="empty-state">
            <div className="empty-card">
              <div className="empty-logo">ATMPS</div>
              <h1>Create something</h1>
              <p>Local-first image editor. No accounts. Your files stay on this machine.</p>
              <div className="empty-actions">
                <button type="button" className="primary" onClick={onRequestNew}>
                  New Document
                </button>
                <button type="button" onClick={onRequestOpen}>
                  Open Project
                </button>
              </div>
              <div className="empty-keys">
                <kbd>Ctrl</kbd>+<kbd>N</kbd> New · <kbd>Ctrl</kbd>+<kbd>O</kbd> Open ·{' '}
                <kbd>Ctrl</kbd>+<kbd>S</kbd> Save
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RulerMarks({
  length,
  zoom,
  horizontal
}: {
  length: number
  zoom: number
  horizontal: boolean
}) {
  const step = zoom >= 2 ? 50 : zoom >= 1 ? 100 : 200
  const marks: number[] = []
  for (let i = 0; i <= length; i += step) marks.push(i)
  return (
    <div className={`ruler-marks${horizontal ? ' h' : ' v'}`}>
      {marks.map((m) => (
        <span
          key={m}
          className="ruler-tick"
          style={
            horizontal
              ? { left: `${m * zoom}px` }
              : { top: `${m * zoom}px` }
          }
        >
          {m}
        </span>
      ))}
    </div>
  )
}
