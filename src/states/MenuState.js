// MenuState - menu principal: Novo Jogo / Continuar / Configurações.
// Vertical primeiro: prancha da operária + título no alto e botões grandes (≥ 56px)
// empilhados na metade inferior (zona do polegar). Em tela larga: título e botões
// numa coluna à esquerda, prancha à direita.
// Toque/clique ativa; teclado (setas + Enter, Esc volta) continua funcionando no PC.
// "Ranking" e "Ver abertura" (links discretos lado a lado, mesmo alvo de toque ≥ 56px):
// o primeiro abre a tabela do ranking num painel (só leitura); o segundo reabre o vídeo.
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
import { t as tr, getLang, setLang } from '../i18n/index.js'
import leaderboard from '../systems/Leaderboard.js'
import { drawLeaderboard, formatScore } from './EndOfMarco1State.js'

const backdrop = createPaperBackdrop({ seed: 31 })
let t = 0
let mode = 'main' // 'main' | 'confirm' | 'settings' | 'ranking'
let selected = 0
let modalSelected = 1
let lastPointer = null
let hasSave = false

function mainItems() {
  return [
    { id: 'new', label: tr('menu.newGame') },
    { id: 'continue', label: tr('menu.continue'), disabled: !hasSave, caption: hasSave ? '' : tr('menu.noSave') },
    { id: 'settings', label: tr('menu.settings') },
    { id: 'ranking', label: tr('menu.ranking'), discreet: true },
    { id: 'replay', label: tr('menu.replayIntro'), discreet: true },
  ]
}

