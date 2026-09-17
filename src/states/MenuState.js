// MenuState — menu principal: Novo Jogo / Continuar / Configurações.
// Mouse (hover + clique) e teclado (setas + Enter, Esc volta). "Continuar" fica
// visualmente desabilitado sem save. "Novo Jogo" com save existente pede
// confirmação de sobrescrita. Configurações = painel simples (sem função real ainda).

import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { UI, font, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  createKeyWatcher,
  drawPaperCard,
  drawButton,
  pointInRect,
  wrapText,
  fadeScreen,
} from '../ui/HUD.js'

const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Enter', 'NumpadEnter', 'Space', 'Escape']

const backdrop = createPaperBackdrop({ seed: 31 })
let keys = null
let t = 0
let mode = 'main' // 'main' | 'confirm' | 'settings'
let selected = 0
let modalSelected = 1
let lastPointer = null
let hasSave = false

function mainItems() {
  return [
    { id: 'new', label: 'Novo Jogo' },
    { id: 'continue', label: 'Continuar', disabled: !hasSave, caption: hasSave ? '' : 'nenhuma vida registrada' },
    { id: 'settings', label: 'Configurações' },
  ]
}

function computeLayout(w, h) {
  const wide = w >= 820 && h >= 480
  const btnW = Math.min(300, w - 48)
  const btnH = 56
  const gap = 16
  const titleSize = wide ? Math.min(64, w * 0.055) : Math.max(32, Math.min(52, w * 0.1))
  let plate, titleX, titleY, align, btnX, btnY0
  if (wide) {
    const colX = w * 0.1
    plate = { cx: w * 0.68, cy: h * 0.5, R: Math.min(w * 0.22, h * 0.34) }
    titleX = colX
    titleY = h * 0.5 - (btnH * 3 + gap * 2) / 2 - titleSize * 0.9
    align = 'left'
    btnX = colX
    btnY0 = titleY + titleSize * 0.9
  } else {
    plate = { cx: w / 2, cy: h * 0.2, R: Math.min(w * 0.3, h * 0.13) }
    titleX = w / 2
    titleY = plate.cy + plate.R * 1.35 + titleSize * 0.6
    align = 'center'
    btnX = (w - btnW) / 2
    btnY0 = titleY + titleSize * 0.9
  }
  const buttons = mainItems().map((item, i) => ({ ...item, rect: { x: btnX, y: btnY0 + i * (btnH + gap), w: btnW, h: btnH } }))

  const cardW = Math.min(460, w - 32)
  const cardH = mode === 'settings' ? 300 : 210
  const card = { x: (w - cardW) / 2, y: (h - cardH) / 2, w: cardW, h: cardH }
  const mbW = Math.min(170, (cardW - 60) / 2)
  const modalButtons =
    mode === 'confirm'
      ? [
          { id: 'confirmNew', label: 'Recomeçar', rect: { x: card.x + cardW / 2 - mbW - 10, y: card.y + cardH - 76, w: mbW, h: 48 } },
          { id: 'cancel', label: 'Cancelar', rect: { x: card.x + cardW / 2 + 10, y: card.y + cardH - 76, w: mbW, h: 48 } },
        ]
      : [{ id: 'back', label: 'Voltar', rect: { x: card.x + (cardW - mbW) / 2, y: card.y + cardH - 76, w: mbW, h: 48 } }]

  return { wide, plate, titleX, titleY, titleSize, align, buttons, card, modalButtons }
}

function nextEnabled(items, from, dir) {
  for (let step = 1; step <= items.length; step++) {
    const i = (from + dir * step + items.length) % items.length
    if (!items[i].disabled) return i
  }
  return from
}

function activate(context, id) {
  switch (id) {
    case 'new':
      if (hasSave) {
        mode = 'confirm'
        modalSelected = 1
      } else context.newGame()
      break
    case 'continue':
      if (hasSave) context.continueGame()
      break
    case 'settings':
      mode = 'settings'
      modalSelected = 0
      break
    case 'confirmNew':
      mode = 'main'
      context.newGame()
      break
    case 'cancel':
    case 'back':
      mode = 'main'
      break
  }
}

