// NightState - noite entre turnos (e cartão de resultado do turno livre).
//
// data (de GameSession.finishShift): { nextScene, oldDay, score, summary, healthChange,
//   points: { actionPoints, phaseBonus, points, bestCombo, free }, total, free?, taskId? }
// Mostra os pontos do turno com contagem animada (pontos de ação -> bônus "cuidado da
// colmeia" -> total do turno -> melhor combo -> placar da vida), o resumo do turno, a
// saúde da colônia e uma curiosidade (nextFact()). Turno livre: título "Turno livre" /
// "não conta no ranking", sem avanço de dia nem placar da vida; completeNight() volta ao hub.
// Toque/Enter: 1º conclui a contagem; depois continua. Avança sozinho em NIGHT_DURATION s.
// Layout: vertical empilhado; celular deitado (tela baixa) em duas colunas.

import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawBackground } from '../art/environment.js'
import { ease } from '../engine/tween.js'
import { UI, font, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createLayerCache, drawPaperCard, screenLayout, safeRect, uiScaleOf, anyKeyPressed,
  fitParagraph, drawFact, measureFact, measureContext,
} from '../ui/HUD.js'
import { nextFact } from '../data/facts.js'
import { t, getLang } from '../i18n/index.js'

// Encolhe a fonte até o texto caber na largura (nunca estoura em 320px).
function fitFont(ctx, text, maxW, size, min, opts) {
  ctx.font = font(size, opts)
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 0.5
    ctx.font = font(size, opts)
  }
}

export const NIGHT_DURATION = 12
// Linha do tempo da contagem (s): [início, fim] de cada número.
const COUNT = { action: [0.35, 1.25], bonus: [1.1, 1.7], total: [1.6, 2.4], combo: [2.3, 2.6], life: [2.5, 3.3] }
const COUNT_END = 3.3
const DAWN_START = 3.4
const KEYS = ['Enter', 'NumpadEnter', 'Space']

const backdrop = createLayerCache((ctx, w, h) => drawBackground(ctx, 'night', { width: w, height: h, seed: 84 }))
let elapsed = 0
let countT = 0
let result = null
let fact = null
let finished = false

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const prog = ([a, b]) => clamp01((countT - a) / (b - a))
const fmt = (n) => Math.round(n).toLocaleString(getLang() === 'pt' ? 'pt-BR' : 'en-US')

function pointsOf(r) {
  const p = r?.points && typeof r.points === 'object' ? r.points : {}
  const num = (v) => (Number.isFinite(v) ? v : 0)
  const action = num(p.actionPoints)
  const bonus = num(p.phaseBonus)
  const free = !!(r?.free || p.free)
  const total = num(r?.total)
  const shift = Number.isFinite(p.points) ? p.points : action + bonus
  return { action, bonus, shift, combo: num(p.bestCombo), free, life: total, lifeBefore: free ? total : Math.max(0, total - shift) }
}

// Métricas do cartão de pontos (altura depende das linhas presentes).
function cardMetrics(u, compact, free) {
  const rowH = Math.round((compact ? 19 : 22) * u)
  const pad = Math.round(13 * u)
  const titleH = Math.round(17 * u)
  const totalH = Math.round((compact ? 25 : 30) * u)
  const pointsH = pad + titleH + rowH * 2 + 6 + totalH + rowH + (free ? 0 : rowH)
  return { rowH, pad, titleH, totalH, pointsH }
}

