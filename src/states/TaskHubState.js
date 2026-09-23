// TaskHubState - "casa" entre turnos: interior da colmeia (pré-renderizado),
// a operária do jogador em idle, HUD da colônia (com progresso até a próxima
// função), dia/noite visual conforme context.time.isNight, curiosidade rotativa
// (nextFact() de src/data/facts.js, com a categoria discreta) e o botão grande
// "Iniciar turno" na zona do polegar (toque/clique ou Enter/Espaço) -> context.startShift().
// Rejogar fases: com 2+ fases em context.unlockedTasks(), um seletor de fichas (alvos
// >= 44px; setas <-/-> no teclado) fica acima do botão. A fase atual (currentTask(),
// marcada com um ponto) é a padrão; escolher uma anterior troca o cartão da curiosidade
// pelo aviso de TURNO LIVRE (não gasta dias nem conta para promoção/ranking), o botão
// vira "Turno livre" -> context.startShift(taskId), e "Voltar à fase atual" (ou a ficha
// atual, ou Esc) desfaz. Sem tutorial textual das tarefas.
// Layout: vertical primeiro (HUD no topo, botão embaixo); em tela larga o fato vai
// para a esquerda e o botão (com as fichas) para a direita, ambos na base.

import { drawHiveInterior } from '../art/hive.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { drawLightOverlay } from '../art/environment.js'
import { nextFact } from '../data/facts.js'
import { config } from '../data/config.js'
import { t as tr } from '../i18n/index.js'
import { UI, font, drawDottedCircle, drawScaleArc, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  drawHUD,
  getHUDHeight,
  createLayerCache,
  drawPaperCard,
  drawButton,
  pointInRect,
  fadeScreen,
  fitParagraph,
  drawFact,
  measureFact,
  measureContext,
  rankName,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
} from '../ui/HUD.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space']
const BACK_KEYS = ['Escape', 'Backspace']
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
let hover = false
let hoverBack = false
let fact = null
let factShownAt = 0
let selected = null // fase escolhida no seletor (null = fase atual)

function phaseState(context) {
  const current = context.currentTask?.() ?? null
  const tasks = current ? (context.unlockedTasks?.() ?? []) : []
  const sel = selected && tasks.includes(selected) ? selected : current
  return { current, tasks, sel, free: !!current && !!sel && sel !== current, chips: tasks.length > 1 }
}

const backH = (u) => Math.max(44, Math.round(44 * u))
const FREE_LABEL = (u) => 11.5 * u

// Altura do conteúdo do cartão inferior: curiosidade, ou aviso do turno livre + botão.
function cardContentH(ctx, P, fw, u) {
  const inner = fw - 36 * u
  if (P.free) {
    const p = ctx ? fitParagraph(ctx, tr('hub.free.hint'), inner, Infinity, { size: 14 * u, minSize: 11 }) : { height: 54 * u }
    return 14 * u + FREE_LABEL(u) + 7 * u + p.height + 12 * u + backH(u) + 12 * u
  }
  return 14 * u + measureFact(fact, inner, { u, size: 15 * u }) + 14 * u
}