export default {
  enter(context) {
    t = 0
    mode = 'main'
    hasSave = !!context.hasSave?.()
    selected = hasSave ? 1 : 0
    keys = createKeyWatcher(context.input, KEYS)
    keys.prime()
    context.input.consumeClicks()
    lastPointer = context.input.getPointer()
  },

  update(context, dt) {
    t += dt
    const L = computeLayout(context.width, context.height)
    const pressed = keys.poll()
    const clicks = context.input.consumeClicks()
    const pointer = context.input.getPointer()
    const moved = !lastPointer || Math.hypot(pointer.x - lastPointer.x, pointer.y - lastPointer.y) > 0.5
    lastPointer = pointer
    const confirmKey = pressed.has('Enter') || pressed.has('NumpadEnter') || pressed.has('Space')

    if (mode === 'main') {
      const items = L.buttons
      if (moved) {
        const hi = items.findIndex((b) => !b.disabled && pointInRect(pointer, b.rect))
        if (hi >= 0) selected = hi
      }
      if (pressed.has('ArrowDown') || pressed.has('KeyS')) selected = nextEnabled(items, selected, 1)
      if (pressed.has('ArrowUp') || pressed.has('KeyW')) selected = nextEnabled(items, selected, -1)
      if (items[selected]?.disabled) selected = nextEnabled(items, selected, 1)

      for (const c of clicks) {
        const hit = items.find((b) => pointInRect(c, b.rect))
        if (hit && !hit.disabled) {
          activate(context, hit.id)
          return
        }
      }
      if (confirmKey) activate(context, items[selected].id)
      return
    }

    const mb = L.modalButtons
    if (moved) {
      const hi = mb.findIndex((b) => pointInRect(pointer, b.rect))
      if (hi >= 0) modalSelected = hi
    }
    if (pressed.has('ArrowLeft') || pressed.has('ArrowUp')) modalSelected = Math.max(0, modalSelected - 1)
    if (pressed.has('ArrowRight') || pressed.has('ArrowDown')) modalSelected = Math.min(mb.length - 1, modalSelected + 1)
    modalSelected = Math.min(modalSelected, mb.length - 1)
    if (pressed.has('Escape')) {
      activate(context, mode === 'confirm' ? 'cancel' : 'back')
      return
    }
    for (const c of clicks) {
      const hit = mb.find((b) => pointInRect(c, b.rect))
      if (hit) {
        activate(context, hit.id)
        return
      }
    }
    if (confirmKey) activate(context, mb[modalSelected].id)
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    const L = computeLayout(w, h)
    backdrop.draw(ctx, 0, 0, w, h)

    drawPlate(ctx, L.plate, t)

    // Título.
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = L.align
    ctx.textBaseline = 'alphabetic'
    ctx.font = font(L.titleSize)
    ctx.fillText('Vida de Abelha', L.titleX, L.titleY)
    ctx.globalAlpha = 0.65
    ctx.font = font(Math.max(12, L.titleSize * 0.24), { style: 'italic' })
    ctx.fillText('a vida de uma operária de Mandaçaia', L.titleX, L.titleY + L.titleSize * 0.42)
    ctx.restore()

    const inMain = mode === 'main'
    L.buttons.forEach((b, i) => {
      drawButton(ctx, b.rect, b.label, {
        focused: inMain && i === selected,
        disabled: b.disabled,
        caption: b.caption,
        time: t,
        accent: inMain,
      })
    })

    ctx.save()
    ctx.globalAlpha = 0.4
    ctx.fillStyle = UI.ink
    ctx.font = font(11, { style: 'italic' })
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText('setas + Enter ou clique', w - 18, h - 14)
    ctx.restore()

    if (!inMain) drawModal(ctx, L, w, h)
  },

  exit() {},
}

function drawPlate(ctx, plate, time) {
  const { cx, cy, R } = plate
  drawGuideLine(ctx, cx - R * 1.4, cy, cx + R * 1.4, cy, { alpha: 0.2 })
  drawGuideLine(ctx, cx, cy - R * 1.25, cx, cy + R * 1.25, { alpha: 0.16 })
  drawDottedCircle(ctx, cx, cy, R * 1.1, { alpha: 0.3 })
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.4
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.16
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.62, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  // Escala lenta girando (instrumento "medindo" o espécime).
  const rot = time * 0.04
  drawScaleArc(ctx, cx, cy, R * 0.94, Math.PI * 0.15 + rot, Math.PI * 0.85 + rot, {
    ticks: 28,
    majorEvery: 7,
    tickLen: 3,
    majorLen: 8,
    alpha: 0.45,
  })
  // Legenda de espécime.
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.globalAlpha = 0.55
  ctx.textAlign = 'center'
  ctx.font = font(Math.max(9, R * 0.055))
  setLetterSpacing(ctx, 2)
  ctx.fillText('FIG. 1 — OPERÁRIA', cx, cy - R * 1.16)
  setLetterSpacing(ctx, 0)
  ctx.restore()

  const scale = (R * 1.25) / 34
  drawBeeBody(ctx, createIdlePose(cx - scale * 2, cy + scale * 2, { t: time, colorVariant: 'adult', scale, rotation: -0.32, seed: 3 }))
}

function drawModal(ctx, L, w, h) {
  fadeScreen(ctx, w, h, 0.35, '#2B2418')
  const { card } = L
  drawPaperCard(ctx, card.x, card.y, card.w, card.h, { seed: 77 })
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  if (mode === 'confirm') {
    ctx.font = font(22)
    ctx.fillText('Começar uma nova vida?', card.x + card.w / 2, card.y + 52)
    ctx.font = font(14, { style: 'italic' })
    ctx.globalAlpha = 0.75
    wrapText(ctx, 'A vida registrada até agora será apagada e uma nova operária nascerá.', card.w - 60).forEach((line, i) => {
      ctx.fillText(line, card.x + card.w / 2, card.y + 84 + i * 20)
    })
  } else {
    ctx.font = font(22)
    ctx.fillText('Configurações', card.x + card.w / 2, card.y + 50)
    const rows = ['Volume da música', 'Efeitos sonoros', 'Tamanho do texto']
    rows.forEach((label, i) => {
      const y = card.y + 92 + i * 38
      ctx.globalAlpha = 0.8
      ctx.font = font(15)
      ctx.textAlign = 'left'
      ctx.fillText(label, card.x + 36, y)
      ctx.textAlign = 'right'
      ctx.font = font(13, { style: 'italic' })
      ctx.globalAlpha = 0.5
      ctx.fillText('em breve', card.x + card.w - 36, y)
      drawGuideLine(ctx, card.x + 36, y + 10, card.x + card.w - 36, y + 10, { alpha: 0.2 })
    })
  }
  ctx.restore()
  L.modalButtons.forEach((b, i) => {
    drawButton(ctx, b.rect, b.label, { focused: i === modalSelected, time: t, size: 16 })
  })
}
