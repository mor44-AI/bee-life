// EndOfMarco1State - enter(context, { reason }):
//   'completed' -> dominou a defesa da entrada: "Continua em breve - lá fora, o mundo ultravioleta espera"
//   'lifeOver'  -> a vida chegou ao fim antes disso.
// Resumo: dias vividos, função final e estado final da colônia (mostradores estáticos,
// grade 3×2 em tela estreita). Vertical primeiro: emblema, título, cartão e botão grande
// "Voltar ao menu" na zona do polegar. Toque/clique em qualquer lugar ou tecla
// (após MIN_TIME) -> goTo('menu').

import { ease } from '../engine/tween.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { UI, font, drawDial, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  drawPaperCard,
  drawButton,
  wrapText,
  rankName,
  COLONY_INDICATORS,
  fadeScreen,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  continueHint,
  drawHint,
} from '../ui/HUD.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const MIN_TIME = 1.2

const backdrop = createPaperBackdrop({ seed: 97 })
let t = 0
let reason = 'completed'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const clamp01 = (v) => clamp(v, 0, 1)
const seg = (time, a, b) => ease(clamp01((time - a) / (b - a)), 'easeInOutCubic')

const SUBTITLE = {
  completed: 'lá fora, o mundo ultravioleta espera',
  lifeOver: 'A sua vida chegou ao fim antes de dominar a defesa da entrada. A colônia segue.',
}

function computeLayout(context, ctx) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const cx = S.x + S.w / 2
  const titleSize = Math.max(28, Math.min(46, S.w * 0.085))
  const subSize = Math.max(15 * u, titleSize * 0.4)
  const subLH = subSize * 1.35
  ctx.save()
  ctx.font = font(subSize, { style: 'italic' })
  const subLines = wrapText(ctx, SUBTITLE[reason], Math.min(560, S.w - 48))
  ctx.restore()

  const cardW = Math.min(640, S.w - 24)
  const narrow = cardW < 520
  const perRow = narrow ? 3 : 6
  const slot = (cardW - 32) / perRow
  const labelSize = 12 * u
  const radius = clamp(slot * 0.2, 15, 22 * u)
  const rowH = radius * 2 + 16 + labelSize * 1.25 + 8 * u
  const headH = narrow ? 88 * u : 66 * u
  const cardH = headH + rowH * Math.ceil(COLONY_INDICATORS.length / perRow) + 6 * u

  const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))
  const btnW = Math.min(360, S.w - 40)
  const btn = { x: cx - btnW / 2, y: S.y + S.h - btnH - 40 * u, w: btnW, h: btnH }

  // Altura fixa (sem o emblema) -> o emblema fica com o espaço que sobra.
  const fixed = 16 * u + titleSize + titleSize * 0.85 + (subLines.length - 1) * subLH + 22 * u + 16 * u + cardH + 16 * u
  const avail = btn.y - S.y - fixed
  const R = clamp(avail / 3.3, 34, Math.min(S.w * 0.2, 120))
  const cy = S.y + 12 * u + R * 1.6
  const titleY = cy + R * 1.6 + titleSize * 0.9
  const ulY = titleY + titleSize * 0.85 + (subLines.length - 1) * subLH + 14 * u
  const cardY = Math.min(btn.y - cardH - 14 * u, ulY + 20 * u)
  const card = { x: cx - cardW / 2, y: cardY, w: cardW, h: cardH }

  return { L, S, u, cx, cy, R, titleSize, subSize, subLH, subLines, titleY, ulY, card, narrow, perRow, slot, radius, rowH, headH, labelSize, btn }
}

