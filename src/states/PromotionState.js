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
  drawButton,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
  drawHint,
} from '../ui/HUD.js'
import { t as tr } from '../i18n/index.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const T_ERASE = 1.0
const T_DRAW = 2.4
const T_NEEDLE0 = 0.8
const T_NEEDLE1 = 2.6
const T_NAME = 2.5
const T_READY = 3.6

const roleName = (rank) => tr(`rank.${rank}`)
const roleNote = (rank) => (['cleaning', 'feedLarvae', 'feedQueen', 'guard'].includes(rank) ? tr(`promotion.note.${rank}`) : '')

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


// Corta as linhas em `max`, terminando a última com "…" (sem estourar a largura).
function clampLines(ctx, lines, max, maxW) {
  if (lines.length <= max) return lines
  const out = lines.slice(0, max)
  let last = out[max - 1].replace(/[\s,.;:-]*$/, '') + '…'
  while (ctx.measureText(last).width > maxW && last.includes(' ')) {
    last = last.replace(/\s*\S+…$/, '').replace(/[\s,.;:-]*$/, '') + '…'
  }
  out[max - 1] = last
  return out
}

// Mede o bloco de texto (rótulo, nome, nota) centrado em x a partir de `top`.
// maxBottom: se dado, a nota encolhe (até 13px) e termina com "…" para caber.
function measureText(ctx, u, x, top, maxW, nameSizeMax, maxBottom) {
  ctx.save()
  let nameSize = nameSizeMax
  ctx.font = font(nameSize)
  while (nameSize > 22 && ctx.measureText(roleName(to)).width > maxW) {
    nameSize -= 1
    ctx.font = font(nameSize)
  }
  const labelY = top + 12.5 * u
  const nameY = labelY + nameSize * 1.1
  const note = roleNote(to)
  let noteSize = 16 * u
  let noteLines = []
  const noteYFor = (size) => nameY + 14 * u + size
  if (note) {
    const noteW = Math.min(520, maxW - 16)
    for (;;) {
      ctx.font = font(noteSize, { style: 'italic' })
      noteLines = wrapText(ctx, note, noteW)
      const fits = maxBottom == null || noteYFor(noteSize) + (noteLines.length - 1) * noteSize * 1.375 + 5 * u <= maxBottom
      if (fits || noteSize <= 13) break
      noteSize -= 0.5
    }
    if (maxBottom != null) {
      const max = Math.max(1, Math.floor((maxBottom - 5 * u - noteYFor(noteSize)) / (noteSize * 1.375)) + 1)
      noteLines = clampLines(ctx, noteLines, max, noteW)
    }
  }
  ctx.restore()
  const noteLH = noteSize * 1.375
  const noteY = noteYFor(noteSize)
  const bottom = (noteLines.length ? noteY + (noteLines.length - 1) * noteLH : nameY) + 6 * u
  return { x, labelY, nameY, nameSize, noteY, noteSize, noteLH, noteLines, bottom }
}

