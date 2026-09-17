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
    const compact = S.h < 480
    // Tela baixa e deitada (celular deitado): título + abelha à esquerda, cartão à direita.
    const side = compact && S.w > S.h * 1.4
    const leftW = side ? S.w * 0.44 : S.w
    const cx = side ? S.x + leftW / 2 : S.x + S.w / 2
    const top = side ? S.y + Math.max(40, S.h * 0.2) : S.y + S.h * (compact ? 0.14 : 0.18)
    const radius = side ? Math.min(leftW * 0.25, S.h * 0.17, 72) : Math.min(S.w * 0.17, S.h * 0.11, 72)
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    const heading = dawn > 0.25 ? t('night.newDay') : t('night.resting')
    fitFont(ctx, heading, leftW - 24, Math.min(30, leftW * 0.075, side ? 26 : 30), 16)
    ctx.fillText(heading, cx, top)
    const daysLine = t('night.days', { from: result.oldDay ?? 1, to: context.time.currentDay })
    fitFont(ctx, daysLine, leftW - 24, 15, 12, { style: 'italic' })
    ctx.fillText(daysLine, cx, top + 27)
    const beeY = top + 38 + radius
    drawBeeBody(ctx, createIdlePose(cx, beeY, {
      t: elapsed * 0.4, scale: radius / 24, rotation: -0.12, colorVariant: 'adult', seed: 7,
    }))
    let cardX, cardY, cardW, cardH
    if (side) {
      cardW = Math.min(440, S.w - leftW - 28)
      cardX = S.x + leftW + (S.w - leftW - cardW) / 2 - 6
      const availTop = S.y + 14
      const availBottom = S.y + S.h - 40
      cardH = Math.min(230, availBottom - availTop)
      cardY = availTop + (availBottom - availTop - cardH) / 2
    } else {
      cardW = Math.min(540, S.w - 28)
      cardX = cx - cardW / 2
      cardY = beeY + radius + 16
      cardH = Math.min(174, S.y + S.h - 42 - cardY)
    }
    const ccx = cardX + cardW / 2
    // Resumo: quebra em linhas; encolhe a fonte e, se ainda não couber, termina com "…".
    const summary = result.summary || t('night.defaultSummary')
    const avail = cardH - 76
    let size = 14
    let lh, lines, maxLines
    for (;;) {
      ctx.font = font(size, { style: 'italic' })
      lh = Math.round(size * 1.36)
      lines = wrapText(ctx, summary, cardW - 36)
      maxLines = Math.max(1, Math.min(side ? 6 : 4, Math.floor(avail / lh)))
      if (lines.length <= maxLines || size <= 12) break
      size -= 0.5
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      let last = lines[maxLines - 1].replace(/[\s,.;:\-·]*$/, '') + '…'
      while (ctx.measureText(last).width > cardW - 36 && last.includes(' ')) {
        last = last.replace(/\s*\S+…$/, '').replace(/[\s,.;:\-·]*$/, '') + '…'
      }
      lines[maxLines - 1] = last
    }
    if (side) {
      // Cartão do tamanho do conteúdo, centrado na coluna.
      const fitH = Math.max(130, 56 + lines.length * lh + 27)
      if (fitH < cardH) {
        cardY += (cardH - fitH) / 2
        cardH = fitH
      }
    }
    drawPaperCard(ctx, cardX, cardY, cardW, cardH, { seed: 45 })
    ctx.fillStyle = UI.ink
    const scoreLine = t('night.shiftDone', { score: Math.round(result.score ?? 0) })
    fitFont(ctx, scoreLine, cardW - 24, 19, 13)
    ctx.fillText(scoreLine, ccx, cardY + 30)
    ctx.font = font(size, { style: 'italic' })
    lines.forEach((line, i) => ctx.fillText(line, ccx, cardY + 56 + i * lh))
    const delta = result.healthChange ?? 0
    const healthLine = t('night.colonyHealth', { health: Math.round(context.colony.health), delta: `${delta >= 0 ? '+' : ''}${delta}` })
    fitFont(ctx, healthLine, cardW - 24, 14, 11)
    ctx.fillText(healthLine, ccx, cardY + cardH - 17)
    fitFont(ctx, t('night.hint'), S.w - 24, 12, 10, { style: 'italic' })
    ctx.fillText(t('night.hint'), S.x + S.w / 2, S.y + S.h - 18)
    ctx.restore()
  },
  exit() { result = null },
}
