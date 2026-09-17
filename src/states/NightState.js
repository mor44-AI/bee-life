import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawBackground } from '../art/environment.js'
import { UI, font } from '../ui/IndicatorBar.js'
import { createLayerCache, drawPaperCard, wrapText, screenLayout, safeRect, anyKeyPressed } from '../ui/HUD.js'

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
    ctx.font = font(Math.min(30, S.w * 0.075))
    ctx.fillText(dawn > 0.25 ? 'Um novo dia na colmeia' : 'A colmeia repousa', cx, top)
    ctx.font = font(15, { style: 'italic' })
    ctx.fillText(`Dia ${result.oldDay ?? 1} ao dia ${context.time.currentDay}`, cx, top + 27)
    const beeY = top + 38 + radius
    drawBeeBody(ctx, createIdlePose(cx, beeY, {
      t: elapsed * 0.4, scale: radius / 24, rotation: -0.12, colorVariant: 'adult', seed: 7,
    }))
    const cardW = Math.min(540, S.w - 28)
    const cardY = beeY + radius + 16
    const cardH = Math.min(174, S.y + S.h - 42 - cardY)
    drawPaperCard(ctx, cx - cardW / 2, cardY, cardW, cardH, { seed: 45 })
    ctx.fillStyle = UI.ink
    ctx.font = font(19)
    ctx.fillText(`Turno concluído · ${Math.round(result.score ?? 0)} pontos`, cx, cardY + 30)
    ctx.font = font(14, { style: 'italic' })
    const lines = wrapText(ctx, result.summary || 'O trabalho da operária faz parte da vida da colônia.', cardW - 36)
    const maxLines = Math.max(1, Math.min(3, Math.floor((cardH - 76) / 19)))
    lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, cx, cardY + 56 + i * 19))
    const delta = result.healthChange ?? 0
    ctx.font = font(14)
    ctx.fillText(`Saúde da colônia: ${Math.round(context.colony.health)}% (${delta >= 0 ? '+' : ''}${delta})`, cx, cardY + cardH - 17)
    ctx.font = font(12, { style: 'italic' })
    ctx.fillText('toque ou Enter para continuar', cx, S.y + S.h - 18)
    ctx.restore()
  },
  exit() { result = null },
}