function computeLayout(context, ctx) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const portrait = S.h >= S.w
  const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))

  // Empilhado (vertical primeiro): diagrama, texto e botão na zona do polegar.
  {
    const R = portrait ? Math.max(60, Math.min(S.w * 0.22, S.h * 0.14)) : Math.max(60, Math.min(S.w * 0.2, S.h * 0.2))
    const cx = S.x + S.w / 2
    const cy = S.y + Math.max(S.h * (portrait ? 0.37 : 0.4), R * 1.3 + 34 * u + 26 * u)
    const btnW = Math.min(360, S.w - 40)
    const btn = { x: cx - btnW / 2, y: S.y + S.h - btnH - 40 * u, w: btnW, h: btnH }
    const top = cy + R * 1.18 + 9.5 * u
    const nameSize = Math.max(28, Math.min(52, S.w * (portrait ? 0.1 : 0.06)))
    const base = { L, S, u, R, cx, cy, btn, side: false, diagX: S.x, diagW: S.w }
    if (portrait) return { ...base, text: measureText(ctx, u, cx, top, S.w - 32, nameSize, btn.y - 8 * u) }
    const probe = measureText(ctx, u, cx, top, S.w - 32, nameSize, null)
    if (probe.bottom <= btn.y - 8 * u) return { ...base, text: probe }
  }

  // Tela deitada e baixa: diagrama à esquerda; nome, nota, botão e dica à direita.
  const diagW = S.w * 0.48
  const R = Math.max(40, Math.min(diagW * 0.19, (S.h - 16 - 25 * u) / 2.3, 150))
  const cx = S.x + diagW / 2
  const cy = S.y + (S.h - (2.3 * R + 25 * u)) / 2 + 1.3 * R + 25 * u
  const colX = S.x + diagW + 8
  const colW = S.x + S.w - 16 - colX
  const colCx = colX + colW / 2
  const hintSize = 13.5 * u
  const btnW = Math.min(360, colW)
  const tail = 14 * u + btnH + 8 * u + hintSize
  const maxBottom = S.y + S.h - 10 * u - tail
  const nameSize = Math.max(26, Math.min(48, colW * 0.12))
  let text = measureText(ctx, u, colCx, S.y + 8 * u, colW, nameSize, maxBottom)
  const offset = Math.max(0, (maxBottom - text.bottom) / 2)
  if (offset > 0) text = measureText(ctx, u, colCx, S.y + 8 * u + offset, colW, nameSize, maxBottom)
  const btn = { x: colCx - btnW / 2, y: text.bottom + 14 * u, w: btnW, h: btnH }
  const hintY = btn.y + btnH + 8 * u + hintSize
  return { L, S, u, R, cx, cy, btn, text, side: true, hintSize, hintY, diagX: S.x, diagW }
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
    const M = computeLayout(context, ctx)
    const { L, u, R, cx, cy, btn } = M

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
      let labelSize = (isTo ? 13 : 11.5) * u
      ctx.font = font(labelSize)
      setLetterSpacing(ctx, 1)
      const short = rank === 'feedQueen' ? tr('promotion.shortFeedQueen') : roleName(rank).toUpperCase()
      // Rótulos longos (inglês) encolhem para não invadir o vizinho na tela estreita.
      const maxLabelW = Math.max(60, M.diagW / 3.2)
      while (labelSize > 8.5 && ctx.measureText(short).width > maxLabelW) {
        labelSize -= 0.5
        ctx.font = font(labelSize)
      }
      // Rótulos nunca saem da área do diagrama (área segura / coluna esquerda).
      const half = ctx.measureText(short).width / 2
      const lx = Math.max(M.diagX + 8 + half, Math.min(M.diagX + M.diagW - 8 - half, cx + Math.cos(a) * (PR + 22) * 1.12))
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
    const T = M.text
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = UI.ink
    ctx.globalAlpha = 0.75 * seg(t, T_NAME - 0.5, T_NAME + 0.3)
    ctx.font = font(12.5 * u)
    setLetterSpacing(ctx, 3)
    ctx.fillText(tr('promotion.newRole'), T.x, T.labelY)
    setLetterSpacing(ctx, 0)
    const np2 = seg(t, T_NAME, T_NAME + 0.8)
    ctx.globalAlpha = np2
    ctx.font = font(T.nameSize)
    ctx.fillText(roleName(to), T.x, T.nameY + (1 - np2) * 6)
    if (T.noteLines.length) {
      ctx.globalAlpha = 0.88 * seg(t, T_NAME + 0.5, T_NAME + 1.2)
      ctx.font = font(T.noteSize, { style: 'italic' })
      T.noteLines.forEach((line, i) => ctx.fillText(line, T.x, T.noteY + i * T.noteLH))
    }
    ctx.restore()

    const ready = seg(t, T_READY - 0.2, T_READY + 0.6)
    if (ready > 0) {
      ctx.save()
      ctx.globalAlpha = ready
      drawButton(ctx, btn, tr('promotion.continue'), { focused: true, time: t, accent: false })
      ctx.restore()
      const hint = tr(isTouchUI(context) ? 'app.tapToContinue' : 'app.clickToContinue')
      if (M.side) {
        // Dica sob o botão, na coluna direita (a dica central cairia entre as colunas).
        ctx.save()
        ctx.globalAlpha = 0.7 * ready
        ctx.fillStyle = UI.ink
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.font = font(M.hintSize, { style: 'italic' })
        ctx.fillText(hint, btn.x + btn.w / 2, M.hintY)
        ctx.restore()
      } else {
        drawHint(ctx, L, hint, ready)
      }
    }
  },

  exit() {},
}
