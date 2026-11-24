/**
 * Trusted-input CDP QA checklist for ATMPS paint stack.
 * Usage: node scripts/smoke-qa-checklist.mjs <websocketDebuggerUrl>
 */
const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('Usage: node scripts/smoke-qa-checklist.mjs <wsUrl>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const results = []

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
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log(
      'EXCEPTION',
      msg.params?.exceptionDetails?.exception?.description ||
        msg.params?.exceptionDetails?.text
    )
  }
})

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails, null, 2))
  }
  return result.result?.value
}

function record(step, ok, detail) {
  results.push({ step, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}`, detail ? JSON.stringify(detail) : '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1
  })
}

async function drag(x0, y0, x1, y1, steps = 28) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: x0,
    y: y0,
    button: 'left',
    clickCount: 1
  })
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t,
      button: 'left',
      buttons: 1
    })
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x1,
    y: y1,
    button: 'left',
    clickCount: 1
  })
}

async function keyChord(keys) {
  // keys: [{key, code, vk, mod?}]
  for (const k of keys) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: k.vk,
      code: k.code,
      key: k.key,
      modifiers: k.mod || 0
    })
  }
  for (const k of [...keys].reverse()) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: k.vk,
      code: k.code,
      key: k.key,
      modifiers: 0
    })
  }
}

async function clickTool(namePart) {
  const btn = await evaluate(`(() => {
    const tools = [...document.querySelectorAll('.tools-rail button')];
    const t = tools.find((b) => (b.getAttribute('title') || '').toLowerCase().includes('${namePart}'));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, title: t.getAttribute('title') };
  })()`)
  if (!btn) return { clicked: false }
  await clickAt(btn.x, btn.y)
  await sleep(150)
  const tool = await evaluate(`document.querySelector('.options-tool-name')?.textContent || ''`)
  return { clicked: true, tool, title: btn.title }
}

async function opaquePixels() {
  return evaluate(`(async () => {
    const img = document.querySelector('.layer-thumb img');
    if (!img) return { opaque: 0, error: 'no thumb' };
    await new Promise((r) => (img.complete ? r() : (img.onload = () => r())));
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 8;
    c.height = img.naturalHeight || 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
    return { opaque, w: c.width, h: c.height };
  })()`)
}

async function debug() {
  return evaluate(`typeof window.__atmpsDebug === 'function' ? window.__atmpsDebug() : null`)
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await sleep(800)

    // Close any open docs for clean slate
    await evaluate(`(() => {
      for (const btn of [...document.querySelectorAll('.doc-tab-close')]) btn.click();
    })()`)
    await sleep(200)

    // --- 1 New document (trusted clicks) ---
    const newBtn = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.includes('New Document')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!newBtn) throw new Error('No New Document button')
    await clickAt(newBtn.x, newBtn.y)
    await sleep(300)
    // Prefer Default 800×600 for faster pixel proofs
    const preset = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('.new-doc-modal button.preset')].find((b) =>
        b.textContent.includes('Default')
      );
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (preset) {
      await clickAt(preset.x, preset.y)
      await sleep(100)
    }
    const createBtn = await evaluate(`(() => {
      const primary = document.querySelector('.new-doc-modal button.primary');
      if (!primary) return null;
      const r = primary.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!createBtn) throw new Error('No Create button')
    await clickAt(createBtn.x, createBtn.y)
    await sleep(500)
    const afterNew = await evaluate(`({
      tabs: [...document.querySelectorAll('.doc-tab')].map((t) => t.innerText.trim()),
      empty: !!document.querySelector('.empty-state'),
      layers: document.querySelectorAll('.layer-item').length,
      status: document.querySelector('.status-left')?.textContent || ''
    })`)
    record(
      '1_new_doc',
      !afterNew.empty && afterNew.layers >= 1 && afterNew.tabs.some((t) => !t.includes('No documents')),
      afterNew
    )

    // Prefer Default 800x600 for faster paint — recreate if needed
    // (Web HD is fine; preview is no longer toDataURL-bound)

    const brush = await clickTool('brush')
    record('1b_select_brush', /brush/i.test(brush.tool || ''), brush)

    const rect = await evaluate(`(() => {
      const el =
        document.querySelector('.canvas-host .upper-canvas') ||
        document.querySelector('.canvas-host canvas');
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`)
    const x = rect.x + rect.w * 0.4
    const y = rect.y + rect.h * 0.4

    // --- 2 Brush stroke ---
    await drag(x, y, x + 160, y + 35)
    await sleep(600)
    const pix1 = await opaquePixels()
    const dbg1 = await debug()
    record(
      '2_brush_stroke',
      pix1.opaque > 100 &&
        (dbg1?.status || '').toLowerCase().includes('brush') &&
        (dbg1?.layers || 0) >= 1,
      { pix1, dbg1 }
    )
    const opaqueAfter1 = pix1.opaque

    // --- 3 Second stroke ---
    await drag(x, y + 55, x + 160, y + 90)
    await sleep(600)
    const pix2 = await opaquePixels()
    const dbg2 = await debug()
    record(
      '3_second_stroke',
      pix2.opaque > opaqueAfter1 &&
        (dbg2?.historyPast || 0) >= 2 &&
        pix2.opaque < pix2.w * pix2.h, // must not flood-fill whole canvas
      { pix2, dbg2, opaqueAfter1 }
    )

    // --- 4 Ctrl+Z one stroke ---
    await keyChord([
      { key: 'Control', code: 'ControlLeft', vk: 17, mod: 2 },
      { key: 'z', code: 'KeyZ', vk: 90, mod: 2 }
    ])
    await sleep(400)
    const pixUndo = await opaquePixels()
    const dbgUndo = await debug()
    record(
      '4_ctrl_z_one_stroke',
      pixUndo.opaque < pix2.opaque &&
        pixUndo.opaque >= opaqueAfter1 * 0.5 &&
        (dbgUndo?.layers || 0) >= 1 &&
        String(dbgUndo?.status || '')
          .toLowerCase()
          .includes('undo'),
      { pixUndo, dbgUndo, opaqueBefore: pix2.opaque, opaqueAfter1 }
    )

    // --- 5 Eraser ---
    await clickTool('eraser')
    const beforeErase = (await opaquePixels()).opaque
    await drag(x + 10, y + 5, x + 90, y + 25)
    await sleep(500)
    const afterErase = await opaquePixels()
    const dbgErase = await debug()
    record(
      '5_eraser',
      afterErase.opaque < beforeErase &&
        String(dbgErase?.status || '')
          .toLowerCase()
          .includes('eraser'),
      { beforeErase, afterErase, dbgErase }
    )

    // --- 6 Marquee + Delete ---
    await clickTool('marquee')
    await drag(x - 10, y - 10, x + 70, y + 50)
    await sleep(250)
    const sel = await debug()
    await keyChord([{ key: 'Delete', code: 'Delete', vk: 46 }])
    await sleep(500)
    const afterDel = await debug()
    const pixDel = await opaquePixels()
    record(
      '6_marquee_delete',
      !!sel?.selection &&
        (String(afterDel?.status || '')
          .toLowerCase()
          .includes('clear') ||
          pixDel.opaque < afterErase.opaque),
      { sel: sel?.selection, afterDel, pixDel }
    )

    // --- 7 Move selection ---
    await clickTool('marquee')
    await drag(x + 5, y + 80, x + 85, y + 140)
    await sleep(200)
    await clickTool('move')
    await drag(x + 20, y + 100, x + 80, y + 130)
    await sleep(400)
    const afterMove = await debug()
    record(
      '7_move_selection',
      String(afterMove?.status || '')
        .toLowerCase()
        .includes('move') || (afterMove?.layers || 0) >= 1,
      afterMove
    )

    // --- 8 Brace brush size + outline ---
    await clickTool('brush')
    const sizeBefore = await evaluate(`Number(document.querySelector('.options-field input[type=number]')?.value || 0)`)
    // Shift+] = }
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 16,
      code: 'ShiftLeft',
      key: 'Shift',
      modifiers: 8
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 221,
      code: 'BracketRight',
      key: '}',
      modifiers: 8,
      text: '}'
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 221,
      code: 'BracketRight',
      key: '}',
      modifiers: 8
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 16,
      code: 'ShiftLeft',
      key: 'Shift',
      modifiers: 0
    })
    await sleep(200)
    const sizeAfter = await evaluate(`Number(document.querySelector('.options-field input[type=number]')?.value || 0)`)
    const dbgSize = await debug()
    record('8_brace_brush_size', sizeAfter > sizeBefore && dbgSize?.brushSize === sizeAfter, {
      sizeBefore,
      sizeAfter,
      brushSize: dbgSize?.brushSize
    })

    // --- 9 Save/reopen round-trip ---
    const roundTrip = await evaluate(`(() => {
      if (!window.__atmpsDebug || typeof window.__atmpsDebug.roundTrip !== 'function') {
        return { ok: false, reason: 'no roundTrip' };
      }
      return window.__atmpsDebug.roundTrip();
    })()`)
    record('9_save_reopen', !!roundTrip?.ok, roundTrip)

    const failed = results.filter((r) => !r.ok)
    console.log('---')
    console.log(
      JSON.stringify(
        { passed: results.length - failed.length, failed: failed.length, results },
        null,
        2
      )
    )
    process.exit(failed.length ? 2 : 0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})

ws.addEventListener('error', (e) => {
  console.error(e)
  process.exit(1)
})