function drawRow(ctx, x0, x1, y, label, value, { size, bold = false, alpha = 1 }) {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.textAlign = 'left'
  fitFont(ctx, label, (x1 - x0) * 0.66, size, 10, bold ? {} : { style: 'italic' })
  ctx.fillText(label, x0, y)
  ctx.textAlign = 'right'
  ctx.font = font(size * (bold ? 1.15 : 1))
  ctx.fillText(value, x1, y)
  // Guia pontilhada entre rótulo e valor (régua de instrumento).
  const lw = Math.min(ctx.measureText(value).width, x1 - x0)
  ctx.font = font(size, bold ? {} : { style: 'italic' })
  const lab = ctx.measureText(label).width
  const gx0 = x0 + lab + 6
  const gx1 = x1 - lw - 6
  if (gx1 - gx0 > 10) {
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha *= 0.3
    ctx.lineWidth = 1
    ctx.setLineDash([1.5, 3.5])
    ctx.beginPath()
    ctx.moveTo(gx0, y - size * 0.25)
    ctx.lineTo(gx1, y - size * 0.25)
    ctx.stroke()
  }
  ctx.restore()
}

// Desenha o cartão de pontos + resumo + saúde em rect; devolve nada.
function drawResultCard(ctx, context, rect, u, compact) {
  const P = pointsOf(result)
  const M = cardMetrics(u, compact, P.free)
  const { x, y, w, h } = rect
  drawPaperCard(ctx, x, y, w, h, { seed: 45 })
  const x0 = x + 18 * u
  const x1 = x + w - 18 * u
  const size = (compact ? 13.5 : 15) * u
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textBaseline = 'alphabetic'
  let cy = y + M.pad + M.titleH * 0.75
  ctx.textAlign = 'left'
  ctx.font = font(11 * u)
  setLetterSpacing(ctx, 1.5)
  ctx.globalAlpha = 0.75
  ctx.fillText(t('night.points.title'), x0, cy)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = 1
  cy += M.titleH * 0.25 + M.rowH * 0.8
  const pa = prog(COUNT.action)
  const pb = prog(COUNT.bonus)
  const pt = prog(COUNT.total)
  drawRow(ctx, x0, x1, cy, t('night.points.action'), fmt(P.action * ease(pa, 'easeOutCubic')), { size, alpha: 0.35 + 0.65 * Math.min(1, pa * 3) })
  cy += M.rowH
  drawRow(ctx, x0, x1, cy, t('night.points.bonus'), `+${fmt(P.bonus * ease(pb, 'easeOutCubic'))}`, { size, alpha: 0.35 + 0.65 * Math.min(1, pb * 3) })
  cy += M.rowH * 0.2 + 3
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, cy)
  ctx.lineTo(x1, cy)
  ctx.stroke()
  ctx.globalAlpha = 1
  cy += 3 + M.totalH * 0.78
  // Total do turno: número maior, com pulso rosa quando a contagem termina.
  const pulse = pt >= 1 ? Math.max(0, 1 - (countT - COUNT.total[1]) / 0.5) : 0
  drawRow(ctx, x0, x1, cy, t('night.points.total'), fmt(P.shift * ease(pt, 'easeOutCubic')), {
    size: (compact ? 16 : 18) * u, bold: true, alpha: 0.35 + 0.65 * Math.min(1, pt * 3),
  })
  if (pulse > 0) {
    ctx.save()
    ctx.fillStyle = UI.pink
    ctx.globalAlpha = pulse
    ctx.beginPath()
    const mx = x0 - 9 * u
    const my = cy - 6 * u
    ctx.moveTo(mx + 5 * u, my)
    ctx.lineTo(mx, my - 4 * u)
    ctx.lineTo(mx, my + 4 * u)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  cy += M.totalH * 0.22 + M.rowH * 0.85
  const pc = prog(COUNT.combo)
  drawRow(ctx, x0, x1, cy, t('night.points.combo'), t('night.points.comboValue', { n: Math.round(P.combo * pc) }), { size, alpha: 0.35 + 0.65 * pc })
  if (!P.free) {
    cy += M.rowH
    const pl = prog(COUNT.life)
    drawRow(ctx, x0, x1, cy, t('night.points.life'), fmt(P.lifeBefore + (P.life - P.lifeBefore) * ease(pl, 'easeOutCubic')), {
      size, bold: true, alpha: 0.35 + 0.65 * Math.min(1, pl * 3),
    })
  }
  // Resumo + saúde, no espaço que sobrar.
  const healthSize = (compact ? 12 : 13) * u
  const bottom = y + h - 13 * u
  const sumTop = y + M.pointsH + 8 * u
  const sumH = bottom - healthSize * 1.5 - sumTop
  ctx.textAlign = 'center'
  const summary = result?.summary || t('night.defaultSummary')
  if (sumH > 12) {
    const p = fitParagraph(ctx, summary, w - 36 * u, sumH, { size: (compact ? 13 : 14) * u, minSize: 11, lineHeight: 1.3, maxLines: 4 })
    ctx.globalAlpha = 0.9
    p.lines.forEach((line, i) => ctx.fillText(line, x + w / 2, sumTop + p.size + i * p.lh))
  }
  ctx.globalAlpha = 0.85
  const delta = result?.healthChange ?? 0
  const healthLine = t('night.colonyHealth', { health: Math.round(context.colony?.health ?? 0), delta: `${delta >= 0 ? '+' : ''}${delta}` })
  fitFont(ctx, healthLine, w - 28 * u, healthSize, 10)
  ctx.fillText(healthLine, x + w / 2, bottom)
  ctx.restore()
}

