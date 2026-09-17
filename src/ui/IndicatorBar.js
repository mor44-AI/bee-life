// IndicatorBar - indicador individual no estilo "instrumento técnico"
// (styleGuide.technicalOverlayMotif): mostrador fino de 270° com marcas de
// escala tipo transferidor, ponteiro, círculo pontilhado concêntrico e uma
// pequena faixa de "zona crítica" (0-25). Nada de barra de progresso genérica.
//
// API pública:
//   default class IndicatorBar
//     new IndicatorBar({ label, shortLabel, value = 0, radius = 24, duration = 1.1 })
//     .setValue(v, { immediate = false })  -> anima (tween easeInOutCubic) até v (0-100)
//     .update(dt)                           -> avança a animação
//     .value  (valor exibido, animado)  /  .target (valor-alvo)
//     .draw(ctx, x, y, { radius, time, reveal, labelColor, labelSize, labelMaxWidth, valueSize })
//       -> desenha centrado em (x, y)
//   drawDial(ctx, x, y, radius, value, opts)  -> desenho sem estado (mesmas opções + label)
//     labelSize (px, padrão max(12, 10·escala)) · labelMaxWidth: se o rótulo não couber,
//     reduz espaçamento e fonte (até 11px) e, em último caso, usa opts.shortLabel.
//     valueSize (px, padrão max(12, 11·escala)).
//   dialFootprint(radius, labelSize) -> altura total (anel + rótulo) abaixo/acima do centro
//   Primitivas do motivo técnico, reaproveitadas pelos estados de UI:
//     UI (paleta/tokens), font(size, { weight, style }),
//     drawScaleArc(ctx, cx, cy, r, a0, a1, opts), drawDottedCircle(ctx, cx, cy, r, opts),
//     drawGuideLine(ctx, x0, y0, x1, y1, opts), setLetterSpacing(ctx, px)
//   CRITICAL_THRESHOLD = 25

import { ease } from '../engine/tween.js'
import { styleGuide } from '../data/styleGuide.js'

const N = styleGuide.palettes.naturalist

export const UI = {
  ink: N.inkLine,
  paper: N.paperCreamLight,
  paperDark: N.paperCreamDark,
  sage: N.leafSage,
  sageShadow: N.leafSageShadow,
  sageLight: N.leafSageHighlight,
  gold: N.caterpillarGold,
  sunGold: N.sunGold,
  sunHalo: N.sunHalo,
  pink: N.accentPink, // um único acento por cena - os estados decidem onde
  critical: '#A1482F', // terracota apagada: visível sem "gritar" (não é o acento rosa)
  serif: 'Georgia, "Times New Roman", serif',
}

export const CRITICAL_THRESHOLD = 25

export function font(size, { weight = '', style = '' } = {}) {
  return `${style} ${weight} ${Math.round(size)}px ${UI.serif}`.replace(/\s+/g, ' ').trim()
}

export function setLetterSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/** Arco fino com marcas de escala (transferidor). progress 0..1 revela o traço. */
export function drawScaleArc(ctx, cx, cy, r, a0, a1, opts = {}) {
  const {
    progress = 1,
    ticks = 10,
    majorEvery = 5,
    tickLen = 4,
    majorLen = 8,
    color = UI.ink,
    alpha = 0.8,
    lineWidth = 1,
    inward = true,
  } = opts
  if (progress <= 0) return
  const p = clamp(progress, 0, 1)
  const aEnd = a0 + (a1 - a0) * p
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha *= alpha
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r, a0, aEnd, a1 < a0)
  ctx.stroke()
  if (ticks > 0) {
    ctx.beginPath()
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks
      if (f > p + 1e-6) break
      const a = a0 + (a1 - a0) * f
      const len = i % majorEvery === 0 ? majorLen : tickLen
      const r2 = inward ? r - len : r + len
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
    }
    ctx.lineWidth = lineWidth * 0.8
    ctx.stroke()
  }
  ctx.restore()
}

