// TaskHubState — "casa" entre turnos: interior da colmeia (pré-renderizado),
// a operária do jogador em idle, HUD da colônia, dia/noite visual conforme
// context.time.isNight, fato real rotativo de species.js e o botão "Iniciar turno"
// (clique ou Enter) -> context.startShift(). Sem tutorial textual das tarefas.

import { drawHiveInterior } from '../art/hive.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawLightOverlay } from '../art/environment.js'
import { species } from '../data/species.js'
import { UI, font, drawDottedCircle, drawScaleArc, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  drawHUD,
  getHUDHeight,
  createLayerCache,
  createKeyWatcher,
  drawPaperCard,
  drawButton,
  pointInRect,
  wrapText,
  fadeScreen,
  rankName,
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
  const top = 0
  const { combs } = combLayout(w, h, top)
  drawHiveInterior(c, { width: w, height: h, backgroundSeed: 12, combs, queenChamber: null })
  // Vinheta escura quente para destacar o centro.
  const g = c.createRadialGradient(w * 0.5, h * 0.55, Math.min(w, h) * 0.18, w * 0.5, h * 0.55, Math.hypot(w, h) * 0.6)
  g.addColorStop(0, 'rgba(26, 18, 8, 0)')
  g.addColorStop(1, 'rgba(26, 18, 8, 0.72)')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  // Favo levemente rebaixado para a operária e a UI lerem por cima.
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

let keys = null
let t = 0
let factIndex = 0
let hover = false

function layout(w, h) {
  const hudH = getHUDHeight(w - 24)
  const btnW = Math.min(260, w - 32)
  const btnH = 62
  const narrow = w < 720
  const factW = narrow ? w - 32 : Math.min(460, w - btnW - 72)
  const factH = narrow ? 124 : 132
  const btn = narrow
    ? { x: (w - btnW) / 2, y: h - btnH - 20, w: btnW, h: btnH }
    : { x: w - btnW - 24, y: h - btnH - 30, w: btnW, h: btnH }
  const fact = narrow
    ? { x: 16, y: btn.y - factH - 14, w: factW, h: factH }
    : { x: 20, y: h - factH - 20, w: factW, h: factH }
  const stageTop = 12 + hudH
  const stageBottom = fact.y
  const beeX = w / 2
  const beeY = stageTop + (stageBottom - stageTop) * 0.5
  const cellSize = Math.max(11, Math.min(24, Math.min(w, h) / 30))
  const beeR = Math.max(44, Math.min((stageBottom - stageTop) * 0.34, cellSize * 5.2))
  return { btn, fact, beeX, beeY, beeR }
}

function colorVariantFor(rank) {
  if (rank === 'guard') return 'old'
  if (rank === 'feedLarvae' || rank === 'feedQueen') return 'adult'
  return 'young'
}

function start(context) {
  const rank = context.tasks?.currentRank
  if (rank === 'larva') {
    context.goTo('birth')
    return
  }
  context.startShift()
}

export default {
  enter(context) {
    t = 0
    keys = createKeyWatcher(context.input, KEYS)
    keys.prime()
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
    const L = layout(context.width, context.height)
    const pointer = context.input.getPointer()
    hover = pointInRect(pointer, L.btn)
    const clicks = context.input.consumeClicks()
    const pressed = keys.poll()
    if (clicks.some((c) => pointInRect(c, L.btn)) || pressed.size > 0) start(context)
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    const night = !!context.time?.isNight
    const L = layout(w, h)
    hiveLayer.draw(ctx, 0, 0, w, h, night ? 'night' : 'day')

    // Operária do jogador em idle, marcada como espécime (círculos técnicos).
    const { beeX, beeY, beeR } = L
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
    const rank = context.tasks?.currentRank
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

    drawHUD(ctx, context, { night })

    // Fato real rotativo.
    const facts = species.funFacts || []
    if (facts.length) {
      const idx = (factIndex + Math.floor(t / FACT_PERIOD)) % facts.length
      const phase = (t % FACT_PERIOD) / FACT_PERIOD
      const alpha = Math.min(1, Math.min(phase, 1 - phase) * 14)
      const f = L.fact
      drawPaperCard(ctx, f.x, f.y, f.w, f.h, { seed: 91, night })
      ctx.save()
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'left'
      ctx.font = font(9)
      ctx.globalAlpha = 0.6
      setLetterSpacing(ctx, 1.6)
      ctx.fillText('VOCÊ SABIA?', f.x + 20, f.y + 26)
      setLetterSpacing(ctx, 0)
      ctx.globalAlpha = 0.85 * alpha
      let size = 13.5
      let lines
      const maxLines = Math.floor((f.h - 50) / 16)
      do {
        ctx.font = font(size, { style: 'italic' })
        lines = wrapText(ctx, facts[idx], f.w - 40)
        size -= 0.5
      } while (lines.length > maxLines && size > 10)
      const lh = size * 1.3
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines)
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:—-]*\S*$/, '') + '…'
      }
      lines.forEach((line, i) => ctx.fillText(line, f.x + 20, f.y + 46 + i * lh))
      ctx.restore()
    }

    // Botão de turno — acento rosa da cena.
    drawButton(ctx, L.btn, rank === 'larva' ? 'Nascer' : 'Iniciar turno', {
      hover,
      focused: true,
      time: t,
      caption: rank === 'larva' ? '' : rankName(rank),
      size: 19,
      seed: 5,
    })

    fadeScreen(ctx, w, h, (1 - Math.min(1, t / 0.5)) * 0.8, '#1A1410')
  },

  exit() {},
}
