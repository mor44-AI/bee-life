// PromotionState - enter(context, { from, to }). Transição celebratória contida:
// o diagrama técnico da função antiga se apaga e um novo se redesenha, enquanto
// um ponteiro (acento rosa único) percorre a escala das 5 funções até a nova.
// Toque/clique em qualquer lugar ou tecla: primeiro adianta a animação; depois
// -> goTo('hub'). Botão grande "Continuar" na zona do polegar quando pronto.

import { ease } from '../engine/tween.js'
import { RANK_ORDER } from '../systems/TaskSystem.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { polygonPoints, strokeHandDrawn } from '../art/textureUtils.js'
import { UI, font, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  wrapText,
  rankName,
  drawButton,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  continueHint,
  drawHint,
} from '../ui/HUD.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const T_ERASE = 1.0
const T_DRAW = 2.4
const T_NEEDLE0 = 0.8
const T_NEEDLE1 = 2.6
const T_NAME = 2.5
const T_READY = 3.6

const ROLE_NOTES = {
  cleaning: 'Limpar e preparar as células de cria para a próxima geração.',
  feedLarvae: 'Nas Melipona, o alimento larval é depositado na célula antes da postura - e a célula é então selada.',
  feedQueen: 'Cuidar da rainha, a mãe de toda a colônia.',
  guard: 'Vigiar a entrada do ninho. Sem ferrão, a defesa é feita com mandíbulas, corpo e própolis.',
}

const backdrop = createPaperBackdrop({ seed: 73 })
let t = 0
let from = 'cleaning'
let to = 'feedLarvae'

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const seg = (time, a, b, type = 'easeInOutCubic') => ease(clamp01((time - a) / (b - a)), type)

function colorVariantFor(rank) {
  if (rank === 'guard') return 'old'
  if (rank === 'feedLarvae' || rank === 'feedQueen') return 'adult'
  return 'young'
}

// Diagrama característico de cada função (varia nº de anéis, lados e marcas).
function drawRoleDiagram(ctx, cx, cy, R, rank, progress, time) {
  if (progress <= 0) return
  const i = Math.max(0, RANK_ORDER.indexOf(rank))
  const sides = 6
  const rings = 1 + (i % 3)
  for (let k = 0; k < rings; k++) {
    drawDottedCircle(ctx, cx, cy, R * (0.62 + k * 0.13), {
      progress,
      alpha: 0.35 - k * 0.07,
      rotation: -Math.PI / 2 + k * 0.7,
    })
  }
  drawScaleArc(ctx, cx, cy, R * 0.98, -Math.PI / 2 + time * 0.03, Math.PI * 1.5 + time * 0.03, {
    progress,
    ticks: 12 * (i + 1),
    majorEvery: i + 1 + 2,
    tickLen: 3,
    majorLen: 8,
    alpha: 0.5,
  })
  const pts = polygonPoints(cx, cy, R * 0.44, R * 0.44, sides, { rotation: (i * Math.PI) / 12, jitter: 0.03, seed: 30 + i })
  const n = Math.max(2, Math.round(progress * (sides + 1)))
  const path = []
  for (let k = 0; k < n; k++) path.push(pts[k % sides])
  strokeHandDrawn(ctx, path, { baseWidth: 1.2, seed: 40 + i, opacity: 0.55 * progress })
  // Raios de construção.
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.18 * progress
  ctx.lineWidth = 0.8
  ctx.setLineDash([2, 4])
  ctx.beginPath()
  for (let k = 0; k < i + 2; k++) {
    const a = (k / (i + 2)) * Math.PI * 2 + i * 0.3
    ctx.moveTo(cx + Math.cos(a) * R * 0.46, cy + Math.sin(a) * R * 0.46)
    ctx.lineTo(cx + Math.cos(a) * R * (0.46 + 0.52 * progress), cy + Math.sin(a) * R * (0.46 + 0.52 * progress))
  }
  ctx.stroke()
  ctx.restore()
}

