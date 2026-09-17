import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawBackground } from '../art/environment.js'
import { UI, font } from '../ui/IndicatorBar.js'
import { createLayerCache, drawPaperCard, wrapText, screenLayout, safeRect, anyKeyPressed } from '../ui/HUD.js'
import { t } from '../i18n/index.js'

// Encolhe a fonte até o texto caber na largura (nunca estoura em 320px).
function fitFont(ctx, text, maxW, size, min, opts) {
  ctx.font = font(size, opts)
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 0.5
    ctx.font = font(size, opts)
  }
}

export const NIGHT_DURATION = 4.5
const backdrop = createLayerCache((ctx, w, h) => drawBackground(ctx, 'night', { width: w, height: h, seed: 84 }))
let elapsed = 0
let result = null
let finished = false

export default {
  enter(context, data = {}) {
    elapsed = 0
    finished = false
    result = data
    context.input.consumeClicks()
  },
  update(context, dt) {
    elapsed += dt
    const skip = context.input.consumeClicks().length > 0 || anyKeyPressed(context.input, ['Enter', 'Space'])
    if (!finished && (elapsed >= NIGHT_DURATION || (skip && elapsed >= 1.2))) {
      finished = true
      context.completeNight()
    }
  },
  render(context, ctx) {
    const { width: w, height: h } = context
    const S = safeRect(screenLayout(context))
    backdrop.draw(ctx, 0, 0, w, h)
    const dawn = Math.max(0, (elapsed - 2.8) / 1.7)
    ctx.fillStyle = `rgba(247,223,160,${dawn * 0.3})`
    ctx.fillRect(0, 0, w, h)
    const cx = S.x + S.w / 2
    const compact = S.h < 480
    const top = S.y + S.h * (compact ? 0.14 : 0.18)
    const radius = Math.min(S.w * 0.17, S.h * 0.11, 72)
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    const heading = dawn > 0.25 ? t('night.newDay') : t('night.resting')
    fitFont(ctx, heading, S.w - 24, Math.min(30, S.w * 0.075), 16)
    ctx.fillText(heading, cx, top)
    ctx.font = font(15, { style: 'italic' })
    ctx.fillText(t('night.days', { from: result.oldDay ?? 1, to: context.time.currentDay }), cx, top + 27)
    const beeY = top + 38 + radius
    drawBeeBody(ctx, createIdlePose(cx, beeY, {
      t: elapsed * 0.4, scale: radius / 24, rotation: -0.12, colorVariant: 'adult', seed: 7,
    }))
    const cardW = Math.min(540, S.w - 28)
    const cardY = beeY + radius + 16
    const cardH = Math.min(174, S.y + S.h - 42 - cardY)
    drawPaperCard(ctx, cx - cardW / 2, cardY, cardW, cardH, { seed: 45 })
    ctx.fillStyle = UI.ink
    const scoreLine = t('night.shiftDone', { score: Math.round(result.score ?? 0) })
    fitFont(ctx, scoreLine, cardW - 24, 19, 13)
    ctx.fillText(scoreLine, cx, cardY + 30)
    ctx.font = font(14, { style: 'italic' })
    const lines = wrapText(ctx, result.summary || t('night.defaultSummary'), cardW - 36)
    const maxLines = Math.max(1, Math.min(3, Math.floor((cardH - 76) / 19)))
    lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, cx, cardY + 56 + i * 19))
    const delta = result.healthChange ?? 0
    const healthLine = t('night.colonyHealth', { health: Math.round(context.colony.health), delta: `${delta >= 0 ? '+' : ''}${delta}` })
    fitFont(ctx, healthLine, cardW - 24, 14, 11)
    ctx.fillText(healthLine, cx, cardY + cardH - 17)
    fitFont(ctx, t('night.hint'), S.w - 24, 12, 10, { style: 'italic' })
    ctx.fillText(t('night.hint'), cx, S.y + S.h - 18)
    ctx.restore()
  },
  exit() { result = null },
}
