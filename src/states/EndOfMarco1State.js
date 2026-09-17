// EndOfMarco1State — enter(context, { reason }):
//   'completed' -> dominou a defesa da entrada: "Continua em breve — lá fora, o mundo ultravioleta espera"
//   'lifeOver'  -> a vida chegou ao fim antes disso.
// Resumo: dias vividos, função final e estado final da colônia (mostradores estáticos).
// Clique/tecla -> goTo('menu').

import { ease } from '../engine/tween.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { UI, font, drawDial, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import { createPaperBackdrop, createKeyWatcher, drawPaperCard, wrapText, rankName, COLONY_INDICATORS, fadeScreen } from '../ui/HUD.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const MIN_TIME = 1.2

const backdrop = createPaperBackdrop({ seed: 97 })
let keys = null
let t = 0
let reason = 'completed'

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const seg = (time, a, b) => ease(clamp01((time - a) / (b - a)), 'easeInOutCubic')

export default {
  enter(context, data = {}) {
    t = 0
    reason = data.reason === 'lifeOver' ? 'lifeOver' : 'completed'
    keys = createKeyWatcher(context.input, KEYS)
    keys.prime()
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    const pressed = context.input.consumeClicks().length > 0 || keys.poll().size > 0
    if (pressed && t >= MIN_TIME) context.goTo('menu')
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    const completed = reason === 'completed'
    const cx = w / 2
    const R = Math.max(60, Math.min(w * 0.2, h * 0.17))
    const cy = Math.max(R * 1.3 + 10, h * 0.25)

    // Emblema: para 'completed', a entrada do ninho aberta para uma luz de fora;
    // para 'lifeOver', um mostrador que se fecha em silêncio.
    if (completed) {
      const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6)
      glow.addColorStop(0, `rgba(247, 223, 160, ${0.7 * seg(t, 0, 1.5)})`)
      glow.addColorStop(1, 'rgba(247, 223, 160, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4)
      // Raios finos pontilhados "de fora".
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
    const titleY = cy + R * 1.35 + 30
    const titleSize = Math.max(26, Math.min(46, w * 0.055))
    ctx.save()
    ctx.textAlign = 'center'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = seg(t, 0.6, 1.5)
    ctx.font = font(titleSize)
    ctx.fillText(completed ? 'Continua em breve' : 'Uma vida inteira', cx, titleY)
    ctx.globalAlpha = 0.8 * seg(t, 1.0, 2.0)
    ctx.font = font(Math.max(14, titleSize * 0.4), { style: 'italic' })
    const sub = completed
      ? 'lá fora, o mundo ultravioleta espera'
      : 'A sua vida chegou ao fim antes de dominar a defesa da entrada. A colônia segue.'
    const subLines = wrapText(ctx, sub, Math.min(560, w - 48))
    subLines.forEach((line, i) => ctx.fillText(line, cx, titleY + titleSize * 0.85 + i * 22))
    // Único acento rosa: filete sob o subtítulo.
    const ulY = titleY + titleSize * 0.85 + (subLines.length - 1) * 22 + 14
    const ulW = 60 * seg(t, 1.4, 2.2)
    ctx.globalAlpha = 1
    ctx.strokeStyle = UI.pink
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(cx - ulW, ulY)
    ctx.lineTo(cx + ulW, ulY)
    ctx.stroke()
    ctx.restore()

    // Resumo em cartão.
    const cardW = Math.min(640, w - 32)
    const narrow = cardW < 520
    const cardH = narrow ? 256 : 150
    const cardX = cx - cardW / 2
    const cardY = Math.min(h - cardH - 40, ulY + 24)
    const cp = seg(t, 1.3, 2.2)
    drawPaperCard(ctx, cardX, cardY, cardW, cardH, { seed: 64, alpha: cp })
    ctx.save()
    ctx.globalAlpha = cp
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'left'
    ctx.font = font(9)
    setLetterSpacing(ctx, 1.6)
    ctx.globalAlpha = cp * 0.6
    ctx.fillText('REGISTRO DE CAMPO', cardX + 22, cardY + 28)
    setLetterSpacing(ctx, 0)
    ctx.globalAlpha = cp
    ctx.font = font(15)
    const rank = rankName(context.tasks?.currentRank)
    ctx.fillText(`Dias vividos: ${daysLived} de ${maxDays}`, cardX + 22, cardY + 52)
    ctx.textAlign = narrow ? 'left' : 'right'
    ctx.fillText(`Função final: ${rank}`, narrow ? cardX + 22 : cardX + cardW - 22, narrow ? cardY + 74 : cardY + 52)
    ctx.restore()

    const colony = context.colony || {}
    const dialsTop = cardY + (narrow ? 96 : 70)
    const perRow = narrow ? 3 : 6
    const slot = (cardW - 32) / perRow
    const radius = Math.max(14, Math.min(22, slot * 0.28))
    COLONY_INDICATORS.forEach(({ key, label }, i) => {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      const dx = cardX + 16 + slot * (col + 0.5)
      const dy = dialsTop + radius + 4 + row * (radius * 2 + 34)
      drawDial(ctx, dx, dy, radius, colony[key] ?? 0, { label, time: t, reveal: seg(t, 1.6 + i * 0.08, 2.6 + i * 0.08) })
    })

    ctx.save()
    ctx.globalAlpha = 0.45 * seg(t, MIN_TIME, MIN_TIME + 0.8)
    ctx.fillStyle = UI.ink
    ctx.font = font(12, { style: 'italic' })
    ctx.textAlign = 'right'
    ctx.fillText('clique para voltar ao menu', w - 20, h - 16)
    ctx.restore()

    fadeScreen(ctx, w, h, (1 - seg(t, 0, 0.8)) * 0.9, UI.paper)
  },

  exit() {},
}
