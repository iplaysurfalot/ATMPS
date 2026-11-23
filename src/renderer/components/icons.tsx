/** Compact SVG tool icons — Photoshop-style tool rail. */

interface IconProps {
  size?: number
}

export function IconMove({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 2v20M2 12h20M12 2l3 3M12 2l-3 3M12 22l3-3M12 22l-3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
    </svg>
  )
}

export function IconMarquee({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2">
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  )
}

export function IconBrush({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 15c-2 0-3 1.5-3 3 0 1.5 1.5 3 3 3 2.5 0 4-3 4-3" />
      <path d="M14 4l6 6-8 8-6-6 8-8z" />
    </svg>
  )
}

export function IconEraser({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 16l8-8 6 6-5 5H7l-3-3z" />
      <path d="M10 10l6 6" />
    </svg>
  )
}

export function IconText({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 6h14M12 6v14M8 20h8" />
    </svg>
  )
}

export function IconRect({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5" y="6" width="14" height="12" rx="1" />
    </svg>
  )
}

export function IconEllipse({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </svg>
  )
}

export function IconHand({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 11V6a1 1 0 012 0v5M11 10V5a1 1 0 012 0v5M14 10V6a1 1 0 012 0v6M17 11v3a5 5 0 01-5 5h-1a5 5 0 01-5-5v-4a1 1 0 012 0" />
    </svg>
  )
}

export function IconZoom({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="6" />
      <path d="M15 15l5 5M8 10h4M10 8v4" />
    </svg>
  )
}

export function IconEye({ size = 14, open = true }: IconProps & { open?: boolean }) {
  if (!open) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 3l18 18M10.5 10.5A3 3 0 0013.5 13.5M9.9 5.1A10 10 0 0121 12c-.6 1-1.4 2-2.4 2.8M6.1 6.1C4.4 7.4 3.1 9.1 2.2 12c1.8 4.5 6 7 9.8 7 1.5 0 3-.4 4.3-1.1" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconLock({ size = 14, locked = false }: IconProps & { locked?: boolean }) {
  if (locked) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 017.5-2" />
    </svg>
  )
}