function computeLayout(context) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const P = phaseState(context)
  let hudW = Math.min(1100, S.w - 24)
  let hudH = getHUDHeight(hudW, L.uiScale)
  let hudX = S.x + (S.w - hudW) / 2
  const btnH = Math.max(L.minTouch ?? 56, Math.round(66 * u))
  const chipH = P.chips ? Math.max(44, Math.round(46 * u)) : 0
  const chipsBlock = P.chips ? chipH + 12 * u : 0
  const margin = 16 * u
  // Tela deitada e baixa (celular deitado): o HUD compacto ocupa quase toda a altura,
  // então ele vai para a coluna esquerda e fato + fichas + botão para a direita.
  const minFactH = 96
  const stacked = S.y + 10 + hudH + 12 * u + minFactH + 12 * u + chipsBlock + btnH + margin <= S.y + S.h
  const side = S.w > S.h && !stacked && S.w >= 480
  const wide = !side && S.w >= 720 && S.w > S.h
  let btn, zone, fw
  if (side) {
    hudW = Math.round(Math.max(296, Math.min(460, S.w * 0.52)))
    hudH = getHUDHeight(hudW, L.uiScale)
    hudX = S.x + 12
    const colX = hudX + hudW + 14 * u
    const colW = S.x + S.w - 12 - colX
    btn = { x: colX, y: S.y + S.h - btnH - 12 * u, w: colW, h: btnH }
    fw = colW
    zone = { x: colX, top: S.y + 10, bottom: btn.y - chipsBlock - 10 * u, anchor: 'top' }
  } else if (wide) {
    const btnW = Math.min(320 * u, S.w * 0.34)
    btn = { x: S.x + S.w - btnW - 24 * u, y: S.y + S.h - btnH - 24 * u, w: btnW, h: btnH }
    fw = Math.min(500 * u, btn.x - S.x - 48 * u)
    const bottom = S.y + S.h - 20 * u
    zone = { x: S.x + 20 * u, top: Math.max(S.y + 10 + hudH + 16 * u, bottom - S.h * 0.5), bottom, anchor: 'bottom' }
  } else {
    const btnW = Math.min(380, S.w - 32)
    btn = { x: S.x + (S.w - btnW) / 2, y: S.y + S.h - btnH - margin, w: btnW, h: btnH }
    fw = Math.min(520, S.w - 24)
    zone = { x: S.x + (S.w - fw) / 2, top: S.y + 10 + hudH + 8 * u, bottom: btn.y - chipsBlock - 12 * u, anchor: 'bottom' }
  }
  // Cartão com a altura do conteúdo (mín. 104): o texto sempre cabe - a abelha some
  // antes de o texto encolher.
  const need = cardContentH(measureContext(), P, fw, u)
  const zoneH = Math.max(40, zone.bottom - zone.top)
  const factH = Math.round(Math.min(zoneH, Math.max(104, need)))
  const fact = { x: zone.x, y: zone.anchor === 'top' ? zone.top : zone.bottom - factH, w: fw, h: factH }
  // Fichas de fase logo acima do botão, com a mesma largura.
  let chips = []
  if (P.chips) {
    const n = P.tasks.length
    const gap = 6 * u
    const cw = (btn.w - gap * (n - 1)) / n
    const cy = btn.y - 12 * u - chipH
    chips = P.tasks.map((id, i) => ({ id, x: btn.x + i * (cw + gap), y: cy, w: cw, h: chipH }))
  }
  const back = P.free
    ? { x: fact.x + 18 * u, y: fact.y + fact.h - 12 * u - backH(u), w: Math.min(fact.w - 36 * u, 300 * u), h: backH(u) }
    : null
  const hud = { x: hudX, y: S.y + 10, w: hudW, h: hudH }
  const stageTop = hud.y + hudH
  const stageBottom = side ? stageTop : wide ? Math.min(fact.y, chips[0]?.y ?? btn.y) : fact.y
  const beeX = S.x + S.w / 2
  const beeY = stageTop + (stageBottom - stageTop) * 0.5
  const cellSize = Math.max(11, Math.min(24, Math.min(L.width, L.height) / 30))
  const beeR = Math.max(34, Math.min((stageBottom - stageTop) * 0.36, cellSize * 6.5 * u))
  return { L, S, u, P, btn, fact, chips, back, hud, beeX, beeY, beeR, showBee: stageBottom - stageTop > 70 }
}

function colorVariantFor(rank) {
  if (rank === 'guard') return 'old'
  if (rank === 'feedLarvae' || rank === 'feedQueen') return 'adult'
  return 'young'
}

function start(context, P) {
  if (context.tasks?.currentRank === 'larva') {
    context.goTo('birth')
    return
  }
  if (P?.free) context.startShift(P.sel)
  else context.startShift()
}

function select(context, id) {
  selected = id && id !== (context.currentTask?.() ?? null) ? id : null
}

// Área de toque um pouco maior que o desenho do botão (dedo impreciso).
function hitRect(r, grow) {
  return { x: r.x - grow, y: r.y - grow, w: r.w + grow * 2, h: r.h + grow * 2 }
}

function drawFreeCard(ctx, H) {
  const { u, fact: f, P } = H
  const padX = 18 * u
  drawPaperCard(ctx, f.x, f.y, f.w, f.h, { seed: 93, night: false })
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const title = tr('hub.free.title', { rank: rankName(P.sel).toUpperCase() })
  let ls = FREE_LABEL(u)
  ctx.font = font(ls)
  setLetterSpacing(ctx, 1.4)
  while (ls > 9 && ctx.measureText(title).width > f.w - padX * 2) {
    ls -= 0.5
    ctx.font = font(ls)
  }
  const ly = f.y + 14 * u + FREE_LABEL(u)
  ctx.fillText(title, f.x + padX, ly)
  setLetterSpacing(ctx, 0)
  // Filete rosa: modo especial ativo (acento único da cena).
  ctx.fillStyle = UI.pink
  ctx.fillRect(f.x + padX, ly + 4 * u, 28 * u, 2)
  ctx.fillStyle = UI.ink
  const top = ly + 7 * u
  const p = fitParagraph(ctx, tr('hub.free.hint'), f.w - padX * 2, H.back.y - 10 * u - top, { size: 14 * u, minSize: 11 })
  p.lines.forEach((line, i) => ctx.fillText(line, f.x + padX, top + p.size + i * p.lh))
  ctx.restore()
  drawButton(ctx, H.back, tr('hub.free.back'), { hover: hoverBack, accent: false, size: Math.min(16, 15 * u), seed: 17, time: t })
}

