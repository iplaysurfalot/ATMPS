const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node scripts/smoke-cdp.mjs <websocketDebuggerUrl>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()

function send(method, params = {}) {
  const msgId = ++id
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await new Promise((r) => setTimeout(r, 1500))

    const expression = `(() => {
      const root = document.getElementById('root');
      const shell = document.querySelector('.app-shell');
      const menu = document.querySelector('.menu-bar');
      const tools = document.querySelector('.tools-rail');
      const empty = document.querySelector('.empty-state');
      const options = document.querySelector('.options-bar');
      const status = document.querySelector('.status-bar');
      const tabs = [...document.querySelectorAll('.doc-tab')].map((t) => t.innerText.trim());
      return {
        rootChildren: root ? root.childElementCount : -1,
        rootText: root ? root.innerText.slice(0, 500) : '',
        hasShell: !!shell,
        hasMenu: !!menu,
        hasTools: !!tools,
        hasEmpty: !!empty,
        hasOptions: !!options,
        hasStatus: !!status,
        atmpsType: typeof window.atmps,
        menuLabels: menu ? [...menu.querySelectorAll('.menu-trigger')].map((b) => b.textContent.trim()) : [],
        toolCount: tools ? tools.querySelectorAll('button').length : 0,
        tabs
      };
    })()`
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) {
      console.error('EVAL_EXCEPTION', JSON.stringify(result.exceptionDetails, null, 2))
      process.exit(1)
    }
    const v = result.result?.value
    console.log(JSON.stringify(v, null, 2))

    // Exercise New Document modal if empty, or confirm existing doc chrome
    const flow = await send('Runtime.evaluate', {
      expression: `(() => {
        const hasDoc = !!document.querySelector('.doc-tab.active');
        if (!hasDoc) {
          const newBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('New Document'));
          if (newBtn) newBtn.click();
        } else {
          const file = [...document.querySelectorAll('.menu-trigger')].find((b) => b.textContent.trim() === 'File');
          if (file) file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          const item = [...document.querySelectorAll('.menu-option')].find((b) => b.textContent.includes('New'));
          if (item) item.click();
        }
        const modal = document.querySelector('.new-doc-modal');
        if (modal) {
          const primary = modal.querySelector('button.primary');
          if (primary) primary.click();
        }
        return {
          tabs: [...document.querySelectorAll('.doc-tab')].map((t) => t.innerText.trim()),
          hasLayers: !!document.querySelector('.layers-panel'),
          hasProps: !!document.querySelector('.properties-panel'),
          toolCount: document.querySelectorAll('.tools-rail button').length
        };
      })()`,
      returnByValue: true
    })
    console.log('flow', JSON.stringify(flow.result?.value, null, 2))

    const ok =
      v &&
      v.hasShell &&
      v.hasMenu &&
      v.hasTools &&
      v.hasOptions &&
      v.hasStatus &&
      v.atmpsType === 'object' &&
      v.toolCount >= 9 &&
      v.menuLabels.includes('File') &&
      (v.hasEmpty || (flow.result?.value?.hasLayers && flow.result?.value?.tabs?.length > 0))

    process.exit(ok ? 0 : 2)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})

ws.addEventListener('error', (e) => {
  console.error(e)
  process.exit(1)
})
