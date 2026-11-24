/**
 * CDP smoke: select brush, paint 3 strokes, Ctrl+Z should leave layers/history stepping.
 * Usage: node scripts/smoke-paint-undo.mjs <websocketDebuggerUrl>
 */
const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node scripts/smoke-paint-undo.mjs <wsUrl>')
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

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails))
  }
  return result.result?.value
}

async function stroke(x0, y0, x1, y1) {
  // Prefer DOM pointer events on Fabric's upper-canvas (CDP Input is flaky here).
  await evaluate(`(() => {
    const el =
      document.querySelector('.canvas-host .upper-canvas') ||
      document.querySelector('.canvas-host canvas');
    if (!el) return false;
    const fire = (type, x, y, buttons = 1) => {
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        isPrimary: true, buttons, button: 0
      }));
      el.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse').replace('down','mousedown').replace('up','mouseup').replace('move','mousemove'), {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, buttons, button: 0
      }));
    };
    // Map names carefully
    const down = (x, y) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true, clientX:x, clientY:y, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:1, button:0 }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:x, clientY:y, buttons:1, button:0 }));
    };
    const move = (x, y) => {
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, cancelable:true, clientX:x, clientY:y, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:1, button:0 }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles:true, cancelable:true, clientX:x, clientY:y, buttons:1, button:0 }));
    };
    const up = (x, y) => {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, cancelable:true, clientX:x, clientY:y, pointerId:1, pointerType:'mouse', isPrimary:true, buttons:0, button:0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, clientX:x, clientY:y, buttons:0, button:0 }));
    };
    down(${x0}, ${y0});
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      move(${x0} + (${x1} - ${x0}) * t, ${y0} + (${y1} - ${y0}) * t);
    }
    up(${x1}, ${y1});
    return true;
  })()`)
  await new Promise((r) => setTimeout(r, 250))
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await new Promise((r) => setTimeout(r, 1000))

    // Ensure a document exists
    await evaluate(`(() => {
      const hasDoc = !!document.querySelector('.doc-tab.active');
      if (!hasDoc) {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('New Document'));
        if (btn) btn.click();
        const primary = document.querySelector('.new-doc-modal button.primary');
        if (primary) primary.click();
      }
      return !!document.querySelector('.doc-tab.active');
    })()`)

    // Click Brush by tooltip (rail order can change as tools are added)
    await evaluate(`(() => {
      const tools = [...document.querySelectorAll('.tools-rail button')];
      const brush = tools.find((b) => (b.getAttribute('title') || '').toLowerCase().includes('brush'));
      if (brush) brush.click();
      return { tools: tools.length, brushed: !!brush, title: brush?.getAttribute('title') };
    })()`)
    await new Promise((r) => setTimeout(r, 300))

    const rect = await evaluate(`(() => {
      const c =
        document.querySelector('.canvas-host .upper-canvas') ||
        document.querySelector('.canvas-host canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cls: c.className };
    })()`)
    console.log('canvasRect', rect)
    if (!rect) throw new Error('no canvas')

    const cx = Math.floor(rect.x + rect.w * 0.45)
    const cy = Math.floor(rect.y + rect.h * 0.45)

    for (let i = 0; i < 3; i++) {
      await stroke(cx, cy + i * 36, cx + 120, cy + 16 + i * 36)
      await new Promise((r) => setTimeout(r, 350))
    }

    const afterPaint = await evaluate(`(() => {
      const status = document.querySelector('.status-left')?.textContent || '';
      const layers = document.querySelectorAll('.layer-item').length;
      const fabricCanvas = document.querySelector('.canvas-host canvas');
      return { status, layers, hasCanvas: !!fabricCanvas };
    })()`)
    console.log('afterPaint', afterPaint)

    const fireUndo = `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true
      }));
      return document.querySelector('.status-left')?.textContent || '';
    })()`

    const afterUndo1Status = await evaluate(fireUndo)
    await new Promise((r) => setTimeout(r, 250))
    const afterUndo1 = await evaluate(`(() => ({
      status: document.querySelector('.status-left')?.textContent || '',
      layers: document.querySelectorAll('.layer-item').length
    }))()`)
    console.log('afterUndo1', { fired: afterUndo1Status, ...afterUndo1 })

    await evaluate(fireUndo)
    await new Promise((r) => setTimeout(r, 250))
    const afterUndo2 = await evaluate(`(() => ({
      status: document.querySelector('.status-left')?.textContent || '',
      layers: document.querySelectorAll('.layer-item').length
    }))()`)
    console.log('afterUndo2', afterUndo2)

    await evaluate(fireUndo)
    await new Promise((r) => setTimeout(r, 250))
    const afterUndo3 = await evaluate(`(() => ({
      status: document.querySelector('.status-left')?.textContent || '',
      layers: document.querySelectorAll('.layer-item').length
    }))()`)
    console.log('afterUndo3', afterUndo3)

    // After 1–2 undos layer remains; after undoing the creating stroke, layer may go to 0.
    const ok =
      afterPaint.layers >= 1 &&
      afterUndo1.layers >= 1 &&
      String(afterUndo1.status).toLowerCase().includes('undo') &&
      afterUndo2.layers >= 1

    console.log(ok ? 'PAINT_UNDO_SMOKE_OK' : 'PAINT_UNDO_SMOKE_FAIL')
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
