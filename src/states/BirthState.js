// BirthState — nascimento (~7.5s): célula de cria sob uma "lente" de instrumento
// técnico, passando por ovo → larva → pupa (corte lateral) → abelha jovem
// emergindo. Pulável tocando/clicando em qualquer lugar ou por tecla. Termina com
// context.completeBirth(). Composição na área segura, vertical primeiro.

import { ease } from '../engine/tween.js'
import { drawCell } from '../art/hive.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { seededRandom } from '../art/textureUtils.js'
import { species } from '../data/species.js'
import { UI, font, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  createLayerCache,
  wrapText,
  fadeScreen,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
  drawHint,
} from '../ui/HUD.js'

const SKIP_KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const T_LARVA = 2.3
const T_PUPA = 3.9
const T_EMERGE = 5.3
const T_TITLE = 6.3
const T_END = 7.8
const XFADE = 0.45

const STAGES = [
  { label: 'ovo', at: 0 },
  { label: 'larva', at: T_LARVA },
  { label: 'pupa', at: T_PUPA },
  { label: 'operária', at: T_EMERGE },
]

const backdrop = createPaperBackdrop({ seed: 58 })
const cellCaches = {}
for (const state of ['egg', 'larva', 'capped', 'empty']) {
  cellCaches[state] = createLayerCache((c, w, h) => {
    drawCell(c, { x: w / 2, y: h / 2, size: w / 2.6, rotation: 0.12, seed: 17 }, state)
  })
}
const beeScaleFor = (S) => (S * 2.1) / 33
// Pupa: silhueta da abelha jovem "desbotada" (pupas são claras e vão escurecendo).
const pupaCache = createLayerCache((c, w, h) => {
  const scale = w / 40
  drawBeeBody(c, createIdlePose(w / 2, h / 2, { t: 0, colorVariant: 'young', scale, rotation: -Math.PI / 2, seed: 4 }))
  c.globalCompositeOperation = 'source-atop'
  c.fillStyle = '#F4EEDD'
  c.globalAlpha = 0.72
  c.fillRect(0, 0, w, h)
})

let t = 0
let done = false
let factText = ''

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const seg = (time, a, b, type = 'easeInOutCubic') => ease(clamp01((time - a) / (b - a)), type)

function finish(context) {
  if (done) return
  done = true
  context.completeBirth()
}

