// MenuState — menu principal: Novo Jogo / Continuar / Configurações.
// Vertical primeiro: prancha da operária + título no alto e botões grandes (≥ 56px)
// empilhados na metade inferior (zona do polegar). Em tela larga: título e botões
// numa coluna à esquerda, prancha à direita.
// Toque/clique ativa; teclado (setas + Enter, Esc volta) continua funcionando no PC.
// "Continuar" fica visualmente desabilitado sem save. "Novo Jogo" com save existente
// pede confirmação de sobrescrita. Configurações = painel simples (sem função real ainda).

import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { UI, font, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  drawPaperCard,
  drawButton,
  pointInRect,
  wrapText,
  fadeScreen,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
  drawHint,
} from '../ui/HUD.js'

const backdrop = createPaperBackdrop({ seed: 31 })
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

function computeLayout(context) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const minTouch = L.minTouch ?? 56
  const wide = S.w >= 720 && S.w > S.h * 1.1
  const btnH = Math.max(minTouch, Math.round(62 * u))
  const gap = Math.round(14 * u)
  const stackH = btnH * 3 + gap * 2
  let plate, titleX, titleY, titleSize, align, btnX, btnY0, btnW

  if (wide) {
    btnW = Math.min(340 * u, S.w * 0.36)
    const colX = S.x + Math.max(32, S.w * 0.08)
    titleSize = Math.min(64, S.w * 0.055, S.h * 0.11)
    plate = { cx: S.x + S.w * 0.68, cy: S.y + S.h * 0.5, R: Math.min(S.w * 0.2, S.h * 0.32) }
    const blockH = titleSize * 1.6 + 24 * u + stackH
    const top = S.y + Math.max(20, (S.h - blockH) / 2)
    titleX = colX
    titleY = top + titleSize
    align = 'left'
    btnX = colX
    btnY0 = titleY + titleSize * 0.6 + 24 * u
  } else {
    btnW = Math.min(380, S.w - 40)
    btnX = S.x + (S.w - btnW) / 2
    const hintSpace = isTouchUI(context) ? 16 * u : 40 * u
    btnY0 = S.y + S.h - hintSpace - 12 * u - stackH
    titleSize = Math.max(34, Math.min(54, S.w * 0.11))
    align = 'center'
    titleX = S.x + S.w / 2
    // Título logo acima dos botões; a prancha ocupa o espaço que sobra no alto.
    titleY = btnY0 - 36 * u - titleSize * 0.55
    const plateTop = S.y + 30 * u
    const plateBottom = titleY - titleSize - 16 * u
    const avail = Math.max(60, plateBottom - plateTop)
    const R = Math.max(40, Math.min(S.w * 0.3, avail / 2.6))
    plate = { cx: S.x + S.w / 2, cy: plateTop + avail / 2 + R * 0.08, R }
  }
  const buttons = mainItems().map((item, i) => ({ ...item, rect: { x: btnX, y: btnY0 + i * (btnH + gap), w: btnW, h: btnH } }))

  // Modal
  const cardW = Math.min(460, S.w - 32)
  const stacked = cardW < 400
  const mbH = Math.max(minTouch, Math.round(58 * u))
  const mbGap = 12 * u
  const pad = 24 * u
  let bodyH
  if (mode === 'settings') bodyH = 60 * u + 3 * 48 * u
  else {
    const ctx = context.renderer?.getContext?.()
    let lines = 3
    if (ctx) {
      ctx.save()
      ctx.font = font(15.5 * u, { style: 'italic' })
      lines = wrapText(ctx, CONFIRM_TEXT, cardW - pad * 2).length
      ctx.restore()
    }
    bodyH = 60 * u + lines * 22 * u + 8 * u
  }
  const buttonsH = mode === 'confirm' && stacked ? mbH * 2 + mbGap : mbH
  const cardH = Math.min(S.h - 24, pad + bodyH + 16 * u + buttonsH + pad)
  const card = { x: S.x + (S.w - cardW) / 2, y: S.y + (S.h - cardH) / 2, w: cardW, h: cardH }
  const by = card.y + card.h - pad - buttonsH
  let modalButtons
  if (mode === 'confirm') {
    const ids = [
      { id: 'confirmNew', label: 'Recomeçar' },
      { id: 'cancel', label: 'Cancelar' },
    ]
    if (stacked) {
      const w = cardW - pad * 2
      modalButtons = ids.map((b, i) => ({ ...b, rect: { x: card.x + pad, y: by + i * (mbH + mbGap), w, h: mbH } }))
    } else {
      const w = (cardW - pad * 2 - mbGap) / 2
      modalButtons = ids.map((b, i) => ({ ...b, rect: { x: card.x + pad + i * (w + mbGap), y: by, w, h: mbH } }))
    }
  } else {
    const w = Math.min(cardW - pad * 2, 240 * u)
    modalButtons = [{ id: 'back', label: 'Voltar', rect: { x: card.x + (cardW - w) / 2, y: by, w, h: mbH } }]
  }

  return { L, S, u, wide, plate, titleX, titleY, titleSize, align, buttons, card, modalButtons, pad }
}

