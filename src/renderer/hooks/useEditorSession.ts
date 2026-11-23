import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { EditorSession, type EditorSnapshot } from '@core/editor/session'

const sessionSingleton = new EditorSession()

export function getEditorSession(): EditorSession {
  return sessionSingleton
}

export function useEditorSession(): EditorSnapshot {
  const session = useMemo(() => sessionSingleton, [])
  return useSyncExternalStore(
    (onStoreChange) => session.subscribe(onStoreChange),
    () => session.getSnapshot(),
    () => session.getSnapshot()
  )
}

export function useSessionInstance(): EditorSession {
  const [session] = useState(() => sessionSingleton)
  useEffect(() => {
    // keep hook stable
  }, [])
  return session
}