export default {
  enter(context, data = {}) {
    t = 0
    to = data.to ?? context.tasks?.currentRank ?? 'cleaning'
    from = data.from ?? RANK_ORDER[Math.max(0, RANK_ORDER.indexOf(to) - 1)]
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    const pressed = context.input.consumeClicks().length > 0 || anyKeyPressed(context.input, KEYS)
    if (!pressed || t < 0.2) return
    if (t < T_READY) t = T_READY
    else context.goTo('hub')
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    const L = screenLayout(context)
    const S = safeRect(L)
    const u = uiScaleOf(L)
    const portrait = S.h >= S.w

    const R = portrait ? Math.max(60, Math.min(S.w * 0.22, S.h * 0.14)) : Math.max(60, Math.min(S.w * 0.2, S.h * 0.2))
    const cx = S.x + S.w / 2
    const cy = S.y + Math.max(S.h * (portrait ? 0.37 : 0.4), R * 1.3 + 34 * u + 26 * u)
    const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))
    const btnW = Math.min(360, S.w - 40)
    const btn = { x: cx - btnW / 2, y: S.y + S.h - btnH - 40 * u, w: btnW, h: btnH }

    drawGuideLine(ctx, cx - R * 1.9, cy, cx + R * 1.9, cy, { alpha: 0.16 })
    drawGuideLine(ctx, cx, cy - R * 1.6, cx, cy + R * 1.2, { alpha: 0.12 })

    // Diagrama antigo se apaga, novo se desenha.
    drawRoleDiagram(ctx, cx, cy, R, from, 1 - seg(t, 0, T_ERASE), t)
    drawRoleDiagram(ctx, cx, cy, R, to, seg(t, T_ERASE * 0.8, T_DRAW), t)

    // Escala de progressão das 5 funções (semicírculo superior).
    const PR = R * 1.3
    const a0 = Math.PI * 1.08
    const a1 = Math.PI * 1.92
    const angleOf = (rank) => a0 + ((a1 - a0) * Math.max(0, RANK_ORDER.indexOf(rank))) / (RANK_ORDER.length - 1)
    drawScaleArc(ctx, cx, cy, PR, a0, a1, {
      ticks: (RANK_ORDER.length - 1) * 5,
      majorEvery: 5,
      tickLen: 3,
      majorLen: 9,
      inward: false,
      alpha: 0.6,
    })
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    RANK_ORDER.forEach((rank) => {
      const a = angleOf(rank)
      const isTo = rank === to
      ctx.globalAlpha = isTo ? 0.45 + 0.55 * seg(t, T_NEEDLE1 - 0.3, T_NEEDLE1 + 0.3) : 0.62
      ctx.fillStyle = UI.ink
      ctx.font = font((isTo ? 13 : 11.5) * u)
      setLetterSpacing(ctx, 1)
      const short = rank === 'feedQueen' ? 'ATENDENTE' : rankName(rank).toUpperCase()
      // Rótulos nunca saem da área segura (tela estreita).
      const half = ctx.measureText(short).width / 2
      const lx = Math.max(S.x + 8 + half, Math.min(S.x + S.w - 8 - half, cx + Math.cos(a) * (PR + 22) * 1.12))
      const ly = cy + Math.sin(a) * (PR + 18 * u)
      ctx.fillText(short, lx, ly)
      setLetterSpacing(ctx, 0)
    })
    ctx.restore()

    // Ponteiro rosa percorre da função antiga para a nova.
    const np = seg(t, T_NEEDLE0, T_NEEDLE1)
    const na = angleOf(from) + (angleOf(to) - angleOf(from)) * np
    ctx.save()
    ctx.strokeStyle = UI.pink
    ctx.fillStyle = UI.pink
    ctx.lineWidth = 1.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(na) * R * 0.5, cy + Math.sin(na) * R * 0.5)
    ctx.lineTo(cx + Math.cos(na) * (PR + 6), cy + Math.sin(na) * (PR + 6))
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx + Math.cos(na) * PR, cy + Math.sin(na) * PR, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Operária no centro (variante de idade da nova função).
    const scale = (R * 0.78) / 34
    drawBeeBody(ctx, createIdlePose(cx - scale * 1.5, cy + scale * 2, { t, colorVariant: colorVariantFor(to), scale, rotation: -0.2, seed: 9 }))

    // Textos.
    const baseY = cy + R * 1.18
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = 0.75 * seg(t, T_NAME - 0.5, T_NAME + 0.3)
    ctx.font = font(12.5 * u)
    setLetterSpacing(ctx, 3)
    ctx.fillText('NOVA FUNÇÃO', cx, baseY + 22 * u)
    setLetterSpacing(ctx, 0)
    const np2 = seg(t, T_NAME, T_NAME + 0.8)
    ctx.globalAlpha = np2
    let nameSize = Math.max(28, Math.min(52, S.w * (portrait ? 0.1 : 0.06)))
    ctx.font = font(nameSize)
    while (nameSize > 22 && ctx.measureText(rankName(to)).width > S.w - 32) {
      nameSize -= 1
      ctx.font = font(nameSize)
    }
    const nameY = baseY + 22 * u + nameSize * 1.1
    ctx.fillText(rankName(to), cx, nameY + (1 - np2) * 6)
    const note = ROLE_NOTES[to]
    if (note) {
      ctx.globalAlpha = 0.88 * seg(t, T_NAME + 0.5, T_NAME + 1.2)
      ctx.font = font(16 * u, { style: 'italic' })
      const lh = 22 * u
      const maxLines = Math.max(1, Math.floor((btn.y - 12 * u - (nameY + 30 * u)) / lh) + 1)
      wrapText(ctx, note, Math.min(520, S.w - 48))
        .slice(0, maxLines)
        .forEach((line, i) => ctx.fillText(line, cx, nameY + 30 * u + i * lh))
    }
    ctx.restore()

    const ready = seg(t, T_READY - 0.2, T_READY + 0.6)
    if (ready > 0) {
      ctx.save()
      ctx.globalAlpha = ready
      drawButton(ctx, btn, 'Continuar', { focused: true, time: t, accent: false })
      ctx.restore()
      drawHint(ctx, L, continueHint(context), ready)
    }
  },

  exit() {},
}