function computeLayout(context) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const minTouch = L.minTouch ?? 56
  // Celular deitado (ex. 667x320) também usa a coluna à esquerda; na pilha vertical o
  // título saía pelo topo.
  const wide = S.w > S.h * 1.1 && (S.w >= 720 || S.w > S.h * 1.5)
  let btnH = Math.max(minTouch, Math.round(62 * u))
  let gap = Math.round(14 * u)
  const linkH = wide ? Math.min(minTouch, 48) : minTouch
  if (wide) {
    // Tela deitada e baixa: encolhe botões (alvo mínimo 44px) para caber título + pilha.
    const tSize = Math.min(64, S.w * 0.055, S.h * 0.11)
    const room = S.h - 32 - tSize * 1.6 - 24 * u - linkH
    if (btnH * 3 + gap * 2 > room) {
      gap = Math.max(12, Math.min(gap, room * 0.05))
      btnH = Math.max(44, (room - gap * 2) / 3)
    }
  }
  const stackH = btnH * 3 + gap * 2 + linkH
  let plate, titleX, titleY, titleSize, align, btnX, btnY0, btnW

  if (wide) {
    btnW = Math.min(340 * u, S.w * 0.36)
    const colX = S.x + Math.max(32, S.w * 0.08)
    titleSize = Math.min(64, S.w * 0.055, S.h * 0.11)
    plate = { cx: S.x + S.w * 0.68, cy: S.y + S.h * 0.5, R: Math.min(S.w * 0.2, S.h * 0.32) }
    const blockH = titleSize * 1.6 + 24 * u + stackH
    const top = S.y + Math.max(12, (S.h - blockH) / 2)
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
    // Abaixo do seletor PT | EN (canto superior direito) em tela estreita, para a legenda não encostar nele.
    const plateTop = S.y + (S.w < 400 ? Math.max(30 * u, 60) : 30 * u)
    const plateBottom = titleY - titleSize - 16 * u
    const avail = Math.max(60, plateBottom - plateTop)
    const R = Math.max(40, Math.min(S.w * 0.3, avail / 2.6))
    plate = { cx: S.x + S.w / 2, cy: plateTop + avail / 2 + R * 0.08, R }
  }
  // Links discretos lado a lado logo abaixo da pilha, sem o espaçamento extra dos botões.
  const linkY = btnY0 + 3 * (btnH + gap) - gap
  const linkGap = 8
  const linkW = (btnW - linkGap) / 2
  let linkIndex = 0
  const buttons = mainItems().map((item, i) => {
    if (item.discreet) {
      const k = linkIndex++
      return { ...item, rect: { x: btnX + k * (linkW + linkGap), y: linkY, w: linkW, h: linkH } }
    }
    return { ...item, rect: { x: btnX, y: btnY0 + i * (btnH + gap), w: btnW, h: btnH } }
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
      lines = wrapText(ctx, tr('menu.confirmText'), cardW - pad * 2).length
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
      { id: 'confirmNew', label: tr('menu.confirmRestart') },
      { id: 'cancel', label: tr('menu.cancel') },
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
    modalButtons = [{ id: 'back', label: tr('menu.back'), rect: { x: card.x + (cardW - w) / 2, y: by, w, h: mbH } }]
  }

  let settingsHead = null
  if (mode === 'settings') {
    const audio = context.audio
    const audioOk = !!audio?.available
    const rowGap = Math.max(8, Math.round(8 * u))
    const inset = 16
    const bottom = 16
    const margin = 12
    // Cabeçalho medido a partir do próprio tamanho da fonte (antes era um offset fixo
    // de 54px e o título invadia a primeira linha quando u > 1, ex. 800×450).
    const titleSize = Math.max(18, Math.min(23 * u, 28))
    const noteSize = Math.max(11, 12 * u)
    const titleBase = Math.max(14, 16 * u) + titleSize * 0.85
    const noteBase = titleBase + (audioOk ? 0 : noteSize * 1.55)
    const headingH = noteBase + Math.max(14, 16 * u)
    settingsHead = { titleSize, titleBase, noteSize, noteBase }
    const heightFor = (rows, rh) => headingH + rows * rh + (rows - 1) * rowGap + bottom
    const availH = S.h - margin * 2
    const rowHFor = rows => Math.max(44, Math.min(56, (availH - headingH - bottom - (rows - 1) * rowGap) / rows))
    // Uma coluna (5 linhas) sempre que couber; senão, duas colunas (3 linhas) em tela deitada.
    const twoCol = heightFor(5, 44) > availH && S.w >= 480
    const rows = twoCol ? 3 : 5
    const rowH = rowHFor(rows)
    card.w = twoCol ? Math.min(620, S.w - 32) : cardW
    card.x = S.x + (S.w - card.w) / 2
    card.h = heightFor(rows, rowH)
    card.y = S.y + Math.max(margin, (S.h - card.h) / 2)
    const x0 = card.x + inset
    const innerW = card.w - inset * 2
    const colW = twoCol ? (innerW - rowGap) / 2 : innerW
    const cell = (row, col = 0, span = 1) => ({
      x: x0 + col * (colW + rowGap),
      y: card.y + headingH + row * (rowH + rowGap),
      w: colW * span + rowGap * (span - 1),
      h: rowH,
    })
    const half = r => ({ ...r, w: (r.w - rowGap) / 2 })
    const rightHalf = r => ({ ...r, x: r.x + (r.w + rowGap) / 2, w: (r.w - rowGap) / 2 })
    const volume = Math.round((audio?.volume ?? 0.45) * 100)
    const volRow = twoCol ? cell(1, 0, 2) : cell(1)
    modalButtons = [
      { id: 'music', label: tr(audio?.muted ? 'menu.soundOff' : 'menu.soundOn'), rect: cell(0) },
      { id: 'quieter', label: tr('menu.volumeDown'), rect: half(volRow) },
      { id: 'louder', label: tr('menu.volumeUp', { volume }), rect: rightHalf(volRow) },
      { id: 'effects', label: tr(audio?.effectsEnabled === false ? 'menu.effectsOff' : 'menu.effectsOn'), rect: twoCol ? cell(0, 1) : cell(2) },
      { id: 'language', label: tr('menu.language', { lang: tr('app.langName') }), rect: twoCol ? cell(2, 0) : cell(3) },
      { id: 'back', label: tr('menu.back'), rect: twoCol ? cell(2, 1) : cell(4) },
    ]
    if (!audioOk) modalButtons.slice(0, 4).forEach(b => { b.disabled = true })
  }
  let board = null
  if (mode === 'ranking') {
    const rows = leaderboard.top(10).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, you: !e.dummy }))
    const best = leaderboard.best()
    const titleSize = Math.max(18, Math.min(23 * u, 28))
    const noteSize = Math.max(12, 13 * u)
    const headH = pad * 0.6 + titleSize * 1.1 + (best > 0 ? noteSize * 1.6 : 0) + 10 * u
    const btnArea = mbH + pad
    const maxH = S.h - 24
    const n = Math.max(1, rows.length)
    let columns = 1
    let rowH = Math.min(32 * u, (maxH - headH - btnArea - 8 * u) / n)
    card.w = Math.min(460, S.w - 32)
    // Tela baixa (celular deitado): duas colunas de 5.
    if (rowH < 22 && S.w >= 480) {
      columns = 2
      card.w = Math.min(640, S.w - 32)
      rowH = Math.min(32 * u, (maxH - headH - btnArea - 8 * u) / Math.ceil(n / 2))
    }
    const tableH = rowH * Math.ceil(n / columns)
    card.h = headH + tableH + 8 * u + btnArea
    card.x = S.x + (S.w - card.w) / 2
    card.y = S.y + Math.max(12, (S.h - card.h) / 2)
    const inset = Math.max(12, 16 * u)
    board = {
      rows, best, columns, titleSize, noteSize, titleBase: pad * 0.6 + titleSize * 0.9,
      table: { x: card.x + inset, y: card.y + headH, w: card.w - inset * 2, h: tableH },
    }
    const w = Math.min(card.w - pad * 2, 240 * u)
    modalButtons = [{ id: 'back', label: tr('menu.back'), rect: { x: card.x + (card.w - w) / 2, y: card.y + card.h - pad - mbH, w, h: mbH } }]
  }
  const langToggle = langToggleRect(S, u)
  return { L, S, u, wide, plate, titleX, titleY, titleSize, align, buttons, card, modalButtons, pad, settingsHead, board, langToggle, audioAvailable: !!context.audio?.available }
}