// Altura desejada do cartão: pontos + ~3 linhas de resumo + saúde.
function wantedCardH(u, compact, free, cardW) {
  const M = cardMetrics(u, compact, free)
  const size = (compact ? 13 : 14) * u
  const mctx = measureContext()
  const text = result?.summary || t('night.defaultSummary')
  const n = mctx ? Math.min(4, fitParagraph(mctx, text, cardW - 36 * u, Infinity, { size, minSize: size }).lines.length) : 3
  return M.pointsH + 8 * u + n * size * 1.3 + (compact ? 12 : 13) * u * 1.5 + 18 * u
}

function computeLayout(context) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = Math.min(uiScaleOf(L), 1.15)
  const compact = S.h < 620
  const free = pointsOf(result).free
  const side = S.h < 480 && S.w > S.h * 1.3
  const hintY = S.y + S.h - 16 * u
  const hintTop = hintY - 20 * u
  if (side) {
    const leftW = Math.min(S.w * 0.46, 420)
    const top = S.y + 34 * u
    const cardW = Math.min(440, S.w - leftW - 36)
    const cardX = S.x + leftW + (S.w - leftW - cardW) / 2
    const availTop = S.y + 12
    const cardH = Math.min(wantedCardH(u, true, free, cardW), hintTop - 6 - availTop)
    const cardY = availTop + (hintTop - 6 - availTop - cardH) / 2
    const factY = top + 24 * u + 16 * u
    const fact = { x: S.x + 20, y: factY, w: leftW - 32, h: hintTop - 8 - factY }
    return { S, u, compact: true, side, cx: S.x + leftW / 2, leftW, top, card: { x: cardX, y: cardY, w: cardW, h: cardH }, fact, bee: null, hintY }
  }
  const cx = S.x + S.w / 2
  const top = S.y + Math.max(34 * u, S.h * (compact ? 0.07 : 0.1))
  const headBottom = top + 24 * u + 12 * u
  const cardW = Math.min(460, S.w - 28)
  let cardH = wantedCardH(u, compact, free, cardW)
  const factW = Math.min(520, S.w - 28)
  const factInner = factW - 36 * u
  const factNeed = measureFact(fact, factInner, { u, size: (compact ? 13.5 : 15) * u }) + 30 * u
  const gap = 12 * u
  const room = hintTop - headBottom
  // Prioridade: cartão de pontos > curiosidade > abelha.
  let factH = Math.min(factNeed, Math.max(0, room - cardH - gap * 2))
  if (factH < 70 * u) factH = 0
  let beeR = Math.min(56 * u, (room - cardH - (factH ? factH + gap : 0) - gap * 2) / 2 - 4)
  if (beeR < 22) beeR = 0
  const used = cardH + (factH ? factH + gap : 0) + (beeR ? beeR * 2 + gap : 0)
  let y = headBottom + Math.max(0, (room - used) / 2)
  if (!factH && !beeR && room < cardH + gap) cardH = Math.max(120, room - gap)
  const bee = beeR ? { x: cx, y: y + beeR, r: beeR } : null
  if (bee) y += beeR * 2 + gap
  const card = { x: cx - cardW / 2, y, w: cardW, h: cardH }
  y += cardH + gap
  const factRect = factH ? { x: cx - factW / 2, y, w: factW, h: factH } : null
  return { S, u, compact, side: false, cx, leftW: S.w, top, card, fact: factRect, bee, hintY }
}

