// ScorePopups - desenho dos "+N" flutuantes e do selo de combo (usado por
// ScoreSystem.render; as tarefas não chamam isto diretamente).
//
// Estilo (styleGuide): tinta marrom quente + dourado; o selo é um pequeno
// mostrador técnico (anel com marcas de escala que se esvazia até o combo
// expirar). accentPink só no multiplicador ativo (> ×1).
//
// API:
//   createScorePopups() -> {
//     spawn({ points, x, y, reason, mult, combo, multUp })  novo "+N" (x/y opcionais)
//     comboLost(combo)   feedback curto de quebra ("combo perdido")
//     comboExpired()     o selo some suavemente
//     clear()            descarta tudo (início/fim de turno)
//     update(dt)
//     render(ctx, layout, { combo, multiplier, timerFrac })
//     items              popups vivos (inspeção/testes)
//   }
//   formatMultiplier(m) -> '1,5' (pt) / '1.5' (en)

import { UI, font, drawScaleArc, setLetterSpacing } from './IndicatorBar.js'
import { t, getLang } from '../i18n/index.js'

const LIFE = 1.15
const MAX_POPUPS = 24
const LOST_TIME = 0.9
const PULSE_TIME = 0.4

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeOutCubic = (x) => 1 - (1 - x) ** 3
const easeOutBack = (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2

export function formatMultiplier(m) {
  const s = Number.isInteger(m) ? String(m) : m.toFixed(1)
  return getLang() === 'pt' ? s.replace('.', ',') : s
}

function playfieldOf(ctx, layout) {
  if (layout?.playfield) return layout.playfield
  const c = ctx.canvas
  return { x: 0, y: 0, w: c?.clientWidth || c?.width || 400, h: c?.clientHeight || c?.height || 700 }
}

export function createScorePopups() {
  let items = []
  let seal = { alpha: 0, pulse: 0, shown: 0 }
  let lost = null
  let defaultSlot = 0

  function drawOutlined(ctx, text, x, y, fill, u, weight = 3) {
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(239,232,214,0.85)'
    ctx.lineWidth = (weight + 3) * u
    ctx.strokeText(text, x, y)
    ctx.strokeStyle = UI.ink
    ctx.lineWidth = weight * u * 0.8
    ctx.strokeText(text, x, y)
    ctx.fillStyle = fill
    ctx.fillText(text, x, y)
  }

  function drawSeal(ctx, pf, u, state) {
    const { combo, multiplier, timerFrac } = state
    const a = seal.alpha
    if (a <= 0.01 && !lost) return
    const cx = pf.x + pf.w / 2
    const cy = pf.y + 30 * u
    const pulse = seal.pulse > 0 ? Math.sin((1 - seal.pulse / PULSE_TIME) * Math.PI) : 0
    const appear = easeOutBack(clamp01(seal.shown / 0.25))
    const scale = (0.6 + 0.4 * appear) * (1 + 0.28 * pulse)
    const w = 150 * u
    const h = 40 * u

    if (a > 0.01) {
      ctx.save()
      ctx.globalAlpha = a
      ctx.translate(cx, cy)
      ctx.scale(scale, scale)
      // Placa de papel com borda de tinta.
      ctx.fillStyle = 'rgba(239,232,214,0.92)'
      ctx.strokeStyle = UI.ink
      ctx.lineWidth = 1.3
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, h / 2)
      else ctx.rect(-w / 2, -h / 2, w, h)
      ctx.fill()
      ctx.stroke()
      // Mostrador: anel de escala que se esvazia até o combo expirar.
      const dx = -w / 2 + h / 2
      const r = h * 0.36
      drawScaleArc(ctx, dx, 0, r, -Math.PI / 2, Math.PI * 1.5, { progress: 1, ticks: 20, majorEvery: 5, tickLen: 2 * u, majorLen: 3.5 * u, alpha: 0.25, lineWidth: 1 })
      if (timerFrac > 0) {
        ctx.strokeStyle = UI.gold
        ctx.lineWidth = 2.6 * u
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(dx, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(timerFrac))
        ctx.stroke()
      }
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = font(13 * u, { weight: '700' })
      ctx.fillText(String(combo), dx, 1)
      // Rótulo e multiplicador.
      const tx = dx + r + 10 * u
      ctx.textAlign = 'left'
      setLetterSpacing(ctx, 1.5 * u)
      ctx.font = font(11 * u, { weight: '600' })
      ctx.fillStyle = UI.ink
      ctx.fillText(t('score.combo'), tx, 0.5)
      const labelW = ctx.measureText(t('score.combo')).width
      setLetterSpacing(ctx, 0)
      const active = multiplier > 1
      ctx.font = font((active ? 19 : 15) * u, { weight: '700' })
      ctx.fillStyle = active ? UI.pink : 'rgba(43,36,24,0.45)'
      ctx.fillText(t('score.mult', { m: formatMultiplier(multiplier) }), tx + labelW + 6 * u, 1)
      if (pulse > 0) {
        ctx.globalAlpha = a * pulse * 0.6
        ctx.strokeStyle = UI.pink
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(dx, 0, r + 6 * u * pulse, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    if (lost) {
      const p = lost.t / LOST_TIME
      const shake = Math.sin(lost.t * 60) * 4 * u * (1 - p)
      ctx.save()
      ctx.globalAlpha = 1 - p
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = font(14 * u, { weight: '600', style: 'italic' })
      const text = t('score.comboLost')
      const y = cy + p * 10 * u
      drawOutlined(ctx, text, cx + shake, y, UI.critical, u, 0.01)
      const tw = ctx.measureText(text).width
      ctx.strokeStyle = UI.critical
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cx + shake - tw / 2 - 4, y + 1)
      ctx.lineTo(cx + shake + tw / 2 + 4, y - 1)
      ctx.stroke()
      ctx.restore()
    }
  }

  return {
    get items() { return items },
    spawn({ points, x, y, reason, mult = 1, combo = 0, multUp = false }) {
      const hasPos = Number.isFinite(x) && Number.isFinite(y)
      items.push({ points, x, y, hasPos, slot: hasPos ? 0 : defaultSlot++ % 3, reason, mult, age: 0 })
      if (items.length > MAX_POPUPS) items.splice(0, items.length - MAX_POPUPS)
      if (combo >= 2 && seal.alpha <= 0.01) seal.shown = 0
      if (multUp) seal.pulse = PULSE_TIME
      // O selo volta a aparecer no lugar do aviso de quebra.
      if (combo >= 2) lost = null
    },
    comboLost(combo) {
      lost = { t: 0, combo }
    },
    comboExpired() {},
    clear() {
      items = []
      lost = null
      seal = { alpha: 0, pulse: 0, shown: 0 }
    },
    update(dt) {
      for (const p of items) p.age += dt
      items = items.filter((p) => p.age < LIFE)
      seal.pulse = Math.max(0, seal.pulse - dt)
      seal.shown += dt
      if (lost) {
        lost.t += dt
        if (lost.t >= LOST_TIME) lost = null
      }
      seal._dt = dt
    },
    render(ctx, layout, state = { combo: 0, multiplier: 1, timerFrac: 0 }) {
      const pf = playfieldOf(ctx, layout)
      const u = layout?.uiScale ?? 1
      // O selo acompanha o combo com um fade curto (aparece a partir de 2 acertos).
      const target = state.combo >= 2 ? 1 : 0
      const k = Math.min(1, (seal._dt ?? 0.016) * 10)
      seal.alpha += (target - seal.alpha) * (target > seal.alpha ? 1 : k)
      if (lost && state.combo < 2) seal.alpha = 0
      ctx.save()
      for (const p of items) {
        const x = p.hasPos ? p.x : pf.x + pf.w / 2 + (p.slot - 1) * 64 * u
        const y0 = p.hasPos ? p.y : pf.y + pf.h * 0.32 + (p.slot % 2) * 22 * u
        const q = p.age / LIFE
        const pop = p.age < 0.12 ? 0.5 + (p.age / 0.12) * 0.75 : p.age < 0.26 ? 1.25 - ((p.age - 0.12) / 0.14) * 0.25 : 1
        const y = y0 - 48 * u * easeOutCubic(clamp01(q))
        const alpha = q < 0.55 ? 1 : 1 - (q - 0.55) / 0.45
        const size = (19 + 4 * Math.log2(Math.max(1, p.mult)) * 1.4) * u
        ctx.save()
        ctx.globalAlpha = clamp01(alpha)
        ctx.translate(x, y)
        ctx.scale(pop, pop)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = font(size, { weight: '700' })
        drawOutlined(ctx, `+${p.points}`, 0, 0, p.mult >= 2 ? UI.sunGold : UI.gold, u)
        if (p.reason) {
          ctx.font = font(11 * u, { style: 'italic', weight: '600' })
          drawOutlined(ctx, t(p.reason), 0, size * 0.78, UI.ink, u, 0.01)
        }
        ctx.restore()
      }
      drawSeal(ctx, pf, u, state)
      ctx.restore()
    },
  }
}

export default createScorePopups
