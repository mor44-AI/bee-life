// IntroState — PLACEHOLDER da abertura (a cinemática final de 20–30s é de outra onda).
// ~4s: sobre o papel naturalista, os elementos de "instrumento técnico" se desenham
// progressivamente (círculos concêntricos, transferidor, guias pontilhadas, uma
// célula hexagonal) e o título "Vida de Abelha" surge. Pulável por clique/tecla.

import { ease } from '../engine/tween.js'
import { UI, font, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import { createPaperBackdrop, createKeyWatcher, fadeScreen } from '../ui/HUD.js'
import { strokeHandDrawn, polygonPoints } from '../art/textureUtils.js'

const DURATION = 4.2
const FADE_OUT = 0.6
const SKIP_KEYS = ['Enter', 'Space', 'Escape', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

const backdrop = createPaperBackdrop({ seed: 7 })
let keys = null
let t = 0
let leaving = -1

const seg = (time, a, b) => ease(Math.max(0, Math.min(1, (time - a) / (b - a))), 'easeInOutCubic')

export default {
  enter(context) {
    t = 0
    leaving = -1
    keys = createKeyWatcher(context.input, SKIP_KEYS)
    keys.prime()
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    const skip = context.input.consumeClicks().length > 0 || keys.poll().size > 0
    if (skip) {
      context.goTo('menu')
      return
    }
    if (leaving < 0 && t >= DURATION) leaving = t
    if (leaving >= 0 && t - leaving >= FADE_OUT) context.goTo('menu')
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)

    const cx = w / 2
    const cy = h * 0.46
    const R = Math.min(w, h) * 0.3

    // Guias pontilhadas horizontais/verticais.
    drawGuideLine(ctx, cx - R * 1.9, cy, cx + R * 1.9, cy, { progress: seg(t, 0.1, 1.4), alpha: 0.25 })
    drawGuideLine(ctx, cx, cy - R * 1.35, cx, cy + R * 1.35, { progress: seg(t, 0.3, 1.5), alpha: 0.2 })

    // Círculos concêntricos.
    drawDottedCircle(ctx, cx, cy, R * 1.12, { progress: seg(t, 0.2, 1.6), alpha: 0.3 })
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * seg(t, 0.4, 1.9))
    ctx.stroke()
    ctx.globalAlpha = 0.22
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.72, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * seg(t, 0.7, 2.1))
    ctx.stroke()
    ctx.restore()

    // Transferidor superior com escala.
    drawScaleArc(ctx, cx, cy, R * 0.9, Math.PI * 1.1, Math.PI * 1.9, {
      progress: seg(t, 0.8, 2.2),
      ticks: 36,
      majorEvery: 6,
      tickLen: 4,
      majorLen: 9,
      alpha: 0.55,
    })

    // Célula hexagonal no centro, contorno de mão revelado ponto a ponto.
    const hp = seg(t, 1.2, 2.4)
    if (hp > 0) {
      const pts = polygonPoints(cx, cy, R * 0.34, R * 0.34, 6, { rotation: Math.PI / 6, jitter: 0.04, seed: 5 })
      const n = Math.max(2, Math.round(hp * 7))
      const path = []
      for (let i = 0; i < n; i++) path.push(pts[i % 6])
      ctx.save()
      ctx.globalAlpha = 0.18 * hp
      ctx.fillStyle = UI.gold
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      strokeHandDrawn(ctx, path, { baseWidth: 1.6, seed: 9, opacity: 0.8 })
    }

    // Ponteiro — o único acento rosa da cena.
    const np = seg(t, 1.8, 3.0)
    if (np > 0) {
      const a = Math.PI * 1.1 + Math.PI * 0.8 * (0.15 + 0.5 * np)
      ctx.save()
      ctx.strokeStyle = UI.pink
      ctx.lineWidth = 1.4
      ctx.lineCap = 'round'
      ctx.globalAlpha = np
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98)
      ctx.stroke()
      ctx.fillStyle = UI.pink
      ctx.beginPath()
      ctx.arc(cx, cy, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // Título.
    const tp = seg(t, 2.0, 3.3)
    const titleSize = Math.max(34, Math.min(76, w * 0.075))
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = tp
    ctx.font = font(titleSize)
    setLetterSpacing(ctx, 1 + (1 - tp) * 10)
    ctx.fillText('Vida de Abelha', cx, cy + R * 1.32 + (1 - tp) * 8)
    setLetterSpacing(ctx, 0)
    const sp = seg(t, 2.8, 3.8)
    ctx.globalAlpha = sp * 0.75
    ctx.font = font(Math.max(13, titleSize * 0.26), { style: 'italic' })
    ctx.fillText('Mandaçaia · Melipona quadrifasciata', cx, cy + R * 1.32 + titleSize * 0.72)
    ctx.restore()

    // Dica discreta.
    ctx.save()
    ctx.globalAlpha = 0.4 * seg(t, 1.0, 2.0)
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.font = font(12, { style: 'italic' })
    ctx.fillText('clique para pular', w - 20, h - 16)
    ctx.restore()

    if (leaving >= 0) fadeScreen(ctx, w, h, ((t - leaving) / FADE_OUT) * 0.5, UI.paper)
  },

  exit() {},
}
