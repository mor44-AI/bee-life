// MenuState - menu principal: Novo Jogo / Continuar / Configurações.
// Vertical primeiro: prancha da operária + título no alto e botões grandes (≥ 56px)
// empilhados na metade inferior (zona do polegar). Em tela larga: título e botões
// numa coluna à esquerda, prancha à direita.
// Toque/clique ativa; teclado (setas + Enter, Esc volta) continua funcionando no PC.
// "Ver abertura" (link discreto, mesmo alvo de toque ≥ 56px) reabre o vídeo de abertura.
// "Continuar" fica visualmente desabilitado sem save. "Novo Jogo" com save existente
// pede confirmação de sobrescrita. Configurações de áudio persistentes.

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
    { id: 'replay', label: 'Ver abertura', discreet: true },
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
  const linkH = minTouch
  const stackH = btnH * 3 + gap * 2 + linkH
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
  const buttons = mainItems().map((item, i) => {
    const y = btnY0 + i * (btnH + gap)
    // Link discreto logo abaixo da pilha, sem o espaçamento extra dos botões.
    if (item.discreet) return { ...item, rect: { x: btnX + btnW * 0.2, y: y - gap, w: btnW * 0.6, h: linkH } }
    return { ...item, rect: { x: btnX, y, w: btnW, h: btnH } }
  })

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

  if (mode === 'settings') {
    const audio = context.audio
    const rowGap = 8
    const headingH = 54
    const rowH = Math.max(44, Math.min(56, (S.h - 72 - headingH - 3 * rowGap) / 4))
    card.h = headingH + 4 * rowH + 3 * rowGap + 32
    card.y = S.y + (S.h - card.h) / 2
    const x = card.x + 16
    const y = card.y + headingH
    const w = card.w - 32
    const rect = row => ({ x, y: y + row * (rowH + rowGap), w, h: rowH })
    const volume = Math.round((audio?.volume ?? 0.45) * 100)
    modalButtons = [
      { id: 'music', label: `Som: ${audio?.muted ? 'desligado' : 'ligado'}`, rect: rect(0) },
      { id: 'quieter', label: 'Volume -', rect: { ...rect(1), w: (w - rowGap) / 2 } },
      { id: 'louder', label: `${volume}% +`, rect: { ...rect(1), x: x + (w + rowGap) / 2, w: (w - rowGap) / 2 } },
      { id: 'effects', label: `Efeitos: ${audio?.effectsEnabled === false ? 'desligados' : 'ligados'}`, rect: rect(2) },
      { id: 'back', label: 'Voltar', rect: rect(3) },
    ]
    if (S.h < 390 && S.w >= 540) {
      card.w = Math.min(620, S.w - 32)
      card.x = S.x + (S.w - card.w) / 2
      card.h = headingH + 3 * 48 + 2 * rowGap + 24
      card.y = S.y + (S.h - card.h) / 2
      const columnW = (card.w - 40) / 2
      modalButtons.forEach((button, i) => {
        button.rect = {
          x: card.x + 16 + (i % 2) * (columnW + rowGap),
          y: card.y + headingH + Math.floor(i / 2) * (48 + rowGap),
          w: columnW, h: 48,
        }
      })
    }
    if (!audio?.available) modalButtons.slice(0, 4).forEach(b => { b.disabled = true })
  }
  return { L, S, u, wide, plate, titleX, titleY, titleSize, align, buttons, card, modalButtons, pad, audioAvailable: !!context.audio?.available }
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
    case 'music':
      context.audio?.toggleMuted()
      break
    case 'quieter':
      context.audio?.setVolume(context.audio.volume - 0.1)
      break
    case 'louder':
      context.audio?.setVolume(context.audio.volume + 0.1)
      break
    case 'effects':
      context.audio?.setEffectsEnabled(!context.audio.effectsEnabled)
      if (context.audio?.effectsEnabled) context.audio.playResult(1)
      break
    case 'replay':
      context.goTo?.('intro', { replay: true })
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
    if (anyKeyPressed(input, ['ArrowLeft', 'ArrowUp'])) modalSelected = nextEnabled(mb, modalSelected, -1)
    if (anyKeyPressed(input, ['ArrowRight', 'ArrowDown'])) modalSelected = nextEnabled(mb, modalSelected, 1)
    modalSelected = Math.min(modalSelected, mb.length - 1)
    if (mb[modalSelected]?.disabled) modalSelected = nextEnabled(mb, modalSelected, 1)
    if (anyKeyPressed(input, ['Escape'])) {
      activate(context, mode === 'confirm' ? 'cancel' : 'back')
      return
    }
    for (const c of clicks) {
      const hit = mb.find((b) => pointInRect(c, grow(b.rect, mode === 'settings' ? 0 : g)))
      if (hit && !hit.disabled) {
        modalSelected = mb.indexOf(hit)
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
      if (b.discreet) {
        drawLink(ctx, b.rect, b.label, u, inMain && !touch && i === selected)
        return
      }
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

function drawLink(ctx, rect, label, u, focused) {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.globalAlpha = focused ? 0.95 : 0.7
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(16 * u, { style: 'italic' })
  ctx.fillText(label, cx, cy)
  const tw = ctx.measureText(label).width
  ctx.restore()
  drawGuideLine(ctx, cx - tw / 2, cy + 12 * u, cx + tw / 2, cy + 12 * u, { alpha: focused ? 0.6 : 0.3 })
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
  ctx.fillText('FIG. 1 - OPERÁRIA', cx, cy - R * 1.16)
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
    if (!M.audioAvailable) {
      ctx.font = font(11 * u)
      ctx.fillText('Áudio indisponível neste navegador', cx, card.y + 49)
    }
  }
  ctx.restore()
  M.modalButtons.forEach((b, i) => {
    drawButton(ctx, b.rect, b.label, { focused: i === modalSelected, disabled: b.disabled, time: t })
  })
}