const CONFIRM_TEXT = 'A vida registrada até agora será apagada e uma nova operária nascerá.'

function grow(r, g) {
  return { x: r.x - g, y: r.y - g, w: r.w + g * 2, h: r.h + g * 2 }
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
    context.input.consumeClicks()
    lastPointer = context.input.getPointer()
  },

  update(context, dt) {
    t += dt
    const M = computeLayout(context)
    const input = context.input
    const clicks = input.consumeClicks()
    const pointer = input.getPointer()
    const moved = !lastPointer || Math.hypot(pointer.x - lastPointer.x, pointer.y - lastPointer.y) > 0.5
    lastPointer = pointer
    const touch = isTouchUI(context)
    const confirmKey = anyKeyPressed(input, ['Enter', 'NumpadEnter', 'Space'])
    const g = 6 // gaps entre botões ≥ 12px, então crescer 6px não sobrepõe alvos

    if (mode === 'main') {
      const items = M.buttons
      if (moved && !touch) {
        const hi = items.findIndex((b) => !b.disabled && pointInRect(pointer, b.rect))
        if (hi >= 0) selected = hi
      }
      if (anyKeyPressed(input, ['ArrowDown', 'KeyS'])) selected = nextEnabled(items, selected, 1)
      if (anyKeyPressed(input, ['ArrowUp', 'KeyW'])) selected = nextEnabled(items, selected, -1)
      if (items[selected]?.disabled) selected = nextEnabled(items, selected, 1)

      for (const c of clicks) {
        const hit = items.find((b) => pointInRect(c, grow(b.rect, g)))
        if (hit && !hit.disabled) {
          selected = items.indexOf(hit)
          activate(context, hit.id)
          return
        }
      }
      if (confirmKey) activate(context, items[selected].id)
      return
    }

    const mb = M.modalButtons
    if (moved && !touch) {
      const hi = mb.findIndex((b) => pointInRect(pointer, b.rect))
      if (hi >= 0) modalSelected = hi
    }
    if (anyKeyPressed(input, ['ArrowLeft', 'ArrowUp'])) modalSelected = Math.max(0, modalSelected - 1)
    if (anyKeyPressed(input, ['ArrowRight', 'ArrowDown'])) modalSelected = Math.min(mb.length - 1, modalSelected + 1)
    modalSelected = Math.min(modalSelected, mb.length - 1)
    if (anyKeyPressed(input, ['Escape'])) {
      activate(context, mode === 'confirm' ? 'cancel' : 'back')
      return
    }
    for (const c of clicks) {
      const hit = mb.find((b) => pointInRect(c, grow(b.rect, g)))
      if (hit) {
        activate(context, hit.id)
        return
      }
    }
    // Toque fora do cartão fecha (cancelar/voltar).
    if (clicks.length && !clicks.some((c) => pointInRect(c, M.card))) {
      activate(context, mode === 'confirm' ? 'cancel' : 'back')
      return
    }
    if (confirmKey) activate(context, mb[modalSelected].id)
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    const M = computeLayout(context)
    const { u } = M
    backdrop.draw(ctx, 0, 0, w, h)

    drawPlate(ctx, M.plate, t, u)

    // Título.
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = M.align
    ctx.textBaseline = 'alphabetic'
    ctx.font = font(M.titleSize)
    ctx.fillText('Vida de Abelha', M.titleX, M.titleY)
    ctx.globalAlpha = 0.8
    ctx.font = font(Math.max(14 * u, M.titleSize * 0.27), { style: 'italic' })
    ctx.fillText('a vida de uma operária de Mandaçaia', M.titleX, M.titleY + Math.max(22 * u, M.titleSize * 0.5))
    ctx.restore()

    const inMain = mode === 'main'
    const touch = isTouchUI(context)
    M.buttons.forEach((b, i) => {
      drawButton(ctx, b.rect, b.label, {
        // No toque não há "foco" de teclado: destaca só o botão principal.
        focused: inMain && (touch ? i === (hasSave ? 1 : 0) : i === selected),
        disabled: b.disabled,
        caption: b.caption,
        time: t,
        accent: inMain,
      })
    })

    if (!touch) drawHint(ctx, M.L, 'setas + Enter, ou clique')

    if (!inMain) drawModal(ctx, M, w, h)
  },

  exit() {},
}

