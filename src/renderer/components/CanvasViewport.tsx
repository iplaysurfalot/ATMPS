import { useEffect, useRef } from 'react'
import { FabricController } from '@core/rendering/fabric-controller'
import type { EditorSession } from '@core/editor/session'
import type { EditorSnapshot } from '@core/editor/session'

interface Props {
  session: EditorSession
  snapshot: EditorSnapshot
  controllerRef: React.MutableRefObject<FabricController | null>
}

export function CanvasViewport({ session, snapshot, controllerRef }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDocId = useRef<string | null>(null)
  const lastSig = useRef<string>('')

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
    controller.setTool(snapshot.tool, snapshot.brushSize, snapshot.brushColor)
  }, [snapshot.tool, snapshot.brushSize, snapshot.brushColor, controllerRef])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setZoom(snapshot.zoom)
  }, [snapshot.zoom, controllerRef])

  useEffect(() => {
    const controller = controllerRef.current
    const doc = snapshot.document
    if (!controller || !doc) return

    const sig = JSON.stringify({
      id: doc.id,
      updatedAt: doc.updatedAt,
      active: doc.activeLayerId,
      layers: doc.layers,
      urls: snapshot.assetUrls
    })

    // Always sync on new document; skip identical signatures.
    if (doc.id === lastDocId.current && sig === lastSig.current) return
    lastDocId.current = doc.id
    lastSig.current = sig
    void controller.syncFromDocument(doc, snapshot.assetUrls)
  }, [snapshot.document, snapshot.assetUrls, controllerRef])

  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas ref={canvasRef} />
      {!snapshot.document && (
        <div className="empty-state">
          <div>
            <strong>ATMPS</strong>
            Create a document or open a project to begin.
            <div style={{ marginTop: 8, fontSize: 12 }}>Ctrl+N · Ctrl+O · Ctrl+S</div>
          </div>
        </div>
      )}
    </div>
  )
}