export default {
  enter(context) {
    t = 0
    done = false
    context.input.consumeClicks()
    const first = species.laborDivision?.[0]
    factText = first ? first.description.split(':')[0].replace(/\s+$/, '') + '.' : ''
  },

  update(context, dt) {
    t += dt
    const skip = context.input.consumeClicks().length > 0 || anyKeyPressed(context.input, SKIP_KEYS)
    if (skip || t >= T_END) finish(context)
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    const L = screenLayout(context)
    const SA = safeRect(L)
    const u = uiScaleOf(L)

    const S = Math.max(34, Math.min(SA.w * 0.13, SA.h * 0.12))
    const cx = SA.x + SA.w / 2
    const cy = SA.y + SA.h * 0.4
    const lensR = S * 2.05

    // Lente / instrumento em torno da célula.
    drawGuideLine(ctx, cx - lensR * 1.6, cy, cx + lensR * 1.6, cy, { progress: seg(t, 0, 1), alpha: 0.18 })
    drawDottedCircle(ctx, cx, cy, lensR * 1.12, { progress: seg(t, 0, 1.1), alpha: 0.3 })
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    ctx.arc(cx, cy, lensR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * seg(t, 0.1, 1.2))
    ctx.stroke()
    ctx.restore()
    drawScaleArc(ctx, cx, cy, lensR * 0.95, Math.PI * 0.62 + t * 0.03, Math.PI * 0.38 + t * 0.03, {
      progress: seg(t, 0.3, 1.5),
      ticks: 40,
      majorEvery: 10,
      tickLen: 3,
      majorLen: 7,
      alpha: 0.4,
    })

    // Célula com crossfade entre estágios.
    const D = S * 2.6
    const drawCellState = (state, alpha) => {
      if (alpha <= 0) return
      ctx.save()
      ctx.globalAlpha = alpha
      cellCaches[state].draw(ctx, cx - D / 2, cy - D / 2, D, D)
      ctx.restore()
    }
    const appear = seg(t, 0.1, 0.8)
    const aLarva = seg(t, T_LARVA, T_LARVA + XFADE)
    const aCapped = seg(t, T_PUPA, T_PUPA + XFADE)
    const aEmpty = seg(t, T_EMERGE, T_EMERGE + XFADE)
    drawCellState('egg', appear * (1 - aLarva))
    drawCellState('larva', aLarva * (1 - aCapped))
    drawCellState('capped', aCapped * (1 - aEmpty))
    drawCellState('empty', aEmpty)

    // Corte lateral mostrando a pupa dentro da célula selada.
    const pupaIn = seg(t, T_PUPA + 0.2, T_PUPA + 0.8) * (1 - seg(t, T_EMERGE - 0.1, T_EMERGE + 0.3))
    const beeScale = beeScaleFor(S)
    const pupaSize = beeScale * 40
    if (pupaIn > 0) {
      const wide = SA.w > SA.h * 1.05
      const px = wide ? cx + lensR * 1.75 : cx + lensR * 0.62
      const py = wide ? cy : cy - lensR * 1.05
      const pr = pupaSize * (wide ? 0.62 : 0.42)
      ctx.save()
      ctx.globalAlpha = pupaIn
      drawGuideLine(ctx, cx + S * 0.6, cy - (wide ? 0 : S * 0.6), px - (wide ? pr : 0), py + (wide ? 0 : pr), {
        alpha: 0.45,
        dash: [2, 3],
      })
      ctx.fillStyle = 'rgba(239, 232, 214, 0.9)'
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.fill()
      drawDottedCircle(ctx, px, py, pr, { alpha: 0.6, dash: [1.4, 3] })
      ctx.beginPath()
      ctx.arc(px, py, pr, 0, Math.PI * 2)
      ctx.clip()
      const ps = pr * 1.6
      ctx.drawImage(pupaCache.get(pupaSize, pupaSize), px - ps / 2, py - ps / 2, ps, ps)
      ctx.restore()
      ctx.save()
      ctx.globalAlpha = pupaIn * 0.6
      ctx.fillStyle = UI.ink
      ctx.font = font(12 * u)
      ctx.textAlign = 'center'
      setLetterSpacing(ctx, 1.5)
      ctx.fillText('CORTE', px, py + pr + 14)
      setLetterSpacing(ctx, 0)
      ctx.restore()
    }

    // Emergência: fragmentos do opérculo + abelha jovem subindo.
    const e = seg(t, T_EMERGE, T_EMERGE + 1.5, 'easeOutCubic')
    if (t >= T_EMERGE) {
      const rng = seededRandom(21)
      ctx.save()
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (rng() - 0.5) * 2.4
        const dist = S * (0.3 + e * (0.9 + rng() * 0.6))
        const fx = cx + Math.cos(a) * dist
        const fy = cy + Math.sin(a) * dist + e * e * S * 0.6
        ctx.globalAlpha = (1 - e) * 0.85
        ctx.fillStyle = i % 2 ? '#8F6E20' : '#6E5219'
        ctx.beginPath()
        ctx.ellipse(fx, fy, 2 + rng() * 2.5, 1.2 + rng() * 1.4, rng() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      const bx = cx
      const by = cy - e * S * 1.15
      const live = t > T_EMERGE + 1.5
      const pose = createIdlePose(bx, by, {
        t: live ? t - (T_EMERGE + 1.5) : 0,
        colorVariant: 'young',
        scale: beeScale * (0.9 + e * 0.1),
        rotation: -Math.PI / 2 + Math.sin(t * 1.3) * 0.03 * e,
        seed: 4,
      })
      if (!live) pose.wingAngle = 0.05 + Math.sin(t * 22) * 0.12 * e
      ctx.save()
      ctx.globalAlpha = seg(t, T_EMERGE, T_EMERGE + 0.4)
      drawBeeBody(ctx, pose)
      ctx.restore()
      const tint = 1 - seg(t, T_EMERGE + 0.2, T_EMERGE + 2.2)
      if (tint > 0) {
        ctx.save()
        ctx.globalAlpha = tint * 0.85
        const sz = pupaSize * (0.9 + e * 0.1)
        ctx.drawImage(pupaCache.get(pupaSize, pupaSize), bx - sz / 2, by - sz / 2, sz, sz)
        ctx.restore()
      }
    }

    // Legenda dos estágios (escala horizontal com marcador rosa — acento único).
    const legendW = Math.min(420 * u, SA.w - 100)
    const lx0 = cx - legendW / 2
    const ly = cy + lensR * 1.12 + 44
    const lp = seg(t, 0.4, 1.4)
    ctx.save()
    ctx.globalAlpha = lp
    ctx.strokeStyle = UI.ink
    ctx.lineWidth = 0.9
    ctx.globalAlpha = lp * 0.6
    ctx.beginPath()
    ctx.moveTo(lx0, ly)
    ctx.lineTo(lx0 + legendW * lp, ly)
    ctx.stroke()
    let stageIndex = 0
    STAGES.forEach((s, i) => {
      if (t >= s.at) stageIndex = i
    })
    STAGES.forEach((s, i) => {
      const sx = lx0 + (legendW * i) / (STAGES.length - 1)
      const current = i === stageIndex
      ctx.globalAlpha = lp * (current ? 1 : i < stageIndex ? 0.55 : 0.35)
      ctx.beginPath()
      ctx.moveTo(sx, ly - (current ? 7 : 4))
      ctx.lineTo(sx, ly + (current ? 7 : 4))
      ctx.stroke()
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'center'
      ctx.font = font((current ? 16 : 14) * u, { style: current ? '' : 'italic' })
      ctx.fillText(s.label, sx, ly + 28 * u)
    })
    // marcador desliza entre estágios
    const stagePos = (() => {
      for (let i = STAGES.length - 1; i >= 0; i--) {
        if (t >= STAGES[i].at) {
          const k = i + seg(t, STAGES[i].at, STAGES[i].at + 0.6) - 1
          return Math.max(0, i === 0 ? 0 : k)
        }
      }
      return 0
    })()
    const mx = lx0 + (legendW * stagePos) / (STAGES.length - 1)
    ctx.globalAlpha = lp
    ctx.fillStyle = UI.pink
    ctx.beginPath()
    ctx.moveTo(mx, ly - 9)
    ctx.lineTo(mx - 4.5, ly - 16)
    ctx.lineTo(mx + 4.5, ly - 16)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Título + fato real.
    const tp = seg(t, T_TITLE, T_TITLE + 0.9)
    ctx.save()
    ctx.textAlign = 'center'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = tp
    ctx.font = font(Math.max(26, Math.min(42, SA.w * 0.08)))
    ctx.fillText('Uma nova operária', cx, Math.max(SA.y + 46, cy - lensR * 1.12 - 26))
    const fp = seg(t, T_EMERGE - 0.2, T_EMERGE + 0.8)
    if (factText && fp > 0) {
      ctx.globalAlpha = fp * 0.85
      ctx.font = font(15.5 * u, { style: 'italic' })
      const lines = wrapText(ctx, factText, Math.min(520, SA.w - 48))
      const fy = ly + 70 * u
      lines.forEach((line, i) => ctx.fillText(line, cx, fy + i * 22 * u))
    }
    ctx.restore()
    drawHint(ctx, L, isTouchUI(context) ? 'toque para pular' : 'clique ou Enter para pular', seg(t, 1, 2))

    fadeScreen(ctx, w, h, (1 - seg(t, 0, 0.5)) * 0.6, UI.paper)
  },

  exit() {},
}