// Seletor PT | EN discreto no canto superior direito da área segura (alvo ≥ 44px).
function langToggleRect(S, u) {
  const h = 44
  const w = Math.max(96, Math.round(104 * u))
  return { x: S.x + S.w - w - 6, y: S.y + 6, w, h }
}

function langAt(rect, p) {
  if (!pointInRect(p, rect)) return null
  return p.x < rect.x + rect.w / 2 ? 'pt' : 'en'
}

// Tamanho de rótulo que cabe no botão (pt e en têm larguras diferentes; tela de 320px).
function fitLabelSize(ctx, rect, label, caption) {
  let size = Math.max(17, Math.min(24, rect.h * (caption ? 0.3 : 0.33)))
  const maxW = rect.w - 44 // espaço para as marcas de foco nas laterais
  ctx.save()
  ctx.font = font(size)
  while (size > 12 && ctx.measureText(label).width > maxW) {
    size -= 0.5
    ctx.font = font(size)
  }
  ctx.restore()
  return size
}

function fitFont(ctx, text, maxW, size, min, opts) {
  ctx.font = font(size, opts)
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 0.5
    ctx.font = font(size, opts)
  }
  return size
}

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
    case 'language':
      setLang(getLang() === 'pt' ? 'en' : 'pt')
      break
    case 'ranking':
      mode = 'ranking'
      modalSelected = 0
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
        const lang = langAt(M.langToggle, c)
        if (lang) {
          setLang(lang)
          return
        }
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
    // Largura disponível: tela toda (vertical) ou até a prancha (deitada).
    const textW = M.wide ? M.plate.cx - M.plate.R * 1.2 - M.titleX : M.S.w - 24
    fitFont(ctx, tr('app.title'), textW, M.titleSize, 20)
    ctx.fillText(tr('app.title'), M.titleX, M.titleY)
    ctx.globalAlpha = 0.8
    fitFont(ctx, tr('app.subtitle'), textW, Math.max(14 * u, M.titleSize * 0.27), 11, { style: 'italic' })
    ctx.fillText(tr('app.subtitle'), M.titleX, M.titleY + Math.max(22 * u, M.titleSize * 0.5))
    ctx.restore()

    const inMain = mode === 'main'
    const touch = isTouchUI(context)
    M.buttons.forEach((b, i) => {
      if (b.discreet) {
        drawLink(ctx, b.rect, b.label, u, inMain && !touch && i === selected)
        return
      }
      drawButton(ctx, b.rect, b.label, {
        size: fitLabelSize(ctx, b.rect, b.label, b.caption),
        // No toque não há "foco" de teclado: destaca só o botão principal.
        focused: inMain && (touch ? i === (hasSave ? 1 : 0) : i === selected),
        disabled: b.disabled,
        caption: b.caption,
        time: t,
        accent: inMain,
      })
    })

    if (!touch) drawHint(ctx, M.L, tr('menu.keyHint'))
    drawLangToggle(ctx, M.langToggle, u, inMain)

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
  fitFont(ctx, label, rect.w - 6, 16 * u, 11, { style: 'italic' })
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
  ctx.fillText(tr('menu.plateCaption'), cx, cy - R * 1.16)
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
  if (mode === 'ranking') {
    const B = M.board
    fitFont(ctx, tr('score.board.title'), card.w - 32, B.titleSize, 14)
    ctx.fillText(tr('score.board.title'), cx, card.y + B.titleBase)
    if (B.best > 0) {
      ctx.globalAlpha = 0.75
      const best = tr('score.board.best', { n: formatScore(B.best) })
      fitFont(ctx, best, card.w - 32, B.noteSize, 10, { style: 'italic' })
      ctx.fillText(best, cx, card.y + B.titleBase + B.noteSize * 1.6)
    }
    ctx.restore()
    drawLeaderboard(ctx, B.table, B.rows, { u, columns: B.columns, time: t })
    ctx.save()
  } else if (mode === 'confirm') {
    ctx.font = font(Math.min(23 * u, (card.w - pad * 2) / 11))
    fitFont(ctx, tr('menu.confirmTitle'), card.w - pad * 2, Math.min(23 * u, (card.w - pad * 2) / 11), 14)
    ctx.fillText(tr('menu.confirmTitle'), cx, card.y + pad + 26 * u)
    ctx.font = font(15.5 * u, { style: 'italic' })
    ctx.globalAlpha = 0.88
    wrapText(ctx, tr('menu.confirmText'), card.w - pad * 2).forEach((line, i) => {
      ctx.fillText(line, cx, card.y + pad + 62 * u + i * 22 * u)
    })
  } else {
    const H = M.settingsHead
    fitFont(ctx, tr('menu.settings'), card.w - 32, H.titleSize, 14)
    ctx.fillText(tr('menu.settings'), cx, card.y + H.titleBase)
    if (!M.audioAvailable) {
      ctx.globalAlpha = 0.8
      fitFont(ctx, tr('menu.audioUnavailable'), card.w - 32, H.noteSize, 9, { style: 'italic' })
      ctx.fillText(tr('menu.audioUnavailable'), cx, card.y + H.noteBase)
    }
  }
  ctx.restore()
  M.modalButtons.forEach((b, i) => {
    drawButton(ctx, b.rect, b.label, {
      size: fitLabelSize(ctx, b.rect, b.label),
      focused: i === modalSelected,
      disabled: b.disabled,
      time: t,
    })
  })
}

function drawLangToggle(ctx, rect, u, active) {
  const lang = getLang()
  const cy = rect.y + rect.h / 2
  const base = active ? 1 : 0.5
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.fillStyle = UI.ink
  ctx.lineWidth = 1
  ctx.globalAlpha = base * 0.35
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(rect.x + 4, rect.y + 6, rect.w - 8, rect.h - 12, 14)
  else ctx.rect(rect.x + 4, rect.y + 6, rect.w - 8, rect.h - 12)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(Math.max(14, 14 * u))
  for (const [code, x] of [['pt', rect.x + rect.w * 0.28], ['en', rect.x + rect.w * 0.72]]) {
    const on = code === lang
    ctx.globalAlpha = base * (on ? 1 : 0.5)
    ctx.fillText(code.toUpperCase(), x, cy)
    if (on) ctx.fillRect(x - 10, cy + 10, 20, 1.3)
  }
  ctx.globalAlpha = base * 0.4
  ctx.fillText('|', rect.x + rect.w / 2, cy)
  ctx.restore()
}
