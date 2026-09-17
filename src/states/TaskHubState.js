// TaskHubState - "casa" entre turnos: interior da colmeia (pré-renderizado),
// a operária do jogador em idle, HUD da colônia (com progresso até a próxima
// função), dia/noite visual conforme context.time.isNight, fato real rotativo de
// species.js e o botão grande "Iniciar turno" na zona do polegar (toque/clique ou
// Enter/Espaço) -> context.startShift(). Sem tutorial textual das tarefas.
// Layout: vertical primeiro (HUD no topo, botão embaixo); em tela larga o fato vai
// para a esquerda e o botão para a direita, ambos na base.

import { drawHiveInterior } from '../art/hive.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawLightOverlay } from '../art/environment.js'
import { species } from '../data/species.js'
import { config } from '../data/config.js'
import { UI, font, drawDottedCircle, drawScaleArc, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  drawHUD,
  getHUDHeight,
  createLayerCache,
  drawPaperCard,
  drawButton,
  pointInRect,
  wrapText,
  fadeScreen,
  rankName,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
} from '../ui/HUD.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space']
const FACT_PERIOD = 14
const NIGHT_TINT = '#2E3B52'

const CELL_STATES = ['capped', 'capped', 'larva', 'egg', 'honey', 'pollen', 'empty', 'capped', 'larva']

function combLayout(w, h, top) {
  const cellSize = Math.max(11, Math.min(24, Math.min(w, h) / 30))
  const horiz = cellSize * 1.5
  const vert = Math.sqrt(3) * cellSize
  const areaH = h - top
  const cols = Math.ceil(w / horiz) + 2
  const rows = Math.ceil(areaH / vert) + 2
  return {
    cellSize,
    combs: [
      {
        x: -cellSize,
        y: top - vert * 0.5,
        cols,
        rows,
        cellSize,
        seed: 404,
        rotation: 0,
        getState: (c, r) => {
          const n = (c * 7 + r * 13 + ((c * r) % 5)) % 23
          return n < CELL_STATES.length ? CELL_STATES[n] : 'capped'
        },
      },
    ],
  }
}

// Camada estática da colmeia: favo + vinheta + luz/noite. Chave = 'day'|'night'.
const hiveLayer = createLayerCache((c, w, h, key) => {
  const { combs } = combLayout(w, h, 0)
  drawHiveInterior(c, { width: w, height: h, backgroundSeed: 12, combs, queenChamber: null })
  const g = c.createRadialGradient(w * 0.5, h * 0.55, Math.min(w, h) * 0.18, w * 0.5, h * 0.55, Math.hypot(w, h) * 0.6)
  g.addColorStop(0, 'rgba(26, 18, 8, 0)')
  g.addColorStop(1, 'rgba(26, 18, 8, 0.72)')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  c.fillStyle = 'rgba(36, 26, 16, 0.22)'
  c.fillRect(0, 0, w, h)
  if (key === 'night') {
    c.globalAlpha = 0.34
    c.fillStyle = NIGHT_TINT
    c.fillRect(0, 0, w, h)
    c.globalAlpha = 1
  } else {
    drawLightOverlay(c, 0.55, { width: w, height: h, cx: w * 0.5, cy: h * 0.5, radius: Math.max(w, h) * 0.55 })
  }
})

let t = 0
let factIndex = 0
let hover = false

function computeLayout(context) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const hudW = Math.min(1100, S.w - 24)
  const hudH = getHUDHeight(hudW, L.uiScale)
  const hudBottom = S.y + 10 + hudH
  const wide = S.w >= 720 && S.w > S.h
  const btnH = Math.max(L.minTouch ?? 56, Math.round(66 * u))
  const margin = 16 * u
  let btn, fact
  if (wide) {
    const btnW = Math.min(300 * u, S.w * 0.32)
    btn = { x: S.x + S.w - btnW - 24 * u, y: S.y + S.h - btnH - 24 * u, w: btnW, h: btnH }
    const factW = Math.min(500 * u, btn.x - S.x - 48 * u)
    const factH = Math.min(140 * u, Math.max(96, S.h * 0.28))
    fact = { x: S.x + 20 * u, y: S.y + S.h - factH - 20 * u, w: factW, h: factH }
  } else {
    const btnW = Math.min(380, S.w - 32)
    btn = { x: S.x + (S.w - btnW) / 2, y: S.y + S.h - btnH - margin, w: btnW, h: btnH }
    const factW = Math.min(520, S.w - 24)
    const factH = Math.round(Math.min(150 * u, Math.max(104, (btn.y - hudBottom) * 0.36)))
    fact = { x: S.x + (S.w - factW) / 2, y: btn.y - factH - 12 * u, w: factW, h: factH }
  }
  const stageTop = hudBottom
  const stageBottom = wide ? Math.min(fact.y, btn.y) : fact.y
  const beeX = S.x + S.w / 2
  const beeY = stageTop + (stageBottom - stageTop) * 0.5
  const cellSize = Math.max(11, Math.min(24, Math.min(L.width, L.height) / 30))
  const beeR = Math.max(34, Math.min((stageBottom - stageTop) * 0.36, cellSize * 6.5 * u))
  return { L, S, u, btn, fact, beeX, beeY, beeR, showBee: stageBottom - stageTop > 70 }
}

function colorVariantFor(rank) {
  if (rank === 'guard') return 'old'
  if (rank === 'feedLarvae' || rank === 'feedQueen') return 'adult'
  return 'young'
}