function drawPlate(ctx, plate, time, u) {
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
  ctx.globalAlpha = 0.65
  ctx.textAlign = 'center'
  ctx.font = font(Math.max(12 * u, R * 0.06))
  setLetterSpacing(ctx, 2)
  ctx.fillText('FIG. 1 — OPERÁRIA', cx, cy - R * 1.16)
  setLetterSpacing(ctx, 0)
  ctx.restore()

  const scale = (R * 1.25) / 34
  drawBeeBody(ctx, createIdlePose(cx - scale * 2, cy + scale * 2, { t: time, colorVariant: 'adult', scale, rotation: -0.32, seed: 3 }))
}

function drawModal(ctx, M, w, h) {
  fadeScreen(ctx, w, h, 0.4, '#2B2418')
  const { card, u, pad } = M
  drawPaperCard(ctx, card.x, card.y, card.w, card.h, { seed: 77 })
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const cx = card.x + card.w / 2
  if (mode === 'confirm') {
    ctx.font = font(Math.min(23 * u, (card.w - pad * 2) / 11))
    ctx.fillText('Começar uma nova vida?', cx, card.y + pad + 26 * u)
    ctx.font = font(15.5 * u, { style: 'italic' })
    ctx.globalAlpha = 0.88
    wrapText(ctx, CONFIRM_TEXT, card.w - pad * 2).forEach((line, i) => {
      ctx.fillText(line, cx, card.y + pad + 62 * u + i * 22 * u)
    })
  } else {
    ctx.font = font(23 * u)
    ctx.fillText('Configurações', cx, card.y + pad + 26 * u)
    const rows = ['Volume da música', 'Efeitos sonoros', 'Tamanho do texto']
    rows.forEach((label, i) => {
      const y = card.y + pad + 76 * u + i * 48 * u
      ctx.globalAlpha = 0.92
      ctx.font = font(16 * u)
      ctx.textAlign = 'left'
      ctx.fillText(label, card.x + pad, y)
      ctx.textAlign = 'right'
      ctx.font = font(13.5 * u, { style: 'italic' })
      ctx.globalAlpha = 0.65
      ctx.fillText('em breve', card.x + card.w - pad, y)
      drawGuideLine(ctx, card.x + pad, y + 12 * u, card.x + card.w - pad, y + 12 * u, { alpha: 0.25 })
    })
  }
  ctx.restore()
  M.modalButtons.forEach((b, i) => {
    drawButton(ctx, b.rect, b.label, { focused: i === modalSelected, time: t })
  })
}