export default {
  enter(context, data = {}) {
    t = 0
    reason = data.reason === 'lifeOver' ? 'lifeOver' : 'completed'
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    const pressed = context.input.consumeClicks().length > 0 || anyKeyPressed(context.input, KEYS)
    if (pressed && t >= MIN_TIME) context.goTo('menu')
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    const completed = reason === 'completed'
    const M = computeLayout(context, ctx)
    const { cx, cy, R, u } = M

    // Emblema: para 'completed', a entrada do ninho aberta para uma luz de fora;
    // para 'lifeOver', um mostrador que se fecha em silêncio.
    if (completed) {
      const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6)
      glow.addColorStop(0, `rgba(247, 223, 160, ${0.7 * seg(t, 0, 1.5)})`)
      glow.addColorStop(1, 'rgba(247, 223, 160, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + t * 0.02
        drawGuideLine(ctx, cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1, cx + Math.cos(a) * R * 1.55, cy + Math.sin(a) * R * 1.55, {
          progress: seg(t, 0.2 + i * 0.03, 1.4 + i * 0.03),
          alpha: 0.3,
          dash: [1.5, 4],
        })
      }
    }
    drawDottedCircle(ctx, cx, cy, R * 1.05, { progress: seg(t, 0, 1.2), alpha: 0.35 })
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * seg(t, 0.1, 1.3))
    ctx.stroke()
    ctx.restore()
    const time = context.time || {}
    const maxDays = time.maxDays ?? 52
    const daysLived = Math.min(time.currentDay ?? 1, maxDays)
    drawScaleArc(ctx, cx, cy, R * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (daysLived / maxDays), {
      progress: seg(t, 0.3, 1.8),
      ticks: daysLived,
      majorEvery: 10,
      tickLen: 3,
      majorLen: 7,
      alpha: 0.55,
    })
    const scale = (R * 0.75) / 34
    drawBeeBody(
      ctx,
      createIdlePose(cx - scale * 1.5, cy + scale * 2, {
        t: completed ? t : 0,
        colorVariant: 'old',
        scale,
        rotation: completed ? -Math.PI / 2 + 0.25 : -0.1,
        seed: 12,
      })
    )

    // Títulos.
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = seg(t, 0.6, 1.5)
    ctx.font = font(M.titleSize)
    ctx.fillText(completed ? 'Continua em breve' : 'Uma vida inteira', cx, M.titleY)
    ctx.globalAlpha = 0.88 * seg(t, 1.0, 2.0)
    ctx.font = font(M.subSize, { style: 'italic' })
    M.subLines.forEach((line, i) => ctx.fillText(line, cx, M.titleY + M.titleSize * 0.85 + i * M.subLH))
    // Único acento rosa: filete sob o subtítulo.
    const ulW = 60 * seg(t, 1.4, 2.2)
    ctx.globalAlpha = 1
    ctx.strokeStyle = UI.pink
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(cx - ulW, M.ulY)
    ctx.lineTo(cx + ulW, M.ulY)
    ctx.stroke()
    ctx.restore()

    // Resumo em cartão.
    const { card, narrow } = M
    const padX = 20 * u
    const cp = seg(t, 1.3, 2.2)
    drawPaperCard(ctx, card.x, card.y, card.w, card.h, { seed: 64, alpha: cp })
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = font(12 * u)
    setLetterSpacing(ctx, 1.5)
    ctx.globalAlpha = cp * 0.8
    ctx.fillText('REGISTRO DE CAMPO', card.x + padX, card.y + 28 * u)
    setLetterSpacing(ctx, 0)
    ctx.globalAlpha = cp
    ctx.font = font(16 * u)
    const rank = rankName(context.tasks?.currentRank)
    ctx.fillText(`Dias vividos: ${daysLived} de ${maxDays}`, card.x + padX, card.y + 52 * u)
    ctx.textAlign = narrow ? 'left' : 'right'
    ctx.fillText(`Função final: ${rank}`, narrow ? card.x + padX : card.x + card.w - padX, narrow ? card.y + 75 * u : card.y + 52 * u)
    ctx.restore()

    const colony = context.colony || {}
    const dialsTop = card.y + M.headH
    COLONY_INDICATORS.forEach(({ key, label, short }, i) => {
      const row = Math.floor(i / M.perRow)
      const col = i % M.perRow
      const dx = card.x + 16 + M.slot * (col + 0.5)
      const dy = dialsTop + M.radius + 7 + row * M.rowH
      drawDial(ctx, dx, dy, M.radius, colony[key] ?? 0, {
        label,
        shortLabel: short,
        time: t,
        labelSize: M.labelSize,
        labelMaxWidth: M.slot - 6,
        reveal: seg(t, 1.6 + i * 0.08, 2.6 + i * 0.08),
      })
    })

    const ready = seg(t, MIN_TIME, MIN_TIME + 0.8)
    if (ready > 0) {
      ctx.save()
      ctx.globalAlpha = ready
      drawButton(ctx, M.btn, 'Voltar ao menu', { focused: true, accent: false, time: t })
      ctx.restore()
      drawHint(ctx, M.L, continueHint(context, 'voltar ao menu'), ready)
    }

    fadeScreen(ctx, w, h, (1 - seg(t, 0, 0.8)) * 0.9, UI.paper)
  },

  exit() {},
}