function start(context) {
  if (context.tasks?.currentRank === 'larva') {
    context.goTo('birth')
    return
  }
  context.startShift()
}

// Área de toque um pouco maior que o desenho do botão (dedo impreciso).
function hitRect(r, grow) {
  return { x: r.x - grow, y: r.y - grow, w: r.w + grow * 2, h: r.h + grow * 2 }
}

export default {
  enter(context) {
    t = 0
    hover = false
    context.input.consumeClicks()
    const facts = species.funFacts || []
    factIndex = facts.length ? ((context.time?.currentDay ?? 1) * 3 + (context.time?.isNight ? 1 : 0)) % facts.length : 0
  },

  update(context, dt) {
    t += dt
    if (context.time?.isLifeOver?.()) {
      context.goTo('end', { reason: 'lifeOver' })
      return
    }
    const H = computeLayout(context)
    const hit = hitRect(H.btn, 10)
    hover = !isTouchUI(context) && pointInRect(context.input.getPointer(), hit)
    const clicks = context.input.consumeClicks()
    if (t < 0.25) return // ignora toque "vazado" da tela anterior
    if (clicks.some((c) => pointInRect(c, hit)) || anyKeyPressed(context.input, KEYS)) start(context)
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    const night = !!context.time?.isNight
    const H = computeLayout(context)
    const { u } = H
    hiveLayer.draw(ctx, 0, 0, w, h, night ? 'night' : 'day')

    const rank = context.tasks?.currentRank

    // Operária do jogador em idle, marcada como espécime (círculos técnicos).
    if (H.showBee) {
      const { beeX, beeY, beeR } = H
      ctx.save()
      const glow = ctx.createRadialGradient(beeX, beeY, beeR * 0.1, beeX, beeY, beeR * 1.3)
      glow.addColorStop(0, night ? 'rgba(216, 210, 190, 0.16)' : 'rgba(247, 223, 160, 0.26)')
      glow.addColorStop(1, 'rgba(247, 223, 160, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(beeX - beeR * 1.4, beeY - beeR * 1.4, beeR * 2.8, beeR * 2.8)
      ctx.restore()
      drawDottedCircle(ctx, beeX, beeY, beeR * 1.05, { color: UI.paper, alpha: 0.7, lineWidth: 1.2, rotation: t * 0.05 })
      drawScaleArc(ctx, beeX, beeY, beeR * 0.92, Math.PI * 0.2 - t * 0.02, Math.PI * 0.8 - t * 0.02, {
        ticks: 24,
        majorEvery: 6,
        tickLen: 3,
        majorLen: 7,
        color: UI.paper,
        alpha: 0.75,
        lineWidth: 1.1,
      })
      const scale = (beeR * 1.15) / 34
      const sway = Math.sin(t * 0.35) * 0.05
      drawBeeBody(
        ctx,
        createIdlePose(beeX, beeY + scale * 3, {
          t,
          colorVariant: colorVariantFor(rank),
          scale,
          rotation: -0.12 + sway,
          seed: 7,
        })
      )
    }

    drawHUD(ctx, context, { night })

    // Fato real rotativo - cartão claro, tinta cheia (contraste alto sobre o papel).
    const facts = species.funFacts || []
    if (facts.length) {
      const idx = (factIndex + Math.floor(t / FACT_PERIOD)) % facts.length
      const phase = (t % FACT_PERIOD) / FACT_PERIOD
      const alpha = 0.8 + 0.2 * Math.min(1, Math.min(phase, 1 - phase) * 14)
      const f = H.fact
      drawPaperCard(ctx, f.x, f.y, f.w, f.h, { seed: 91, night: false })
      const padX = 18 * u
      const labelY = f.y + 14 * u + 12 * u
      ctx.save()
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.font = font(12 * u)
      setLetterSpacing(ctx, 1.5)
      ctx.globalAlpha = 0.85
      ctx.fillText('VOCÊ SABIA?', f.x + padX, labelY)
      setLetterSpacing(ctx, 0)
      ctx.globalAlpha = alpha
      const textTop = labelY + 8 * u
      const avail = f.y + f.h - 12 * u - textTop
      let size = 15 * u
      let lines
      let lh
      let maxLines
      for (;;) {
        ctx.font = font(size, { style: 'italic' })
        lines = wrapText(ctx, facts[idx], f.w - padX * 2)
        lh = size * 1.28
        maxLines = Math.max(1, Math.floor(avail / lh))
        if (lines.length <= maxLines || size <= 12.5) break
        size -= 0.5
      }
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines)
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:\-]*\S*$/, '') + '…'
      }
      lines.forEach((line, i) => ctx.fillText(line, f.x + padX, textTop + size + i * lh))
      ctx.restore()
    }

    // Botão de turno - acento rosa da cena (zona do polegar).
    drawButton(ctx, H.btn, rank === 'larva' ? 'Nascer' : 'Iniciar turno', {
      hover,
      focused: true,
      time: t,
      caption: rank === 'larva' ? '' : `${rankName(rank)} · turno ${(context.tasks?.getCompletedShifts?.() ?? 0) + 1} de ${config.turnsPerTask[rank]}`,
      seed: 5,
    })

    fadeScreen(ctx, w, h, (1 - Math.min(1, t / 0.5)) * 0.8, '#1A1410')
  },

  exit() {},
}