export default {
  enter(context, data = {}) {
    elapsed = 0
    countT = 0
    finished = false
    result = data || {}
    fact = nextFact()
    context.input.consumeClicks()
  },
  update(context, dt) {
    elapsed += dt
    countT += dt
    const tap = context.input.consumeClicks().length > 0 || anyKeyPressed(context.input, KEYS)
    if (finished) return
    if (tap && elapsed >= 0.35 && countT < COUNT_END) {
      countT = COUNT_END + 0.5 // 1º toque conclui a contagem
      return
    }
    if (elapsed >= NIGHT_DURATION || (tap && countT >= COUNT_END)) {
      finished = true
      context.completeNight()
    }
  },
  render(context, ctx) {
    const { width: w, height: h } = context
    const H = computeLayout(context)
    const { u, S } = H
    const free = pointsOf(result).free
    backdrop.draw(ctx, 0, 0, w, h)
    const dawn = free ? 0 : clamp01((elapsed - DAWN_START) / 1.8)
    ctx.fillStyle = `rgba(247,223,160,${dawn * 0.3})`
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const colW = (H.side ? H.leftW : S.w) - 24
    const heading = free ? t('night.free.title') : dawn > 0.25 ? t('night.newDay') : t('night.resting')
    fitFont(ctx, heading, colW, Math.min(30, colW * 0.08, H.side ? 26 : 30) * u, 16)
    ctx.fillText(heading, H.cx, H.top)
    const sub = free ? t('night.free.sub') : t('night.days', { from: result?.oldDay ?? 1, to: context.time?.currentDay ?? 1 })
    fitFont(ctx, sub, colW, 15 * u, 11, { style: 'italic' })
    ctx.fillText(sub, H.cx, H.top + 24 * u)
    ctx.restore()

    if (H.bee) {
      drawBeeBody(ctx, createIdlePose(H.bee.x, H.bee.y, {
        t: elapsed * 0.4, scale: H.bee.r / 24, rotation: -0.12, colorVariant: 'adult', seed: 7,
      }))
    }
    drawResultCard(ctx, context, H.card, u, H.compact)
    if (H.fact && fact) {
      const f = H.fact
      const fin = clamp01((elapsed - 0.6) / 0.6)
      ctx.save()
      ctx.globalAlpha = fin
      if (H.side) {
        drawFact(ctx, f, fact, { u, align: 'left', size: 13.5 * u, minSize: 10.5, color: UI.ink })
      } else {
        drawPaperCard(ctx, f.x, f.y, f.w, f.h, { seed: 63, alpha: 0.92 })
        drawFact(ctx, { x: f.x + 18 * u, y: f.y + 14 * u, w: f.w - 36 * u, h: f.h - 26 * u }, fact, {
          u, size: (H.compact ? 13.5 : 15) * u, minSize: 10.5,
        })
      }
      ctx.restore()
    }
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.8
    const hint = free ? t('night.free.hint') : t('night.hint')
    fitFont(ctx, hint, S.w - 24, 12.5 * u, 10, { style: 'italic' })
    ctx.fillText(hint, S.x + S.w / 2, H.hintY)
    ctx.restore()
  },
  exit() { result = null; fact = null },
}