// Seletor de fases: fichas-etiqueta sobre uma régua; marcador rosa sob a escolhida,
// ponto na fase atual.
function drawChips(ctx, H) {
  const { u, P, chips } = H
  const c0 = chips[0]
  const cN = chips[chips.length - 1]
  const ry = c0.y + c0.h + 5 * u
  ctx.save()
  ctx.strokeStyle = UI.paper
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(c0.x, ry)
  ctx.lineTo(cN.x + cN.w, ry)
  ctx.stroke()
  ctx.restore()
  chips.forEach((r, i) => {
    const on = r.id === P.sel
    const lift = on ? -1.5 : 0
    drawPaperCard(ctx, r.x, r.y + lift, r.w, r.h, { seed: 70 + i, shadow: on, alpha: on ? 1 : 0.74 })
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = tr(`hub.phase.${r.id}`)
    const dot = r.id === P.current ? 9 * u : 0
    const style = on ? '' : 'italic'
    let size = 14.5 * u
    ctx.font = font(size, { style })
    while (size > 10.5 && ctx.measureText(label).width > r.w - 12 - dot) {
      size -= 0.5
      ctx.font = font(size, { style })
    }
    ctx.globalAlpha = on ? 1 : 0.8
    const tw = ctx.measureText(label).width
    const mx = r.x + r.w / 2 + dot / 2
    const my = r.y + r.h / 2 + lift
    ctx.fillText(label, mx, my)
    if (dot) {
      ctx.beginPath()
      ctx.arc(mx - tw / 2 - 6 * u, my, 2.6 * u, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    if (on) {
      const tx = r.x + r.w / 2
      ctx.save()
      ctx.fillStyle = UI.pink
      ctx.beginPath()
      ctx.moveTo(tx, ry - 3 * u)
      ctx.lineTo(tx - 5 * u, ry + 4 * u)
      ctx.lineTo(tx + 5 * u, ry + 4 * u)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  })
}

export default {
  enter(context) {
    t = 0
    hover = false
    hoverBack = false
    selected = null
    fact = nextFact()
    factShownAt = 0
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    if (context.time?.isLifeOver?.()) {
      context.goTo('end', { reason: 'lifeOver' })
      return
    }
    if (t - factShownAt >= FACT_PERIOD) {
      fact = nextFact()
      factShownAt = t
    }
    const H = computeLayout(context)
    const { P } = H
    const input = context.input
    const hit = hitRect(H.btn, 10)
    const mouse = !isTouchUI(context)
    const pointer = input.getPointer()
    hover = mouse && pointInRect(pointer, hit)
    hoverBack = mouse && !!H.back && pointInRect(pointer, H.back)
    const clicks = input.consumeClicks()
    if (t < 0.25) return // ignora toque "vazado" da tela anterior
    if (P.chips) {
      const i = P.tasks.indexOf(P.sel)
      if (anyKeyPressed(input, ['ArrowLeft'])) return select(context, P.tasks[Math.max(0, i - 1)])
      if (anyKeyPressed(input, ['ArrowRight'])) return select(context, P.tasks[Math.min(P.tasks.length - 1, i + 1)])
      if (P.free && anyKeyPressed(input, BACK_KEYS)) return select(context, null)
    }
    for (const c of clicks) {
      const chip = H.chips.find((r) => pointInRect(c, hitRect(r, 2)))
      if (chip) return select(context, chip.id)
      if (H.back && pointInRect(c, H.back)) return select(context, null)
      if (pointInRect(c, hit)) return start(context, P)
    }
    if (anyKeyPressed(input, KEYS)) start(context, P)
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

    drawHUD(ctx, context, { night, x: H.hud.x, y: H.hud.y, width: H.hud.w })

    const { P } = H
    const f = H.fact
    if (P.free) drawFreeCard(ctx, H)
    else if (fact) {
      // Curiosidade rotativa - cartão claro, tinta cheia (contraste alto sobre o papel).
      const phase = Math.min(1, (t - factShownAt) / FACT_PERIOD)
      const alpha = 0.8 + 0.2 * Math.min(1, Math.min(phase, 1 - phase) * 14)
      const padX = 18 * u
      drawPaperCard(ctx, f.x, f.y, f.w, f.h, { seed: 91, night: false })
      drawFact(ctx, { x: f.x + padX, y: f.y + 14 * u, w: f.w - padX * 2, h: f.h - 26 * u }, fact, {
        u, title: tr('hub.didYouKnow'), size: 15 * u, minSize: 11, alpha, labelAlpha: 0.85,
      })
    }
    if (H.chips.length) drawChips(ctx, H)

    // Botão de turno - acento rosa da cena (zona do polegar).
    const label = rank === 'larva' ? tr('hub.beBorn') : P.free ? tr('hub.free.button') : tr('hub.startShift')
    const caption = rank === 'larva' ? ''
      : P.free ? tr('hub.free.caption', { rank: rankName(P.sel) })
        : tr('hub.shiftCaption', { rank: rankName(rank), n: (context.tasks?.getCompletedShifts?.() ?? 0) + 1, total: config.turnsPerTask[rank] })
    drawButton(ctx, H.btn, label, { hover, focused: true, time: t, caption, seed: 5 })

    fadeScreen(ctx, w, h, (1 - Math.min(1, t / 0.5)) * 0.8, '#1A1410')
  },

  exit() {},
}