/** Círculo pontilhado fino (guia). progress revela o círculo a partir de `rotation`. */
export function drawDottedCircle(ctx, cx, cy, r, opts = {}) {
  const {
    progress = 1,
    color = UI.ink,
    alpha = 0.4,
    lineWidth = 1,
    dash = [1.2, 4],
    rotation = -Math.PI / 2,
  } = opts
  if (progress <= 0 || r <= 0) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha *= alpha
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.arc(cx, cy, r, rotation, rotation + Math.PI * 2 * clamp(progress, 0, 1))
  ctx.stroke()
  ctx.restore()
}

/** Linha de guia pontilhada/tracejada que se desenha progressivamente. */
export function drawGuideLine(ctx, x0, y0, x1, y1, opts = {}) {
  const { progress = 1, color = UI.ink, alpha = 0.35, lineWidth = 1, dash = [2, 5] } = opts
  if (progress <= 0) return
  const p = clamp(progress, 0, 1)
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha *= alpha
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p)
  ctx.stroke()
  ctx.restore()
}

// Mostrador de 270°, abertura embaixo (onde fica o número).
const A0 = Math.PI * 0.75
const A1 = Math.PI * 2.25
const valueAngle = (v) => A0 + (A1 - A0) * (clamp(v, 0, 100) / 100)

/**
 * Desenha um mostrador completo. opts: { label, time = 0, reveal = 1,
 * labelColor, showValue = true, compact = false }
 */
