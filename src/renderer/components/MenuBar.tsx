import { useEffect, useRef, useState } from 'react'

export interface MenuAction {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  separator?: boolean
  onClick?: () => void
}

export interface MenuDef {
  id: string
  label: string
  items: MenuAction[]
}

interface Props {
  menus: MenuDef[]
}

export function MenuBar({ menus }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [openId])

  return (
    <div className="menu-bar" ref={rootRef}>
      <div className="brand" title="ATMPS">
        ATMPS
      </div>
      {menus.map((menu) => (
        <div key={menu.id} className={`menu-item${openId === menu.id ? ' open' : ''}`}>
          <button
            type="button"
            className="menu-trigger"
            onMouseDown={(e) => {
              e.preventDefault()
              setOpenId((cur) => (cur === menu.id ? null : menu.id))
            }}
            onMouseEnter={() => {
              if (openId) setOpenId(menu.id)
            }}
          >
            {menu.label}
          </button>
          {openId === menu.id && (
            <div className="menu-dropdown">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={`sep-${i}`} className="menu-sep" />
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className="menu-option"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick?.()
                      setOpenId(null)
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