export function drawDial(ctx, x, y, radius, value, opts = {}) {
  const { label = '', shortLabel = '', time = 0, reveal = 1, labelColor = UI.ink, showValue = true, labelMaxWidth = 0 } = opts
  const r = radius
  const v = clamp(value, 0, 100)
  const critical = v < CRITICAL_THRESHOLD
  const p = clamp(reveal, 0, 1)
  const valueColor = critical ? UI.critical : UI.sageShadow

  ctx.save()

  // Anel pontilhado externo (e "respiração" lenta quando crítico).
  if (critical) {
    const breathe = 0.5 + 0.5 * Math.sin(time * 2.2)
    drawDottedCircle(ctx, x, y, r + 5 + breathe * 1.5, {
      progress: p,
      color: UI.critical,
      alpha: 0.35 + breathe * 0.35,
      dash: [1.4, 3.2],
    })
  } else {
    drawDottedCircle(ctx, x, y, r + 5, { progress: p, alpha: 0.28 })
  }

  // Escala principal: 0-100, marca a cada 5, maior a cada 25.
  const tickScale = r / 24
  drawScaleArc(ctx, x, y, r, A0, A1, {
    progress: p,
    ticks: 20,
    majorEvery: 5,
    tickLen: 2.6 * tickScale,
    majorLen: 5.5 * tickScale,
    alpha: 0.75,
    lineWidth: 0.9,
  })

  // Zona crítica (0-25): arco duplo fino por fora da escala.
  if (p > 0) {
    const zoneEnd = valueAngle(CRITICAL_THRESHOLD)
    ctx.save()
    ctx.strokeStyle = UI.critical
    ctx.globalAlpha *= critical ? 0.75 : 0.35
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(x, y, r + 1.8, A0, A0 + (zoneEnd - A0) * p)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, r + 3.2, A0, A0 + (zoneEnd - A0) * p)
    ctx.stroke()
    ctx.restore()
  }

  // Arco do valor (interno, um pouco mais grosso).
  const innerR = r - 8 * tickScale
  const aV = A0 + (valueAngle(v) - A0) * p
  if (innerR > 2 && v > 0.2) {
    ctx.save()
    ctx.strokeStyle = valueColor
    ctx.globalAlpha *= 0.85
    ctx.lineWidth = Math.max(1.6, 2.4 * tickScale)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(x, y, innerR, A0, aV)
    ctx.stroke()
    ctx.restore()
  }

  // Círculo interno fino (concêntrico).
  if (innerR > 6) {
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha *= 0.18 * p
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.arc(x, y, innerR * 0.55, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // Ponteiro com contrapeso e cubo dourado.
  if (p > 0.05) {
    const ca = Math.cos(aV)
    const sa = Math.sin(aV)
    ctx.save()
    ctx.globalAlpha *= p
    ctx.strokeStyle = critical ? UI.critical : UI.ink
    ctx.lineCap = 'round'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(x - ca * r * 0.18, y - sa * r * 0.18)
    ctx.lineTo(x + ca * (r - 1.5), y + sa * (r - 1.5))
    ctx.stroke()
    ctx.fillStyle = UI.gold
    ctx.strokeStyle = UI.ink
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1.8, 2.4 * tickScale), 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  // Número na abertura inferior do mostrador.
  if (showValue && p > 0.4) {
    ctx.save()
    ctx.globalAlpha *= clamp((p - 0.4) / 0.6, 0, 1)
    ctx.fillStyle = critical ? UI.critical : UI.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = font(opts.valueSize ?? Math.max(12, 11 * tickScale), { style: 'italic' })
    ctx.fillText(String(Math.round(v)), x, y + r * 0.78)
    ctx.restore()
  }

  // Rótulo em versalete espaçado.
  if (label) {
    ctx.save()
    ctx.globalAlpha *= p
    ctx.fillStyle = labelColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    let size = opts.labelSize ?? Math.max(12, 10 * Math.min(1.3, tickScale))
    let spacing = 1.2
    let text = label.toUpperCase()
    ctx.font = font(size)
    setLetterSpacing(ctx, spacing)
    if (labelMaxWidth > 0) {
      const fits = () => ctx.measureText(text).width <= labelMaxWidth
      while (!fits() && (spacing > 0 || size > 11)) {
        if (spacing > 0) spacing = Math.max(0, spacing - 0.4)
        else size -= 0.5
        ctx.font = font(size)
        setLetterSpacing(ctx, spacing)
      }
      if (!fits() && shortLabel) text = shortLabel.toUpperCase()
    }
    ctx.fillText(text, x, y + r + 9)
    setLetterSpacing(ctx, 0)
    ctx.restore()
  }

  ctx.restore()
}

export function dialFootprint(radius, labelSize = 12) {
  return { above: radius + 7, below: radius + 9 + labelSize * 1.2 }
}

export default class IndicatorBar {
  constructor({ label = '', shortLabel = '', value = 0, radius = 24, duration = 1.1 } = {}) {
    this.label = label
    this.shortLabel = shortLabel
    this.radius = radius
    this.duration = duration
    this._from = clamp(value, 0, 100)
    this._to = this._from
    this._display = this._from
    this._t = 1
  }

  get value() {
    return this._display
  }

  get target() {
    return this._to
  }

  get isCritical() {
    return this._to < CRITICAL_THRESHOLD
  }

  setValue(v, { immediate = false } = {}) {
    const next = clamp(Number.isFinite(v) ? v : 0, 0, 100)
    if (immediate) {
      this._from = this._to = this._display = next
      this._t = 1
      return
    }
    if (Math.abs(next - this._to) < 0.01) return
    this._from = this._display
    this._to = next
    this._t = 0
  }

  update(dt) {
    if (this._t >= 1) return
    this._t = Math.min(1, this._t + (dt || 0) / this.duration)
    this._display = this._from + (this._to - this._from) * ease(this._t, 'easeInOutCubic')
  }

  draw(ctx, x, y, opts = {}) {
    drawDial(ctx, x, y, opts.radius ?? this.radius, this._display, {
      ...opts,
      label: opts.label ?? this.label,
      shortLabel: opts.shortLabel ?? this.shortLabel,
    })
  }
}
