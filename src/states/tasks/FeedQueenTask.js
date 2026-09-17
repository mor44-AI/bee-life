// Tarefa: Alimentar a rainha (séquito real).
//
// Posicionamento em multidão + combo de precisão:
//  - A rainha (fisogástrica) anda e vira devagar dentro da câmara real; o séquito
//    a cerca, disputa a frente da cabeça e empurra a operária do jogador.
//  - Para alimentar: estar dentro do cone à frente da cabeça (arco técnico fino)
//    enquanto a boca está aberta (TimingWindow). Aí surge uma sequência de direções
//    (ComboInput, relógio do jogo) - direcionais grandes do Controls (celular) ou
//    setas (PC). Os direcionais só aparecem enquanto o combo está ativo.
//  - Carga de alimento limitada; reabastece-se nos potes de mel na borda da câmara.
//  - Fome da rainha (Gauge) sobe sempre; em estado crítico ela para de pôr ovos
//    e o brilho dourado esmaece.
//  - Especial "Abrir caminho" (SpecialMeter: carga passiva ~20s + bônus por combo):
//    uma onda parte da operária e dispersa o séquito para a borda da câmara; por ~6s
//    as atendentes não empurram nem bloqueiam e depois voltam devagar.
//  - Dificuldade: data.difficulty (0-1, difficultyFor) + inShiftRamp dentro do turno.

import createMovement from '../../engine/MovementController.js'
import createGauge from '../../engine/Gauge.js'
import createTimingWindow from '../../engine/TimingWindow.js'
import createCombo from '../../engine/ComboInput.js'
import { create as createMeter } from '../../engine/SpecialMeter.js'
import { config, difficultyFor, inShiftRamp } from '../../data/config.js'
import { ease, lerp } from '../../engine/tween.js'
import { drawBeeBody, createIdlePose, createRegurgitatePose } from '../../art/bee.js'
import { drawComb } from '../../art/hive.js'
import {
  seededRandom,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  drawPaperGrain,
  polygonPoints,
  tracePath,
  withAlpha,
  INK_LINE,
} from '../../art/textureUtils.js'
import { styleGuide } from '../../data/styleGuide.js'
import { t, getLang } from '../../i18n/index.js'

const P = styleGuide.palettes.naturalist
const TAU = Math.PI * 2
const SHIFT_DURATION = config.shiftDuration
const MAX_CHARGE = 3
const EXPECTED_FEEDS = Math.round(13 * config.durationScale)
const SPECIAL_CHARGE_TIME = 20
const SPECIAL_DURATION = 6
const WAVE_DUR = 0.75

const DIRS = ['up', 'right', 'down', 'left']
const DIR_ANGLE = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }

// Corpo da rainha em "unidades de abelha" (mesmo sistema de bee.js: +x = cabeça).
const QUEEN_ABDOMEN = [
  { x: -0.5, r: 3.6 },
  { x: -3, r: 7.5 },
  { x: -8, r: 11.5 },
  { x: -15, r: 14.5 },
  { x: -24, r: 15.6 },
  { x: -33, r: 14.8 },
  { x: -41, r: 12.2 },
  { x: -47, r: 8.5 },
  { x: -51, r: 4.2 },
  { x: -53.5, r: 0.9 },
]
const QUEEN_CIRCLES = [
  { x: 10.5, r: 5.5 },
  { x: 3.5, r: 7 },
  { x: -8, r: 11 },
  { x: -18, r: 14.5 },
  { x: -29, r: 14.5 },
  { x: -39, r: 12 },
  { x: -47.5, r: 7.5 },
]
const QUEEN_APEX_X = 14.5
const QUEEN_BODY_CENTER_X = -19
const QUEEN_HALF_LEN = 34.5
const QUEEN_HALF_WID = 15.6

let st = null

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const rand = (a, b) => a + Math.random() * (b - a)
function angleDiff(a, b) {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}
function approach(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt))
}
function toWorld(q, lx, ly) {
  const c = Math.cos(q.heading)
  const s = Math.sin(q.heading)
  return { x: q.x + lx * c - ly * s, y: q.y + lx * s + ly * c }
}

// Nível efetivo: dificuldade do turno + rampa suave dentro do turno.
function levelAt(t) {
  const d = st.difficulty
  return clamp(d + (0.07 + 0.1 * d) * inShiftRamp(t, SHIFT_DURATION), 0, 1)
}
function comboLengthAt(level) {
  return Math.min(5, 2 + Math.floor(level * 3.6))
}
// Parâmetros do séquito por nível (em ~0.1: 1 rival, raramente disputa, empurrão fraco).
function courtParams(level) {
  return {
    rivals: Math.round(0.6 + 2.2 * level),
    claimDur: [1 + 0.9 * level, 1.8 + 1.2 * level],
    idleDur: [lerp(6, 3.2, level), lerp(9.5, 5.5, level)],
    chaseSpeed: lerp(55, 100, level),
    shove: lerp(8, 36, level),
    shoveShare: lerp(0.42, 0.54, level),
    reach: lerp(1.1, 1.45, level),
  }
}

// ---------------------------------------------------------------------------
// layout / fundo pré-renderizado
// ---------------------------------------------------------------------------

function makeLayout(W, H, pf, orientation) {
  pf = pf || { x: 0, y: 0, w: W, h: H }
  const portrait = pf.h >= pf.w
  // escala: o eixo curto da câmara define o tamanho das abelhas
  const S = clamp(Math.min(pf.w, pf.h) / 380, 0.72, 1.6)
  const label = 20 * S
  const cx = pf.x + pf.w / 2
  const cy = pf.y + label * 0.5 + pf.h / 2
  // raios mínimos: com playfield minúsculo (resize extremo) os valores brutos ficam
  // negativos e ctx.ellipse/arc lançam exceção.
  const minR = 24 * S
  const rx = Math.max(minR, portrait ? pf.w / 2 - 8 : Math.min(pf.w / 2 - 12, (pf.h / 2 - label) * 1.45))
  const ry = Math.max(minR, portrait ? Math.min(pf.h / 2 - label, pf.w * 0.85) : pf.h / 2 - label)
  const L = { W, H, pf, portrait, sidePanels: orientation === 'landscape', cx, cy, rx, ry, S, qs: 2.25 * S, ws: 1.3 * S }
  const cluster = (x, y, mirror, seed) => {
    const m = mirror ? -1 : 1
    return {
      x,
      y,
      seed,
      zoneR: 46 * S,
      items: [
        { dx: 2 * S * m, dy: -21 * S, rx: 14 * S, ry: 18 * S, seed: seed + 1 },
        { dx: -15 * S * m, dy: 12 * S, rx: 15 * S, ry: 19 * S, seed: seed + 2 },
        { dx: 17 * S * m, dy: 13 * S, rx: 12.5 * S, ry: 16 * S, seed: seed + 3 },
      ],
    }
  }
  const potR = 46 * S
  L.pots = portrait
    ? [
        cluster(cx - rx * 0.28, cy - ry + potR + 14 * S, false, 40),
        cluster(cx + rx * 0.28, cy + ry - potR - 14 * S, true, 70),
      ]
    : [
        cluster(cx - rx + potR + 22 * S, cy + ry * 0.14, false, 40),
        cluster(cx + rx - potR - 22 * S, cy - ry * 0.14, true, 70),
      ]
  return L
}

function buildBackground(L, dpr) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(L.W * dpr))
  canvas.height = Math.max(1, Math.round(L.H * dpr))
  const g = canvas.getContext('2d')
  g.scale(dpr, dpr)
  const { W, H, cx, cy, rx, ry, S } = L

  drawPaperGrain(g, W, H, { seed: 91 })

  // Invólucro de cerume: lamelas concêntricas irregulares ao redor da câmara.
  for (let i = 5; i >= 1; i--) {
    const k = 1 + i * 0.075
    const pts = polygonPoints(cx, cy, rx * k, ry * (1 + i * 0.11), 56, { jitter: 0.018, seed: 300 + i })
    g.save()
    g.beginPath()
    tracePath(g, pts, { closed: true, smooth: true })
    g.fillStyle = withAlpha('#C4A56A', 0.12 + (5 - i) * 0.03)
    g.fill()
    g.clip()
    drawHatching(g, { x: cx - rx * k, y: cy - ry * k * 1.5, width: rx * k * 2, height: ry * k * 3 }, {
      angle: 0.25 * i,
      lineCount: 26,
      color: '#6E5219',
      opacityRange: [0.03, 0.07],
      seed: 320 + i,
      curveAmount: 10,
    })
    g.restore()
    strokeHandDrawn(g, pts.concat([pts[0]]), {
      color: INK_LINE,
      baseWidth: 0.9,
      widthJitter: 0.35,
      seed: 340 + i,
      opacity: 0.22 + (5 - i) * 0.03,
    })
  }

  // Fragmentos de favo de cria nos cantos (fora da câmara; só com painéis laterais - no retrato ficariam sob os botões).
  if (L.sidePanels) {
  g.save()
  g.globalAlpha = 0.45
  const cell = Math.max(7, 10 * S)
  drawComb(g, {
    x: 18 * S,
    y: L.pf.y + cell * 2,
    cols: Math.ceil((W * 0.16) / (cell * 1.5)),
    rows: 4,
    cellSize: cell,
    seed: 17,
    getState: (c, r) => ((c * 7 + r * 3) % 5 === 0 ? 'egg' : 'capped'),
  })
  drawComb(g, {
    x: W - W * 0.16,
    y: L.pf.y + cell * 3.5,
    cols: Math.ceil((W * 0.15) / (cell * 1.5)),
    rows: 3,
    cellSize: cell,
    seed: 29,
    getState: (c, r) => ((c + r) % 4 === 0 ? 'larva' : 'capped'),
  })
  g.restore()
  }

  // Piso da câmara real.
  const floor = polygonPoints(cx, cy, rx, ry, 64, { jitter: 0.012, seed: 401 })
  g.save()
  g.beginPath()
  tracePath(g, floor, { closed: true, smooth: true })
  const fg = g.createRadialGradient(cx, cy - ry * 0.2, ry * 0.1, cx, cy, Math.max(rx, ry))
  fg.addColorStop(0, '#F1E7C8')
  fg.addColorStop(0.7, '#E2D1A0')
  fg.addColorStop(1, '#CDB27A')
  g.fillStyle = fg
  g.fill()
  g.clip()
  drawHatching(g, { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }, {
    angle: 0.55,
    lineCount: 70,
    color: '#8A6626',
    opacityRange: [0.04, 0.1],
    seed: 402,
    curveAmount: 14,
    segments: 7,
  })
  drawStipple(g, { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 }, {
    color: '#6E5219',
    count: 700,
    seed: 403,
    radius: [0.4, 1.2],
    opacity: [0.05, 0.14],
    densityBias: (u, v) => Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2.2) ** 2,
  })
  g.restore()
  strokeHandDrawn(g, floor, { color: INK_LINE, baseWidth: 2.1, widthJitter: 0.6, closed: true, seed: 404, opacity: 0.85 })

  // Potes de mel (cerume).
  for (const cl of L.pots) {
    // pilares de cerume ligando os potes
    const a = cl.items
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      const n = a[(i + 1) % a.length]
      strokeHandDrawn(g, [
        { x: cl.x + p.dx, y: cl.y + p.dy },
        { x: cl.x + (p.dx + n.dx) / 2 + 3 * S, y: cl.y + (p.dy + n.dy) / 2 },
        { x: cl.x + n.dx, y: cl.y + n.dy },
      ], { color: '#7A5220', baseWidth: 2.2 * S, widthJitter: 0.5, seed: cl.seed + 10 + i, opacity: 0.55 })
    }
    for (const p of a) drawPot(g, cl.x + p.dx, cl.y + p.dy, p.rx, p.ry, p.seed, S)
  }

  // Anotações de caderno de campo (escala, legenda discreta).
  g.save()
  g.fillStyle = INK_LINE
  g.globalAlpha = 0.55
  g.font = `italic ${Math.round(clamp(12 * S, 11, 18))}px Georgia, serif`
  g.textAlign = 'center'
  g.fillText(t('feedQueen.chamber'), cx, cy - ry - 6 * S)
  const sbx = L.pf.x + L.pf.w - 12 - 60 * S
  const sby = cy - ry - 4 * S
  g.strokeStyle = INK_LINE
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(sbx, sby)
  g.lineTo(sbx + 60 * S, sby)
  for (let i = 0; i <= 5; i++) {
    const tx = sbx + i * 12 * S
    g.moveTo(tx, sby)
    g.lineTo(tx, sby - (i % 5 === 0 ? 6 : 3) * S)
  }
  g.stroke()
  g.font = `italic ${Math.round(clamp(10 * S, 9, 14))}px Georgia, serif`
  g.fillText(t('feedQueen.scale'), sbx + 30 * S, sby - 9 * S)
  g.restore()

  return canvas
}

function drawPot(g, x, y, rx, ry, seed, S) {
  const pts = polygonPoints(x, y, rx, ry, 26, { jitter: 0.04, seed })
  g.save()
  g.beginPath()
  tracePath(g, pts, { closed: true, smooth: true })
  const gr = g.createRadialGradient(x - rx * 0.3, y - ry * 0.35, 1, x, y, ry * 1.2)
  gr.addColorStop(0, '#D9A94A')
  gr.addColorStop(0.6, '#A8762E')
  gr.addColorStop(1, '#6E4A1C')
  g.fillStyle = gr
  g.fill()
  g.clip()
  drawHatching(g, { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 }, {
    angle: 1.3,
    lineCount: 14,
    color: '#3B2C10',
    opacityRange: [0.12, 0.24],
    seed: seed + 5,
    curveAmount: 3,
  })
  drawStipple(g, { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 }, {
    color: '#3B2C10',
    count: 40,
    seed: seed + 6,
    radius: [0.3, 0.9],
    opacity: [0.1, 0.25],
    densityBias: (u, v) => v,
  })
  g.fillStyle = withAlpha(P.sunHalo, 0.55)
  g.beginPath()
  g.ellipse(x - rx * 0.35, y - ry * 0.2, rx * 0.16, ry * 0.32, 0.3, 0, TAU)
  g.fill()
  g.restore()
  strokeHandDrawn(g, pts, { color: INK_LINE, baseWidth: 1.4, widthJitter: 0.4, closed: true, seed: seed + 7, opacity: 0.85 })
  g.save()
  g.fillStyle = '#3B2A12'
  g.globalAlpha = 0.75
  g.beginPath()
  g.ellipse(x + rx * 0.05, y - ry * 0.78, rx * 0.32, ry * 0.12, 0, 0, TAU)
  g.fill()
  g.restore()
}

function ensureLayout(context) {
  const W = context.width
  const H = context.height
  if (!W || !H) return false
  const pf = context.layout?.playfield || { x: 0, y: 0, w: W, h: H }
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  if (st.L && st.L.W === W && st.L.H === H && same(st.L.pf, pf)) return true
  const old = st.L
  const L = makeLayout(W, H, { ...pf }, context.layout?.orientation || (W > H ? 'landscape' : 'portrait'))
  st.bg = null // reconstruído sob demanda no render (simulação headless não tem document)
  st.L = L
  if (old) {
    const map = (o) => {
      o.x = L.cx + ((o.x - old.cx) / old.rx) * L.rx
      o.y = L.cy + ((o.y - old.cy) / old.ry) * L.ry
    }
    map(st.queen)
    map(st.player)
    st.attendants.forEach(map)
    st.fx.forEach(map)
    st.eggs.forEach(map)
    st.queen.target && map(st.queen.target)
    const scale = L.S / old.S
    st.player.r *= scale
    st.attendants.forEach((a) => (a.r *= scale))
    rebuildController()
  }
  return true
}

function rebuildController() {
  const L = st.L
  st.obstacles = []
  st.controller = createMovement({
    bounds: { x: L.cx - L.rx, y: L.cy - L.ry, width: L.rx * 2, height: L.ry * 2 },
    obstacles: st.obstacles,
    speed: 175 * L.S,
  })
  st.controller.setPosition(st.player.x, st.player.y)
}

// ---------------------------------------------------------------------------
// entidades
// ---------------------------------------------------------------------------

function initWorld() {
  const L = st.L
  const q = st.queen
  if (L.portrait) {
    q.x = L.cx
    q.y = L.cy + L.ry * 0.12
    q.heading = -Math.PI / 2 - 0.3
    st.player.x = L.cx - L.rx * 0.45
    st.player.y = L.cy - L.ry * 0.45
  } else {
    q.x = L.cx + L.rx * 0.08
    q.y = L.cy - L.ry * 0.05
    q.heading = Math.PI + 0.35
    st.player.x = L.cx - L.rx * 0.5
    st.player.y = L.cy + L.ry * 0.3
  }
  q.base = q.heading
  q.target = { x: q.x, y: q.y }
  st.player.r = 13 * L.S
  st.player.facing = 0
  rebuildController()

  const count = 6 + Math.round(3 * st.difficulty)
  const slots = []
  for (let i = 0; i < count; i++) slots.push((i / count) * TAU + rand(-0.2, 0.2))
  // rivais (índices baixos) nascem com vagas próximas da cabeça
  slots.sort((a, b) => Math.abs(angleDiff(a, 0)) - Math.abs(angleDiff(b, 0)))
  st.attendants = slots.map((slot, i) => {
    const a = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 12.5 * L.S,
      facing: 0,
      slot,
      claimSide: Math.random() < 0.5 ? -1 : 1,
      claiming: false,
      claimT: rand(1, 5),
      rushT: rand(0.5, 4),
      rushing: false,
      off: 6 * L.S,
      legPhase: rand(0, 6),
      seed: 500 + i * 13,
      variant: i % 3 === 2 ? 'old' : 'adult',
      // dispersão do especial: delay até a onda chegar, alvo na borda, "fantasma" (não bloqueia)
      scatterDelay: -1,
      scatterTarget: null,
      ghost: 0,
      returning: 0,
    }
    const p = courtPoint(a)
    a.x = p.x
    a.y = p.y
    return a
  })
}

function courtPoint(a) {
  const q = st.queen
  const qs = st.L.qs
  const lx = QUEEN_BODY_CENTER_X * qs + Math.cos(a.slot) * (QUEEN_HALF_LEN * qs + a.r + a.off)
  const ly = Math.sin(a.slot) * (QUEEN_HALF_WID * qs + a.r + a.off)
  return toWorld(q, lx, ly)
}

function queenApex() {
  return toWorld(st.queen, QUEEN_APEX_X * st.L.qs, 0)
}

function coneGeometry(level) {
  const S = st.L.S
  return {
    half: lerp(0.66, 0.46, level),
    minD: 4 * S,
    maxD: lerp(92, 76, level) * S,
  }
}

function updateQueen(dt, level) {
  const q = st.queen
  const L = st.L
  q.modeT += dt
  const qrx = L.rx * 0.3
  const qry = L.ry * 0.2
  if (q.modeT >= q.modeDur) {
    q.modeT = 0
    const r = Math.random()
    if (q.mode !== 'rest') {
      q.mode = 'rest'
      q.modeDur = rand(1.4, 3.2) * lerp(2.2, 0.8, level)
    } else if (r < lerp(0.35, 0.55, level)) {
      q.mode = 'turn'
      q.h0 = q.base
      const amp = rand(0.5, 1.3) * lerp(0.3, 0.85, level)
      q.h1 = q.base + amp * (Math.random() < 0.5 ? -1 : 1)
      q.modeDur = rand(2.8, 4.6) * lerp(1.5, 0.8, level)
    } else if (r < lerp(0.55, 1, level)) {
      q.mode = 'walk'
      const ang = rand(0, TAU)
      const rr = Math.sqrt(Math.random())
      q.target = { x: L.cx + Math.cos(ang) * qrx * rr, y: L.cy + Math.sin(ang) * qry * rr }
      q.modeDur = rand(2.2, 4)
    } else {
      q.mode = 'rest'
      q.modeDur = rand(2, 4)
    }
  }
  if (q.mode === 'turn') {
    q.base = lerp(q.h0, q.h1, ease(q.modeT / q.modeDur, 'easeInOutCubic'))
    q.walk = 0.5
  } else if (q.mode === 'walk') {
    const want = Math.atan2(q.target.y - q.y, q.target.x - q.x)
    const turnRate = lerp(0.25, 0.5, level)
    q.base += clamp(angleDiff(want, q.base), -turnRate * dt, turnRate * dt)
    const env = Math.sin(Math.PI * clamp(q.modeT / q.modeDur, 0, 1))
    const v = lerp(9, 22, level) * L.S * env
    q.x += Math.cos(q.base) * v * dt
    q.y += Math.sin(q.base) * v * dt
    q.walk = env
    const dx = (q.x - L.cx) / qrx
    const dy = (q.y - L.cy) / qry
    const k = dx * dx + dy * dy
    if (k > 1) {
      q.x = L.cx + (q.x - L.cx) / Math.sqrt(k)
      q.y = L.cy + (q.y - L.cy) / Math.sqrt(k)
    }
  } else {
    q.walk = 0
  }
  q.legPhase += dt * (0.4 + q.walk * 2.4)
  // oscilação orgânica sobreposta (o cone "respira")
  q.sway = (Math.sin(st.t * 0.71) * 0.07 + Math.sin(st.t * 0.23 + 1.3) * 0.06) * lerp(0.35, 1, level)
  q.heading = q.base + q.sway
}

function queenCircles() {
  const q = st.queen
  const qs = st.L.qs
  return QUEEN_CIRCLES.map((c) => {
    const p = toWorld(q, c.x * qs, 0)
    return { x: p.x, y: p.y, radius: c.r * qs }
  })
}

// ---------------------------------------------------------------------------
// combo
// ---------------------------------------------------------------------------

function makeSequence(len) {
  const seq = []
  while (seq.length < len) {
    const d = DIRS[Math.floor(Math.random() * 4)]
    const n = seq.length
    if (n >= 2 && seq[n - 1] === d && seq[n - 2] === d) continue
    seq.push(d)
  }
  return seq
}

function windowRemaining() {
  return st.window.timeUntilClose
}
function windowFraction() {
  const w = st.window
  return w.isOpen ? clamp(1 - w.openProgress, 0, 1) : 0
}

// Tempo mínimo de boca aberta para a sequência ser humanamente possível: reação
// inicial + ~0,4 s por direção (toque no celular). Se o jogador chega ao cone tarde
// demais, o combo não abre e a janela não é gasta (nem a carga) - espera a próxima.
const COMBO_REACTION = 0.45
const COMBO_PER_INPUT = 0.4
function comboMinTime(level) {
  return COMBO_REACTION + comboLengthAt(level) * COMBO_PER_INPUT
}

function startCombo(level) {
  const seq = makeSequence(comboLengthAt(level))
  st.combo = {
    seq,
    idx: 0,
    fedAny: false,
    outT: 0,
    combo: createCombo({ sequence: seq, timeLimit: windowRemaining() + 0.05, clock: 'game' }),
    t: 0,
  }
}

function feedCombo(dir) {
  const c = st.combo
  if (!c) return
  if (!c.fedAny) st.stats.attempts++
  c.fedAny = true
  c.combo.feed(dir)
  if (c.combo.failed) {
    endCombo(false, 'wrong')
    return
  }
  c.idx++
  c.flash = 0.18
  if (c.combo.isComplete) endCombo(true)
}

function endCombo(success, reason) {
  const c = st.combo
  const L = st.L
  const apex = queenApex()
  st.windowUsed = true
  st.combo = null
  if (success) {
    // perfeito = bem no eixo da cabeça
    const centered = Math.abs(st.coneAngle) < st.cone.half * 0.35
    st.stats.feeds++
    if (centered) st.stats.perfect++
    st.hunger.subtract(centered ? 27 : 21)
    st.meter.add(centered ? 0.14 : 0.06)
    st.player.charge = Math.max(0, st.player.charge - 1)
    st.queen.fedGlow = 1
    st.fx.push({ type: 'ring', x: apex.x, y: apex.y, t: 0, dur: 1.1, r0: 6 * L.S, r1: 60 * L.S, color: P.caterpillarGold })
    if (centered) st.fx.push({ type: 'ring', x: apex.x, y: apex.y, t: -0.15, dur: 1.2, r0: 4 * L.S, r1: 90 * L.S, color: P.sunGold })
  } else {
    if (c && c.fedAny) {
      st.stats.fails++
      st.player.charge = Math.max(0, st.player.charge - 0.5)
      st.fx.push({ type: 'cross', x: st.player.x, y: st.player.y - 30 * L.S, t: 0, dur: 0.9 })
      for (let i = 0; i < 7; i++) {
        const a = rand(0, TAU)
        const sp = rand(20, 60) * L.S
        st.fx.push({ type: 'drop', x: st.player.x, y: st.player.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: rand(0.6, 1.1) })
      }
    }
    if (reason) {
      st.lastFail = reason
      if (c && c.fedAny) st.stats.why[reason] = (st.stats.why[reason] || 0) + 1
    }
  }
}

// ---------------------------------------------------------------------------
// ciclo de vida do estado
// ---------------------------------------------------------------------------

function enter(context, data = {}) {
  const shiftIndex = data?.shiftIndex ?? 0
  const difficulty = Number.isFinite(data?.difficulty) ? clamp(data.difficulty, 0, 1) : difficultyFor('feedQueen', shiftIndex)
  st = {
    shiftIndex,
    difficulty,
    meter: createMeter({ chargeTime: SPECIAL_CHARGE_TIME, duration: SPECIAL_DURATION }),
    wave: null,
    showDirs: null,
    t: 0,
    L: null,
    bg: null,
    sprites: new Map(),
    spriteDpr: 0,
    spriteS: 0,
    queen: { x: 0, y: 0, heading: 0, mode: 'rest', modeT: 0, modeDur: 1.5, legPhase: 0, walk: 0, sway: 0, mouth: 0, fedGlow: 0, glow: 1, eggT: 4 },
    player: { x: 0, y: 0, r: 12, facing: 0, charge: MAX_CHARGE, legPhase: 0, moving: 0, refilling: false },
    attendants: [],
    obstacles: [],
    controller: null,
    hunger: createGauge({ rate: 1.3, max: 100, thresholds: { restless: 0.5, critical: 0.75 } }),
    window: null,
    windowTier: -1,
    windowSize: 2.9,
    windowWasOpen: false,
    windowUsed: false,
    combo: null,
    cone: { half: 0.44, minD: 4, maxD: 78 },
    coneAngle: 0,
    inCone: false,
    stats: { feeds: 0, perfect: 0, attempts: 0, fails: 0, critTime: 0, eggs: 0, specials: 0, why: {}, satedTime: 0 },
    fx: [],
    eggs: [],
    ending: null,
    finished: false,
  }
  st.hunger.value = lerp(28, 38, difficulty)
  makeWindow(levelAt(0))
  syncControls(context)
  if (ensureLayout(context)) initWorld()
}

// Direcionais grandes só durante o combo (as setas viram direções; WASD/dedo movem).
function syncControls(context) {
  const ctl = context.controls
  if (!ctl) return
  const want = !!st.combo
  if (st.showDirs === want && ctl.options?.meter === st.meter) return
  st.showDirs = want
  ctl.configure({ showAction: false, showSpecial: true, showDirections: want, meter: st.meter, specialLabel: t('feedQueen.specialButton') })
}

function makeWindow(level) {
  const tier = Math.round(level * 10)
  st.windowTier = tier
  const lv = tier / 10
  st.windowSize = 1.3 + comboLengthAt(lv) * lerp(0.75, 0.62, lv)
  st.window = createTimingWindow({
    // Intervalos menores criam mais oportunidades sem encurtar o tempo do combo.
    periodRange: [lerp(0.55, 0.35, lv), lerp(1.0, 0.75, lv)],
    windowSize: st.windowSize,
    jitter: lerp(0.08, 0.4, lv),
  })
}

function update(context, dt) {
  if (!st) return
  const hadLayout = !!st.L
  if (!ensureLayout(context)) return
  if (!hadLayout) initWorld()
  const L = st.L
  const ctl = context.controls

  if (st.ending != null) {
    st.ending += dt
    if (st.ending > 1.4 && !st.finished) {
      st.finished = true
      context.finishShift(computeResult())
    }
    return
  }

  st.t += dt
  const level = levelAt(st.t)
  const court = courtParams(level)
  st.cone = coneGeometry(level)
  const q = st.queen

  // --- rainha
  updateQueen(dt, level)
  const circles = queenCircles()
  const apex = queenApex()

  // --- janela de boca
  st.window.update(dt)
  const open = st.window.isOpen
  if (st.windowWasOpen && !open) {
    st.windowUsed = false
    if (Math.round(level * 10) !== st.windowTier) makeWindow(level)
  }
  st.windowWasOpen = st.window.isOpen
  q.mouth = approach(q.mouth, open ? 1 : 0, open ? 9 : 6, dt)
  const untilOpen = open ? 9 : st.window.timeUntilOpen
  q.anticip = clamp(1 - untilOpen / 0.9, 0, 1)

  // --- fome, ovos, brilho
  st.hunger.setRate(lerp(0.85, 1.6, level))
  st.hunger.update(dt)
  const hState = st.hunger.state
  if (hState === 'critical') st.stats.critTime += dt
  // saciedade: 1 abaixo de 20%, cai linearmente até 0 em 60%
  st.stats.satedTime += dt * clamp(1 - (st.hunger.value / st.hunger.max - 0.2) / 0.4, 0, 1)
  const glowTarget = hState === 'critical' ? 0.05 : hState === 'restless' ? 0.55 : 1
  q.glow = approach(q.glow, glowTarget, 1.4, dt)
  q.fedGlow = Math.max(0, q.fedGlow - dt * 0.8)
  if (hState !== 'critical') {
    q.eggT -= dt * (hState === 'calm' ? 1.25 : 0.8)
    if (q.eggT <= 0) {
      q.eggT = rand(5.5, 8)
      const tip = toWorld(q, -55 * L.qs, rand(-4, 4) * L.S)
      st.eggs.push({ x: tip.x, y: tip.y, rot: q.heading + rand(-0.4, 0.4), t: 0 })
      st.stats.eggs++
    }
  }
  st.eggs.forEach((e) => (e.t += dt))
  st.eggs = st.eggs.filter((e) => e.t < 5)

  // --- entrada
  const pl = st.player
  if (st.combo && ctl?.directionPressed) feedCombo(ctl.directionPressed)

  // --- especial: Abrir caminho
  st.meter.update(dt)
  if (ctl?.specialPressed && st.meter.activate()) triggerScatter()
  if (st.meter.justEnded) endScatter()
  if (st.wave) {
    st.wave.t += dt
    if (st.wave.t > WAVE_DUR + 0.6) st.wave = null
  }

  let mx = 0
  let my = 0
  const mv = ctl?.move
  if (mv && mv.vx != null) {
    mx = mv.vx
    my = mv.vy
  } else if (mv) {
    const dx = mv.targetX - pl.x
    const dy = mv.targetY - pl.y
    const d = Math.hypot(dx, dy)
    if (d > 4 * L.S) {
      const m = clamp(d / (30 * L.S), 0, 1)
      mx = (dx / d) * m
      my = (dy / d) * m
    }
  }
  const mag = Math.hypot(mx, my)
  if (mag > 1) {
    mx /= mag
    my /= mag
  }

  // --- movimento do jogador (MovementController, eixos separados = desliza em obstáculos)
  st.obstacles.length = 0
  for (const c of circles) st.obstacles.push({ x: c.x, y: c.y, radius: c.radius + pl.r })
  for (const cl of L.pots) {
    for (const it of cl.items) st.obstacles.push({ x: cl.x + it.dx, y: cl.y + it.dy, radius: it.rx + pl.r })
  }
  const ctrl = st.controller
  ctrl.setPosition(pl.x, pl.y)
  ctrl.setSpeedMultiplier(1 - 0.05 * pl.charge)
  ctrl.update(dt, { x: mx, y: 0 })
  ctrl.update(dt, { x: 0, y: my })
  const nx = ctrl.position.x
  const ny = ctrl.position.y
  const moved = Math.hypot(nx - pl.x, ny - pl.y)
  pl.x = nx
  pl.y = ny
  pl.moving = approach(pl.moving, clamp(moved / (dt * 120 * L.S + 1e-6), 0, 1), 10, dt)
  pl.legPhase += dt * (0.5 + pl.moving * 7)

  // --- séquito
  const pdApex = Math.hypot(pl.x - apex.x, pl.y - apex.y)
  const rivalCount = Math.min(st.attendants.length, court.rivals)
  const frontGap = lerp(0.95, 0.4, level) // vagas não-rivais evitam a frente da cabeça
  const scatterActive = st.meter.isActive
  st.attendants.forEach((a, i) => {
    const rival = i < rivalCount
    a.rival = rival
    let target
    let maxSpeed = lerp(45, 70, level) * L.S
    let rate = 5
    if (a.ghost > 0 && !scatterActive) a.ghost = Math.max(0, a.ghost - dt)
    if (scatterActive && a.scatterTarget) {
      // dispersa: espera a onda chegar, corre para a borda e fica lá
      a.claiming = false
      a.rushing = false
      if (a.scatterDelay > 0) {
        a.scatterDelay -= dt
        target = { x: a.x, y: a.y }
      } else {
        const hold = st.meter.activeRemaining > 1.6
        const wob = Math.sin(st.t * 0.9 + a.seed) * 6 * L.S
        target = hold
          ? { x: a.scatterTarget.x + wob, y: a.scatterTarget.y - wob * 0.5 }
          : courtPoint(a)
        maxSpeed = (hold ? 190 : 26) * L.S
        rate = hold ? 7 : 2
      }
    } else if (a.returning > 0) {
      // volta devagar à vaga depois do especial
      a.returning -= dt
      a.claiming = false
      target = courtPoint(a)
      maxSpeed = 30 * L.S
      rate = 2
    } else {
      if (rival) {
        a.claimT -= dt
        if (a.claimT <= 0) {
          a.claiming = !a.claiming
          a.claimSide = Math.random() < 0.5 ? -1 : 1
          a.claimT = a.claiming ? rand(court.claimDur[0], court.claimDur[1]) : rand(court.idleDur[0], court.idleDur[1])
        }
      } else {
        a.claiming = false
      }
      if (rival && a.claiming) {
        maxSpeed = court.chaseSpeed * L.S
        if (pdApex < st.cone.maxD * court.reach) {
          target = { x: pl.x, y: pl.y }
        } else {
          const ang = q.heading + a.claimSide * st.cone.half * 0.45
          const d = st.cone.minD + a.r + 10 * L.S
          target = { x: apex.x + Math.cos(ang) * d, y: apex.y + Math.sin(ang) * d }
        }
      } else {
        a.slot += Math.sin(st.t * 0.3 + a.seed) * 0.12 * dt
        const fd = angleDiff(a.slot, 0)
        if (Math.abs(fd) < frontGap) a.slot += Math.sign(fd || a.claimSide) * Math.min(frontGap - Math.abs(fd), 1.2 * dt)
        a.rushT -= dt
        if (a.rushT <= 0) {
          a.rushing = !a.rushing
          a.rushT = a.rushing ? rand(0.6, 1.3) : rand(1.5, 4.5)
        }
        a.off = approach(a.off, (a.rushing ? -2 : 9) * L.S, a.rushing ? 5 : 2, dt)
        target = courtPoint(a)
      }
    }
    const dx = target.x - a.x
    const dy = target.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const sp = Math.min(maxSpeed, d * 3)
    a.vx = approach(a.vx, (dx / d) * sp, rate, dt)
    a.vy = approach(a.vy, (dy / d) * sp, rate, dt)
    a.x += a.vx * dt
    a.y += a.vy * dt
    const speed = Math.hypot(a.vx, a.vy)
    a.legPhase += dt * (0.4 + speed / (12 * L.S))
    // empurrão ativo: rival em disputa desloca a operária para fora do cone
    if (rival && a.claiming && !(a.ghost > 0)) {
      const ex = pl.x - a.x
      const ey = pl.y - a.y
      const ed = Math.hypot(ex, ey)
      if (ed < pl.r + a.r + 4 * L.S && ed > 0.01) {
        const px = -Math.sin(q.heading)
        const py = Math.cos(q.heading)
        const side = Math.sign(ex * px + ey * py) || a.claimSide
        const shove = court.shove * L.S * dt
        pl.x += (px * side * 0.7 + (ex / ed) * 0.3) * shove
        pl.y += (py * side * 0.7 + (ey / ed) * 0.3) * shove
        a.shoving = 0.25
      }
    }
    a.shoving = Math.max(0, (a.shoving || 0) - dt)
    // orientação
    let faceTo
    if (rival && a.claiming && Math.hypot(a.x - apex.x, a.y - apex.y) < st.cone.maxD * 1.5) {
      faceTo = Math.atan2(apex.y - a.y, apex.x - a.x)
    } else if (speed > 30 * L.S) {
      faceTo = Math.atan2(a.vy, a.vx)
    } else {
      const bc = toWorld(q, clamp(projectOnAxis(a), -50 * L.qs, 12 * L.qs), 0)
      faceTo = Math.atan2(bc.y - a.y, bc.x - a.x) + Math.sin(st.t * 1.7 + a.seed) * 0.15
    }
    a.facing += angleDiff(faceTo, a.facing) * Math.min(1, dt * 5)
  })

  // --- colisões suaves (abelha x abelha, x rainha, x potes, x parede)
  const bodies = [pl, ...st.attendants]
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const A = bodies[i]
        const B = bodies[j]
        // atendentes dispersadas não bloqueiam a operária
        if (A === pl && B.ghost > 0) continue
        const dx = B.x - A.x
        const dy = B.y - A.y
        const d = Math.hypot(dx, dy) || 0.001
        const ov = A.r + B.r - d
        if (ov <= 0) continue
        let shareA = 0.5
        if (A === pl) shareA = B.rival && B.claiming ? court.shoveShare : lerp(0.25, 0.42, level)
        A.x -= (dx / d) * ov * shareA
        A.y -= (dy / d) * ov * shareA
        B.x += (dx / d) * ov * (1 - shareA)
        B.y += (dy / d) * ov * (1 - shareA)
      }
    }
    for (const b of bodies) {
      for (const c of circles) pushOut(b, c.x, c.y, c.radius + b.r + 0.6)
      for (const cl of L.pots) for (const it of cl.items) pushOut(b, cl.x + it.dx, cl.y + it.dy, it.rx + b.r + 0.6)
      const ex = L.rx - b.r - 4 * L.S
      const ey = L.ry - b.r - 4 * L.S
      const kx = (b.x - L.cx) / ex
      const ky = (b.y - L.cy) / ey
      const k = kx * kx + ky * ky
      if (k > 1) {
        const s = Math.sqrt(k)
        b.x = L.cx + (b.x - L.cx) / s
        b.y = L.cy + (b.y - L.cy) / s
      }
    }
  }
  ctrl.setPosition(pl.x, pl.y)

  // --- cone
  const vx = pl.x - apex.x
  const vy = pl.y - apex.y
  const vd = Math.hypot(vx, vy)
  st.coneAngle = angleDiff(Math.atan2(vy, vx), q.heading)
  st.inCone = vd >= st.cone.minD && vd <= st.cone.maxD && Math.abs(st.coneAngle) <= st.cone.half
  if (st.inCone || st.combo) {
    pl.facing += angleDiff(Math.atan2(-vy, -vx), pl.facing) * Math.min(1, dt * 8)
  } else if (mag > 0.1) {
    pl.facing += angleDiff(Math.atan2(my, mx), pl.facing) * Math.min(1, dt * 9)
  }

  // --- reabastecimento
  pl.refilling = false
  for (const cl of L.pots) {
    if (Math.hypot(pl.x - cl.x, pl.y - cl.y) < cl.zoneR + pl.r + 12 * L.S && pl.charge < MAX_CHARGE) {
      pl.refilling = true
      pl.charge = Math.min(MAX_CHARGE, pl.charge + 1.25 * dt)
      if (Math.random() < dt * 6) {
        st.fx.push({ type: 'drop', x: cl.x, y: cl.y, vx: (pl.x - cl.x) * 1.6, vy: (pl.y - cl.y) * 1.6, t: 0, dur: 0.6 })
      }
    }
  }

  // --- combo / alimentação
  if (!st.combo) {
    if (open && st.inCone && !st.windowUsed && pl.charge >= 1 && windowRemaining() >= comboMinTime(level)) startCombo(level)
  } else {
    const c = st.combo
    c.t += dt
    c.flash = Math.max(0, (c.flash || 0) - dt)
    c.combo.update(dt)
    if (!open || c.combo.failed) {
      endCombo(false, 'timeout')
    } else {
      c.outT = st.inCone ? 0 : c.outT + dt
      if (c.outT > lerp(0.9, 0.55, level)) {
        const fed = c.fedAny
        endCombo(false, 'pushed')
        // empurrado para fora antes de começar não gasta a janela
        if (!fed) st.windowUsed = false
      }
    }
  }

  // --- efeitos
  for (const f of st.fx) {
    f.t += dt
    if (f.type === 'drop') {
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.vx *= 1 - dt * 2
      f.vy *= 1 - dt * 2
    }
  }
  st.fx = st.fx.filter((f) => f.t < f.dur)

  if (st.t >= SHIFT_DURATION) {
    if (st.combo) endCombo(false, 'end')
    st.ending = 0
  }
  syncControls(context)
}

function projectOnAxis(b) {
  const q = st.queen
  return (b.x - q.x) * Math.cos(q.heading) + (b.y - q.y) * Math.sin(q.heading)
}

function pushOut(b, x, y, minD) {
  const dx = b.x - x
  const dy = b.y - y
  const d = Math.hypot(dx, dy)
  if (d >= minD) return
  if (d < 0.001) {
    b.x += minD
    return
  }
  b.x = x + (dx / d) * minD
  b.y = y + (dy / d) * minD
}

// Especial "Abrir caminho": onda circular a partir da operária; cada atendente parte
// quando a frente da onda a alcança, rumo à borda da câmara (direção oposta à operária).
function triggerScatter() {
  const L = st.L
  const pl = st.player
  const reach = Math.hypot(L.rx, L.ry) * 1.05
  st.wave = { x: pl.x, y: pl.y, t: 0, reach }
  for (const a of st.attendants) {
    let ux = a.x - pl.x
    let uy = a.y - pl.y
    const d = Math.hypot(ux, uy)
    if (d < 1) {
      ux = Math.cos(a.seed)
      uy = Math.sin(a.seed)
    } else {
      ux /= d
      uy /= d
    }
    // interseção do raio (a -> fora) com a elipse interna da câmara
    const ex = L.rx - a.r - 10 * L.S
    const ey = L.ry - a.r - 10 * L.S
    const ox = (a.x - L.cx) / ex
    const oy = (a.y - L.cy) / ey
    const dx = ux / ex
    const dy = uy / ey
    const A = dx * dx + dy * dy
    const B = 2 * (ox * dx + oy * dy)
    const C = ox * ox + oy * oy - 1
    const s = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)
    a.scatterTarget = { x: a.x + ux * Math.max(0, s), y: a.y + uy * Math.max(0, s) }
    a.scatterDelay = clamp(d / reach, 0, 1) * WAVE_DUR * 0.8
    a.ghost = 1
    a.claiming = false
    a.shoving = 0
    a.vx += ux * 60 * L.S
    a.vy += uy * 60 * L.S
  }
  st.stats.specials++
  if (st.combo && !st.combo.fedAny) st.combo.outT = 0
}

function endScatter() {
  for (const a of st.attendants) {
    a.scatterTarget = null
    a.ghost = 1.2 // ainda sem bloquear por um instante enquanto voltam
    a.returning = 3.5
    a.claiming = false
    a.claimT = rand(2.5, 5)
  }
}

function computeResult() {
  const s = st.stats
  // alimentações (50) + precisão do combo (15) + centralização (10) + rainha saciada (25)
  const feedPart = Math.min(1, s.feeds / EXPECTED_FEEDS) * 50
  const perfectPart = s.feeds ? (s.perfect / s.feeds) * 10 : 0
  const accuracy = s.attempts ? Math.min(1, s.feeds / s.attempts) : 0
  const accPart = accuracy * 15
  const sated = st.t > 0 ? s.satedTime / st.t : 0
  const hungerPart = sated * 25 * clamp(1 - s.critTime / (SHIFT_DURATION * 0.4), 0, 1)
  const score = Math.round(clamp(feedPart + perfectPart + accPart + hungerPart, 0, 100))
  st.scoreParts = { feedPart, perfectPart, accPart, hungerPart }
  const crit = Math.round(s.critTime)
  const feeds = t('feedQueen.summary.feeds', { n: s.feeds })
  const critTxt = crit > 0 ? t('feedQueen.summary.crit', { s: crit }) : t('feedQueen.summary.noCrit')
  return { score, summary: t('feedQueen.summary', { feeds, crit: critTxt }) }
}

function exit() {
  st = null
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function render(context, ctx) {
  if (!st) return
  if (!ensureLayout(context)) return
  if (!st.attendants.length) initWorld()
  const L = st.L
  // o fundo tem texto ("câmara real"): refaz se o idioma mudar
  const dpr = context.renderer?.dpr || window.devicePixelRatio || 1
  if (!st.bg || st.bgLang !== getLang()) {
    st.bg = buildBackground(L, dpr)
    st.bgLang = getLang()
  }
  // sprites dependem da escala do layout e do DPR: refaz no resize/zoom
  if (st.spriteDpr !== dpr || st.spriteS !== L.S) {
    st.sprites.clear()
    st.spriteDpr = dpr
    st.spriteS = L.S
  }
  ctx.drawImage(st.bg, 0, 0, L.W, L.H)

  const q = st.queen
  drawScatterField(ctx)
  drawPotZones(ctx)
  drawCone(ctx)
  drawEggs(ctx)
  drawQueen(ctx)

  // abelhas ordenadas por y
  const pl = st.player
  const list = [...st.attendants, pl].sort((a, b) => a.y - b.y)
  for (const b of list) {
    if (b === pl) drawPlayer(ctx)
    else drawAttendant(ctx, b)
  }

  drawFx(ctx)
  drawWave(ctx)
  if (st.combo) drawComboUI(ctx)
  drawHUD(ctx, context.layout)

  if (st.ending != null) {
    ctx.save()
    ctx.globalAlpha = ease(st.ending / 1.3, 'easeInOutQuad') * 0.92
    ctx.fillStyle = P.paperCreamLight
    ctx.fillRect(0, 0, L.W, L.H)
    ctx.restore()
  }
  void q
  if (context.controls && context.layout && st.ending == null) context.controls.render(ctx, context.layout)
}

// Anel técnico com marcas de escala (onda do especial / limite da dispersão).
function tickedRing(ctx, x, y, r, { ticks = 72, long = 6, len = 5, width = 1, color = INK_LINE, alpha = 1, rot = 0 } = {}) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.stroke()
  ctx.lineWidth = Math.max(0.6, width * 0.8)
  ctx.beginPath()
  for (let i = 0; i < ticks; i++) {
    const a = rot + (i / ticks) * TAU
    const l = i % long === 0 ? len * 1.9 : len
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    ctx.lineTo(x + Math.cos(a) * (r - l), y + Math.sin(a) * (r - l))
  }
  ctx.stroke()
  ctx.restore()
}

function drawWave(ctx) {
  const w = st.wave
  if (!w) return
  const L = st.L
  const u = clamp(w.t / WAVE_DUR, 0, 1)
  const fade = w.t < WAVE_DUR ? 1 : clamp(1 - (w.t - WAVE_DUR) / 0.6, 0, 1)
  const r = lerp(pl0(), w.reach, ease(u, 'easeOutCubic'))
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(L.cx, L.cy, L.rx, L.ry, 0, 0, TAU)
  ctx.clip()
  // halo dourado suave atrás da frente da onda
  const g = ctx.createRadialGradient(w.x, w.y, Math.max(0, r - 38 * L.S), w.x, w.y, r)
  g.addColorStop(0, withAlpha(P.sunHalo, 0))
  g.addColorStop(1, withAlpha(P.sunHalo, 0.45 * fade))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(w.x, w.y, r, 0, TAU)
  ctx.fill()
  tickedRing(ctx, w.x, w.y, r, { ticks: 96, long: 8, len: 4 * L.S, width: 1.6, color: P.caterpillarGold, alpha: 0.95 * fade, rot: u * 0.4 })
  tickedRing(ctx, w.x, w.y, r * 0.82, { ticks: 48, long: 4, len: 3 * L.S, width: 0.8, alpha: 0.45 * fade, rot: -u * 0.3 })
  ctx.restore()
}
function pl0() {
  return st.player.r + 10 * st.L.S
}

// Enquanto o especial dura: arco de escala na borda da câmara (onde o séquito espera),
// que se consome com o tempo restante, e anéis finos sob as atendentes dispersadas.
function drawScatterField(ctx) {
  const m = st.meter
  const L = st.L
  const returning = st.attendants.some((a) => a.ghost > 0)
  if (!m.isActive && !returning) return
  const f = m.isActive ? 1 - m.activeProgress : 0
  const inAlpha = m.isActive ? clamp(m.activeProgress * 8, 0, 1) : 0
  ctx.save()
  if (m.isActive) {
    const rx = Math.max(0, L.rx - 5 * L.S)
    const ry = Math.max(0, L.ry - 5 * L.S)
    ctx.strokeStyle = P.caterpillarGold
    ctx.globalAlpha = 0.8 * inAlpha
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.ellipse(L.cx, L.cy, rx, ry, 0, -Math.PI / 2 - Math.PI * f, -Math.PI / 2 + Math.PI * f)
    ctx.stroke()
    ctx.strokeStyle = INK_LINE
    ctx.globalAlpha = 0.35 * inAlpha
    ctx.lineWidth = 0.8
    ctx.beginPath()
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU
      const l = (i % 8 === 0 ? 9 : 4) * L.S
      const c = Math.cos(a)
      const s = Math.sin(a)
      ctx.moveTo(L.cx + c * rx, L.cy + s * ry)
      ctx.lineTo(L.cx + c * Math.max(0, rx - l), L.cy + s * Math.max(0, ry - l))
    }
    ctx.stroke()
  }
  for (const a of st.attendants) {
    if (!(a.ghost > 0)) continue
    ctx.globalAlpha = 0.4 * Math.min(1, a.ghost) * (m.isActive ? inAlpha : 1)
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.arc(a.x, a.y, a.r + 5 * L.S, 0, TAU)
    ctx.stroke()
  }
  ctx.restore()
}

function drawPotZones(ctx) {
  const L = st.L
  const pl = st.player
  const need = 1 - pl.charge / MAX_CHARGE
  for (const cl of L.pots) {
    ctx.save()
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 1
    ctx.setLineDash([2, 5])
    ctx.lineDashOffset = -st.t * 6
    ctx.globalAlpha = 0.18 + 0.35 * need + (pl.refilling ? 0.25 : 0)
    ctx.beginPath()
    ctx.arc(cl.x, cl.y, cl.zoneR + 10 * L.S, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    // marcas de escala
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU
      const r0 = cl.zoneR + 10 * L.S
      const r1 = r0 + (i % 6 === 0 ? 6 : 3) * L.S
      ctx.beginPath()
      ctx.moveTo(cl.x + Math.cos(a) * r0, cl.y + Math.sin(a) * r0)
      ctx.lineTo(cl.x + Math.cos(a) * r1, cl.y + Math.sin(a) * r1)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawCone(ctx) {
  const L = st.L
  const q = st.queen
  const apex = queenApex()
  const { half, minD, maxD } = st.cone
  const open = st.window.isOpen
  const a0 = q.heading - half
  const a1 = q.heading + half
  const R = maxD
  ctx.save()
  // leve preenchimento quando posicionado
  if (st.inCone) {
    ctx.beginPath()
    ctx.moveTo(apex.x, apex.y)
    ctx.arc(apex.x, apex.y, R, a0, a1)
    ctx.closePath()
    ctx.fillStyle = withAlpha(P.leafSageHighlight, open ? 0.3 : 0.18)
    ctx.fill()
  }
  const col = open ? P.caterpillarGold : INK_LINE
  const alpha = open ? 0.85 : 0.3 + 0.35 * q.anticip
  ctx.strokeStyle = col
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1
  // raios laterais
  ctx.beginPath()
  ctx.moveTo(apex.x + Math.cos(a0) * minD, apex.y + Math.sin(a0) * minD)
  ctx.lineTo(apex.x + Math.cos(a0) * R, apex.y + Math.sin(a0) * R)
  ctx.moveTo(apex.x + Math.cos(a1) * minD, apex.y + Math.sin(a1) * minD)
  ctx.lineTo(apex.x + Math.cos(a1) * R, apex.y + Math.sin(a1) * R)
  ctx.stroke()
  // arco externo com marcas de transferidor
  ctx.lineWidth = open ? 1.6 : 1
  ctx.beginPath()
  ctx.arc(apex.x, apex.y, R, a0, a1)
  ctx.stroke()
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.arc(apex.x, apex.y, R * 0.55, a0, a1)
  ctx.stroke()
  const ticks = 12
  for (let i = 0; i <= ticks; i++) {
    const a = a0 + ((a1 - a0) * i) / ticks
    const tl = (i % 3 === 0 ? 7 : 3.5) * L.S
    ctx.beginPath()
    ctx.moveTo(apex.x + Math.cos(a) * R, apex.y + Math.sin(a) * R)
    ctx.lineTo(apex.x + Math.cos(a) * (R + tl), apex.y + Math.sin(a) * (R + tl))
    ctx.stroke()
  }
  // linha-guia pontilhada central
  ctx.setLineDash([2, 4])
  ctx.globalAlpha = alpha * 0.8
  ctx.beginPath()
  ctx.moveTo(apex.x, apex.y)
  ctx.lineTo(apex.x + Math.cos(q.heading) * (R + 14 * L.S), apex.y + Math.sin(q.heading) * (R + 14 * L.S))
  ctx.stroke()
  ctx.setLineDash([])
  // janela aberta: arco que se consome (tempo restante)
  if (open) {
    const f = windowFraction()
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 2.2
    ctx.strokeStyle = P.caterpillarGold
    const mid = q.heading
    ctx.beginPath()
    ctx.arc(apex.x, apex.y, R + 11 * L.S, mid - half * f, mid + half * f)
    ctx.stroke()
  }
  // marcador do jogador no transferidor
  if (Math.abs(st.coneAngle) < half * 1.8) {
    const pa = q.heading + clamp(st.coneAngle, -half * 1.8, half * 1.8)
    ctx.globalAlpha = st.inCone ? 0.9 : 0.35
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(apex.x + Math.cos(pa) * (R - 5 * L.S), apex.y + Math.sin(pa) * (R - 5 * L.S))
    ctx.lineTo(apex.x + Math.cos(pa) * (R + 5 * L.S), apex.y + Math.sin(pa) * (R + 5 * L.S))
    ctx.stroke()
  }
  ctx.restore()
}

function drawEggs(ctx) {
  const L = st.L
  for (const e of st.eggs) {
    const a = e.t < 0.4 ? e.t / 0.4 : clamp((5 - e.t) / 1.5, 0, 1)
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(e.x, e.y)
    ctx.rotate(e.rot)
    ctx.beginPath()
    ctx.ellipse(0, 0, 5 * L.S, 2.3 * L.S, 0, 0, TAU)
    ctx.fillStyle = P.caterpillarCream
    ctx.fill()
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// cache de sprites (rainha e séquito): desenhar bee.js/hachuras/estipulagem a cada
// frame custava milhares de chamadas de canvas. Os sprites são pré-renderizados em
// canvas offscreen no DPR atual e na escala do layout (st.sprites é limpo quando
// algum dos dois muda) e só transformados por frame.
// ---------------------------------------------------------------------------

const QUEEN_LEG_FRAMES = 12
const QUEEN_MOUTH_FRAMES = 9
const QUEEN_TILT_STEP = 0.03
const BEE_LEG_FRAMES = 8
const BEE_BREATH_FRAMES = 3
const BEE_WING_FRAMES = 4
const SPRITE_CACHE_MAX = 400 // teto de memória (~20 MB); o regime estável usa ~260

function bucket(v, step, n) {
  return ((Math.round(v / step) % n) + n) % n
}

// Sprite em coordenadas locais (CSS px): retângulo [x0, x0+w] x [y0, y0+h].
function makeSprite(key, x0, y0, w, h, draw) {
  let s = st.sprites.get(key)
  if (s) return s
  if (st.sprites.size >= SPRITE_CACHE_MAX) st.sprites.clear()
  const dpr = st.spriteDpr || 1
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w * dpr))
  c.height = Math.max(1, Math.ceil(h * dpr))
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr)
  draw(g)
  s = { c, x0, y0, w: c.width / dpr, h: c.height / dpr }
  st.sprites.set(key, s)
  return s
}

function blitSprite(ctx, s) {
  ctx.drawImage(s.c, s.x0, s.y0, s.w, s.h)
}

function queenAbdomenSprite() {
  const qs = st.L.qs
  const S = st.L.S
  const x0 = -60 * qs
  const y0 = -22 * qs
  const w = 66 * qs
  const h = 44 * qs
  const outline = queenAbdomenOutline(qs, 0, 777)
  const interior = makeSprite('qAbdIn', x0, y0, w, h, (g) => {
    g.beginPath()
    tracePath(g, outline, { closed: true, smooth: true })
    const ag = g.createLinearGradient(0, -16 * qs, 0, 16 * qs)
    ag.addColorStop(0, '#F3E6BD')
    ag.addColorStop(0.45, '#E6D29A')
    ag.addColorStop(1, '#BFA066')
    g.fillStyle = ag
    g.fill()
    g.save()
    g.clip()
    // tergitos: placas escuras separadas pela membrana esticada
    const tergites = [-5.5, -13.5, -22.5, -31.5, -40, -47.5]
    tergites.forEach((sx, i) => {
      const hr = abdomenHalf(sx) * 0.74 * qs
      const tw = (3.4 - i * 0.2) * qs
      g.beginPath()
      g.moveTo(sx * qs - tw / 2, -hr)
      g.quadraticCurveTo(sx * qs + tw * 0.2, -hr * 1.08, sx * qs + tw / 2, -hr * 0.92)
      g.quadraticCurveTo(sx * qs + tw * 0.9, 0, sx * qs + tw / 2, hr * 0.92)
      g.quadraticCurveTo(sx * qs + tw * 0.2, hr * 1.08, sx * qs - tw / 2, hr)
      g.quadraticCurveTo(sx * qs - tw * 0.1, 0, sx * qs - tw / 2, -hr)
      g.closePath()
      g.fillStyle = '#6A4E2E'
      g.globalAlpha = 0.8
      g.fill()
      g.globalAlpha = 1
      // linha intersegmental na membrana
      g.beginPath()
      g.moveTo((sx - 4.2) * qs, -abdomenHalf(sx - 4.2) * qs)
      g.quadraticCurveTo((sx - 3.2) * qs, 0, (sx - 4.2) * qs, abdomenHalf(sx - 4.2) * qs)
      g.strokeStyle = withAlpha('#8A6626', 0.3)
      g.lineWidth = 0.7
      g.stroke()
    })
    drawHatching(g, { x: -55 * qs, y: -17 * qs, width: 56 * qs, height: 34 * qs }, {
      angle: Math.PI / 2,
      lineCount: 58,
      color: '#5C4419',
      opacityRange: [0.07, 0.17],
      seed: 781,
      curveAmount: 5 * qs,
      segments: 6,
    })
    drawStipple(g, { x: -55 * qs, y: -17 * qs, width: 56 * qs, height: 34 * qs }, {
      color: '#3B2C10',
      count: 240,
      seed: 782,
      radius: [0.35, 1],
      opacity: [0.07, 0.18],
      densityBias: (u, v) => v * v,
    })
    // brilho de cutícula
    g.strokeStyle = withAlpha(P.paperCreamLight, 0.55)
    g.lineWidth = 2.2 * S
    g.beginPath()
    g.moveTo(-8 * qs, -9.5 * qs)
    g.quadraticCurveTo(-25 * qs, -13.5 * qs, -42 * qs, -8.5 * qs)
    g.stroke()
    g.restore()
  })
  // opacidade base embutida (segmentos sobrepostos somam alfa nas juntas); o brilho
  // variável entra como globalAlpha uniforme no blit
  const glow = makeSprite('qAbdGlow', x0, y0, w, h, (g) => {
    strokeHandDrawn(g, outline, { color: P.sunGold, baseWidth: 3.2 * S, widthJitter: 0.4, closed: true, seed: 790, opacity: 0.5 })
  })
  const ink = makeSprite('qAbdInk', x0, y0, w, h, (g) => {
    strokeHandDrawn(g, outline, { color: INK_LINE, baseWidth: 1.9, widthJitter: 0.5, closed: true, seed: 791, opacity: 0.9 })
  })
  return { outline, interior, glow, ink }
}

function queenHeadSprite(li, mi, ti) {
  const hts = st.L.qs * 0.95
  return makeSprite(`qHead:${li}:${mi}:${ti}`, -1.3 * hts, -20 * hts, 27 * hts, 40 * hts, (g) => {
    g.beginPath()
    g.rect(-1.3 * hts, -40 * hts, 80 * hts, 80 * hts)
    g.clip()
    const pose = createIdlePose(0, 0, { t: 0, colorVariant: 'young', scale: hts, rotation: 0, seed: 1234 })
    pose.wingAngle = 0 // asas próprias (queenWing) - as de bee.js ficam fechadas e recortadas
    pose.legPhase = (li * TAU) / QUEEN_LEG_FRAMES
    pose.mouthOpen = mi / (QUEEN_MOUTH_FRAMES - 1)
    pose.headTilt = ti * QUEEN_TILT_STEP
    pose.breathPhase = 0 // só afeta o abdômen de bee.js, que fica recortado
    drawBeeBody(g, pose)
  })
}

// Abelha do séquito na origem, rotação 0 (a rotação é aplicada no blit).
function attendantSprite(a, li, bi, wi, mouth) {
  const ws = st.L.ws
  const key = `bee:${a.seed}:${a.variant}:${li}:${bi}:${wi}:${mouth ? 1 : 0}`
  return makeSprite(key, -23 * ws, -19 * ws, 46 * ws, 38 * ws, (g) => {
    const pose = createIdlePose(0, 0, { t: 0, colorVariant: a.variant, scale: ws, rotation: 0, seed: a.seed })
    pose.wingAngle = wi === 0 ? 0.05 : (wi / (BEE_WING_FRAMES - 1)) * 0.25
    pose.legPhase = (li * TAU) / BEE_LEG_FRAMES
    pose.breathPhase = (bi / (BEE_BREATH_FRAMES - 1)) * 2 - 1
    pose.headTilt = 0
    if (mouth) pose.mouthOpen = 0.5
    drawBeeBody(g, pose)
  })
}

// Operária do jogador (frames em cache, como o séquito).
const PLAYER_PULSE_FRAMES = 12
const PLAYER_CARRY_LEVELS = 8
function playerSprite() {
  const pl = st.player
  const ws = st.L.ws
  const box = (key, build) => makeSprite(key, -23 * ws, -19 * ws, 46 * ws, 38 * ws, (g) => drawBeeBody(g, build()))
  if (st.combo) {
    const lt = st.t * 0.4 // legPhase de createRegurgitatePose
    const li = bucket(lt, TAU / BEE_LEG_FRAMES, BEE_LEG_FRAMES)
    const pi = bucket(st.t * 4, TAU / PLAYER_PULSE_FRAMES, PLAYER_PULSE_FRAMES) // pulso = sin(4t)
    return box(`pl:r:${li}:${pi}`, () => {
      const pose = createRegurgitatePose(0, 0, (pi * TAU) / PLAYER_PULSE_FRAMES / 4, { colorVariant: 'young', scale: ws, rotation: 0, seed: 42 })
      pose.headTilt = 0.1
      pose.legPhase = (li * TAU) / BEE_LEG_FRAMES
      return pose
    })
  }
  const li = bucket(pl.legPhase, TAU / BEE_LEG_FRAMES, BEE_LEG_FRAMES)
  const bi = Math.round(((Math.sin(st.t * 1.6) + 1) / 2) * (BEE_BREATH_FRAMES - 1))
  const ci = pl.charge > 0.15 ? 1 + Math.round(clamp(pl.charge / MAX_CHARGE, 0, 1) * (PLAYER_CARRY_LEVELS - 1)) : 0
  return box(`pl:i:${li}:${bi}:${ci}`, () => {
    const pose = createIdlePose(0, 0, { t: 0, colorVariant: 'young', scale: ws, rotation: 0, seed: 42 })
    pose.legPhase = (li * TAU) / BEE_LEG_FRAMES
    pose.breathPhase = (bi / (BEE_BREATH_FRAMES - 1)) * 2 - 1
    pose.headTilt = 0
    if (ci > 0) pose.carrying = { type: 'nectar', amount: 0.6 + ((ci - 1) / (PLAYER_CARRY_LEVELS - 1)) * 0.7 }
    return pose
  })
}

function queenAbdomenOutline(qs, breath, seed) {
  const rng = seededRandom(seed)
  const top = []
  const bottom = []
  for (const { x, r } of QUEEN_ABDOMEN) {
    const rr = r * (1 + breath * 0.035) * (1 + (rng() - 0.5) * 0.04)
    top.push({ x: x * qs, y: -rr * qs })
    bottom.push({ x: x * qs, y: rr * qs })
  }
  return top.concat(bottom.reverse())
}

function abdomenHalf(x) {
  const A = QUEEN_ABDOMEN
  for (let i = 0; i < A.length - 1; i++) {
    const a = A[i]
    const b = A[i + 1]
    if (x <= a.x && x >= b.x) return a.r + (b.r - a.r) * ((x - a.x) / (b.x - a.x))
  }
  return 1
}

function drawQueen(ctx) {
  const L = st.L
  const q = st.queen
  const qs = L.qs
  const t = st.t
  const breath = Math.sin(t * 1.1)
  const glow = clamp(q.glow + q.fedGlow * 0.6, 0, 1.3)

  ctx.save()
  ctx.translate(q.x, q.y)
  ctx.rotate(q.heading)

  // halo dourado (esmaece com a fome)
  if (glow > 0.02) {
    const gx = -22 * qs
    const gr = ctx.createRadialGradient(gx, 0, 4 * qs, gx, 0, 62 * qs)
    gr.addColorStop(0, withAlpha(P.sunHalo, 0.75 * Math.min(1, glow)))
    gr.addColorStop(0.5, withAlpha(P.sunHalo, 0.3 * Math.min(1, glow)))
    gr.addColorStop(1, withAlpha(P.sunHalo, 0))
    ctx.fillStyle = gr
    ctx.beginPath()
    ctx.ellipse(gx, 0, 66 * qs, 44 * qs, 0, 0, TAU)
    ctx.fill()
  }
  // sombra de contato
  ctx.save()
  ctx.fillStyle = 'rgba(43, 36, 24, 0.14)'
  ctx.beginPath()
  ctx.ellipse(-20 * qs, 3 * qs, 36 * qs, 17 * qs, 0, 0, TAU)
  ctx.fill()
  ctx.restore()

  // pernas (dos dois lados, vista dorsal)
  const legHips = [6, 3, 0]
  for (const side of [-1, 1]) {
    legHips.forEach((hx, i) => {
      const ph = q.legPhase + i * 2.1 + (side > 0 ? Math.PI : 0)
      const sw = Math.sin(ph) * 1.6 * (0.3 + q.walk)
      const spread = (1 - i) * 7
      const pts = [
        { x: hx * qs, y: side * 4.5 * qs },
        { x: (hx + spread * 0.45 + sw * 0.5) * qs, y: side * 9.5 * qs },
        { x: (hx + spread * 0.95 + sw) * qs, y: side * 13.5 * qs },
      ]
      strokeHandDrawn(ctx, pts, { color: '#5A4530', baseWidth: 1.5, widthJitter: 0.3, seed: 900 + i * 3 + side, opacity: 0.9 })
    })
  }

  // abdômen fisogástrico (textura estática em cache; a respiração só estica em y,
  // exatamente como queenAbdomenOutline faz com o contorno)
  const abd = queenAbdomenSprite()
  const by = 1 + breath * 0.035
  ctx.save()
  ctx.scale(1, by)
  blitSprite(ctx, abd.interior)
  // fome crítica: cutícula acinzentada
  if (q.glow < 0.5) {
    ctx.beginPath()
    tracePath(ctx, abd.outline, { closed: true, smooth: true })
    ctx.fillStyle = withAlpha('#8C8574', (0.5 - q.glow) * 0.55)
    ctx.fill()
  }
  if (glow > 0.05) {
    ctx.globalAlpha = Math.min(1, glow)
    blitSprite(ctx, abd.glow)
    ctx.globalAlpha = 1
  }
  blitSprite(ctx, abd.ink)
  ctx.restore()

  // cabeça + tórax (bee.js), abdômen original recortado - frames em cache
  const twitch = (q.anticip || 0) * Math.sin(t * 38) * 0.06
  const li = bucket(q.legPhase, TAU / QUEEN_LEG_FRAMES, QUEEN_LEG_FRAMES)
  const mi = Math.round(clamp(q.mouth, 0, 1) * (QUEEN_MOUTH_FRAMES - 1))
  const ti = clamp(Math.round((Math.sin(t * 0.5) * 0.04 + twitch) / QUEEN_TILT_STEP), -3, 3)
  blitSprite(ctx, queenHeadSprite(li, mi, ti))

  // asas curtas sobre o abdômen dilatado
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(2 * qs, side * 2.6 * qs)
    ctx.scale(1, side)
    ctx.rotate(Math.PI - 0.2 + Math.sin(t * 0.8) * 0.015)
    queenWing(ctx, 25 * qs, 6.5 * qs)
    ctx.rotate(0.2)
    queenWing(ctx, 18 * qs, 4.4 * qs)
    ctx.restore()
  }

  ctx.restore()
}

function queenWing(ctx, len, wid) {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(len * 0.45, -wid, len, -wid * 0.15)
  ctx.quadraticCurveTo(len * 0.6, wid * 0.7, 0, 0)
  ctx.closePath()
  ctx.fillStyle = 'rgba(240, 231, 205, 0.38)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(43, 36, 24, 0.45)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(len * 0.5, -wid * 0.45, len * 0.88, -wid * 0.1)
  ctx.moveTo(len * 0.18, -wid * 0.1)
  ctx.lineTo(len * 0.55, wid * 0.25)
  ctx.moveTo(len * 0.35, -wid * 0.5)
  ctx.lineTo(len * 0.6, -wid * 0.1)
  ctx.strokeStyle = 'rgba(43, 36, 24, 0.28)'
  ctx.lineWidth = 0.55
  ctx.stroke()
}

function drawAttendant(ctx, a) {
  const li = bucket(a.legPhase, TAU / BEE_LEG_FRAMES, BEE_LEG_FRAMES)
  const breath = Math.sin((st.t + a.seed) * 1.6)
  const bi = Math.round(((breath + 1) / 2) * (BEE_BREATH_FRAMES - 1))
  const wi = a.shoving > 0 ? Math.round(Math.abs(Math.sin(st.t * 30)) * (BEE_WING_FRAMES - 1)) : 0
  const spr = attendantSprite(a, li, bi, wi, a.rushing && !a.claiming)
  ctx.save()
  ctx.translate(a.x, a.y)
  ctx.rotate(a.facing)
  blitSprite(ctx, spr)
  ctx.restore()
}

function drawPlayer(ctx) {
  const L = st.L
  const pl = st.player
  // anel de identificação (instrumento): círculo fino com marcas cardeais
  ctx.save()
  ctx.strokeStyle = P.leafSageShadow
  ctx.globalAlpha = 0.75
  ctx.lineWidth = 1.1
  const rr = pl.r + 9 * L.S
  ctx.beginPath()
  ctx.arc(pl.x, pl.y, rr, 0, TAU)
  ctx.stroke()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + st.t * 0.2
    const l = (i % 2 === 0 ? 5 : 2.5) * L.S
    ctx.beginPath()
    ctx.moveTo(pl.x + Math.cos(a) * rr, pl.y + Math.sin(a) * rr)
    ctx.lineTo(pl.x + Math.cos(a) * (rr + l), pl.y + Math.sin(a) * (rr + l))
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.translate(pl.x, pl.y)
  ctx.rotate(pl.facing)
  blitSprite(ctx, playerSprite())
  ctx.restore()

  // gotas de carga (arco técnico acima-esquerda)
  const base = -Math.PI * 0.82
  for (let i = 0; i < MAX_CHARGE; i++) {
    const a = base + i * 0.36
    const R = rr + 12 * L.S
    const x = pl.x + Math.cos(a) * R
    const y = pl.y + Math.sin(a) * R
    const fill = clamp(pl.charge - i, 0, 1)
    const r = 4.2 * L.S
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(x, y - r * 1.5)
    ctx.quadraticCurveTo(x + r, y - r * 0.2, x + r, y + r * 0.3)
    ctx.arc(x, y + r * 0.3, r, 0, Math.PI)
    ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.5)
    ctx.closePath()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = P.sunGold
    ctx.globalAlpha = 0.95
    ctx.fillRect(x - r, y + r * 1.3 - fill * r * 2.8, r * 2, fill * r * 2.8)
    ctx.restore()
    ctx.strokeStyle = INK_LINE
    ctx.globalAlpha = 0.8
    ctx.lineWidth = 0.9
    ctx.stroke()
    ctx.restore()
  }
}

function drawChevron(ctx, x, y, r, dir) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(DIR_ANGLE[dir])
  ctx.beginPath()
  ctx.moveTo(-r * 0.28, -r * 0.45)
  ctx.lineTo(r * 0.32, 0)
  ctx.lineTo(-r * 0.28, r * 0.45)
  ctx.stroke()
  ctx.restore()
}

function drawComboUI(ctx) {
  const L = st.L
  const pl = st.player
  const c = st.combo
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // sequência (só visual; entrada pelos direcionais/setas): arco de transferidor
  // do lado da operária oposto à cabeça da rainha, mantido dentro do campo.
  const n = c.seq.length
  const gr = Math.max(14, 13 * L.S)
  const R = Math.max(70 * L.S, gr * 5.2)
  const step = Math.min(0.42, 1.9 / n, (gr * 2.5) / R)
  const apex = queenApex()
  const mid = Math.atan2(pl.y - apex.y, pl.x - apex.x)
  const a0 = mid - (step * (n - 1)) / 2
  // centro deslocado para caber no playfield
  let ox = pl.x
  let oy = pl.y
  const pf = L.pf
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const a = a0 + step * i
    minX = Math.min(minX, Math.cos(a) * R - gr)
    maxX = Math.max(maxX, Math.cos(a) * R + gr)
    minY = Math.min(minY, Math.sin(a) * R - gr)
    maxY = Math.max(maxY, Math.sin(a) * R + gr)
  }
  const m = 6
  if (ox + minX < pf.x + m) ox = pf.x + m - minX
  if (ox + maxX > pf.x + pf.w - m) ox = pf.x + pf.w - m - maxX
  if (oy + minY < pf.y + m) oy = pf.y + m - minY
  if (oy + maxY > pf.y + pf.h - m) oy = pf.y + pf.h - m - maxY

  ctx.globalAlpha = 0.5
  ctx.strokeStyle = INK_LINE
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.arc(ox, oy, R, a0 - step * 0.6, a0 + step * (n - 1) + step * 0.6)
  ctx.stroke()
  // tempo restante da boca aberta
  const f = windowFraction()
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = P.caterpillarGold
  ctx.lineWidth = 2.4
  const span = step * (n - 1) + step * 1.2
  ctx.beginPath()
  ctx.arc(ox, oy, R + gr + 6 * L.S, mid - (span / 2) * f, mid + (span / 2) * f)
  ctx.stroke()

  for (let i = 0; i < n; i++) {
    const a = a0 + step * i
    const x = ox + Math.cos(a) * R
    const y = oy + Math.sin(a) * R
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x, y, gr, 0, TAU)
    if (i < c.idx) {
      ctx.fillStyle = P.caterpillarGold
      ctx.fill()
      ctx.strokeStyle = INK_LINE
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.lineWidth = 1.5
      drawChevron(ctx, x, y, gr, c.seq[i])
    } else if (i === c.idx) {
      const pulse = 1 + (c.flash > 0 ? c.flash * 1.2 : Math.sin(st.t * 10) * 0.05)
      ctx.fillStyle = P.sunHalo
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, gr * pulse + 3, 0, TAU)
      ctx.strokeStyle = P.caterpillarGold // próximo gesto (accentPink fica só no especial pronto)
      ctx.lineWidth = 2.6
      ctx.stroke()
      ctx.strokeStyle = INK_LINE
      ctx.lineWidth = 2
      drawChevron(ctx, x, y, gr * 1.1, c.seq[i])
    } else {
      ctx.fillStyle = withAlpha(P.paperCreamLight, 0.85)
      ctx.fill()
      ctx.strokeStyle = INK_LINE
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 0.9
      ctx.stroke()
      ctx.lineWidth = 1.3
      drawChevron(ctx, x, y, gr, c.seq[i])
    }
    // marca de escala sob cada glifo
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = INK_LINE
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(ox + Math.cos(a) * (R - gr - 2), oy + Math.sin(a) * (R - gr - 2))
    ctx.lineTo(ox + Math.cos(a) * (R - gr - 7 * L.S), oy + Math.sin(a) * (R - gr - 7 * L.S))
    ctx.stroke()
  }
  ctx.restore()
}

function drawFx(ctx) {
  const L = st.L
  for (const f of st.fx) {
    if (f.t < 0) continue
    const u = f.t / f.dur
    ctx.save()
    if (f.type === 'ring') {
      ctx.strokeStyle = f.color
      ctx.globalAlpha = (1 - u) * 0.8
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(f.x, f.y, lerp(f.r0, f.r1, ease(u, 'easeOutCubic')), 0, TAU)
      ctx.stroke()
    } else if (f.type === 'drop') {
      ctx.fillStyle = P.sunGold
      ctx.globalAlpha = (1 - u) * 0.9
      ctx.beginPath()
      ctx.arc(f.x, f.y, 2.2 * L.S, 0, TAU)
      ctx.fill()
    } else if (f.type === 'cross') {
      ctx.globalAlpha = 1 - u
      const s = 7 * L.S
      strokeHandDrawn(ctx, [{ x: f.x - s, y: f.y - s }, { x: f.x + s, y: f.y + s }], { baseWidth: 2, seed: 5 })
      strokeHandDrawn(ctx, [{ x: f.x + s, y: f.y - s }, { x: f.x - s, y: f.y + s }], { baseWidth: 2, seed: 6 })
    }
    ctx.restore()
  }
}

function drawHUD(ctx, layout) {
  const L = st.L
  const hb = layout?.hudBar || { x: 0, y: 0, w: L.W, h: 50 }
  const S = clamp(layout?.uiScale || 1, 0.85, 1.4)
  const R = clamp(hb.h - 14 * S - 10, 16, 34)
  const hx = hb.x + 12 + R + 12 * S
  const hy = hb.y + hb.h - 6
  const h = st.hunger
  const v = h.value / h.max
  const crit = h.state === 'critical'

  ctx.save()
  ctx.lineCap = 'round'
  // setores do mostrador de fome
  const A0 = Math.PI
  const arcAt = (u) => A0 + u * Math.PI
  ctx.lineWidth = 4.5 * S
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = P.leafSage
  ctx.beginPath()
  ctx.arc(hx, hy, R, arcAt(0), arcAt(0.5))
  ctx.stroke()
  ctx.strokeStyle = P.caterpillarGold
  ctx.beginPath()
  ctx.arc(hx, hy, R, arcAt(0.5), arcAt(0.75))
  ctx.stroke()
  ctx.strokeStyle = INK_LINE
  ctx.globalAlpha = crit ? 0.55 + 0.25 * Math.sin(st.t * 8) : 0.35
  ctx.beginPath()
  ctx.arc(hx, hy, R, arcAt(0.75), arcAt(1))
  ctx.stroke()
  // escala
  ctx.lineWidth = 0.9
  ctx.strokeStyle = INK_LINE
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  ctx.arc(hx, hy, R + 4 * S, A0, A0 + Math.PI)
  ctx.stroke()
  for (let i = 0; i <= 20; i++) {
    const a = arcAt(i / 20)
    const l = (i % 5 === 0 ? 6 : 3) * S
    ctx.beginPath()
    ctx.moveTo(hx + Math.cos(a) * (R + 4 * S), hy + Math.sin(a) * (R + 4 * S))
    ctx.lineTo(hx + Math.cos(a) * (R + 4 * S + l), hy + Math.sin(a) * (R + 4 * S + l))
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(hx - R - 8 * S, hy)
  ctx.lineTo(hx + R + 8 * S, hy)
  ctx.stroke()
  // ponteiro
  const wob = crit ? Math.sin(st.t * 23) * 0.025 : 0
  const na = arcAt(v) + wob
  ctx.globalAlpha = 1
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx + Math.cos(na) * (R + 2 * S), hy + Math.sin(na) * (R + 2 * S))
  ctx.stroke()
  ctx.fillStyle = INK_LINE
  ctx.beginPath()
  ctx.arc(hx, hy, 2.6 * S, 0, TAU)
  ctx.fill()

  const fontS = Math.round(clamp(12 * S, 11, 16))
  ctx.font = `italic ${fontS}px Georgia, serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = 0.8
  const tx = hx + R + 16 * S
  const midY = hb.y + hb.h / 2
  const hungerLabel = t('feedQueen.hunger')
  ctx.fillText(hungerLabel, tx, midY - 4)

  // tally de alimentações (marcas de caderno de campo) + ovos
  const ty = hb.y + hb.h - 6
  const fe = st.stats.feeds
  ctx.globalAlpha = 0.9
  for (let i = 0; i < fe; i++) {
    const grp = Math.floor(i / 5)
    const k = i % 5
    const gx = tx + grp * 26 * S
    if (k < 4) {
      strokeHandDrawn(ctx, [{ x: gx + k * 5 * S, y: ty - 11 * S }, { x: gx + k * 5 * S + 1, y: ty }], { baseWidth: 1.4, seed: 60 + i })
    } else {
      strokeHandDrawn(ctx, [{ x: gx - 2 * S, y: ty - 2 * S }, { x: gx + 18 * S, y: ty - 9 * S }], { baseWidth: 1.4, seed: 60 + i })
    }
  }
  // ovos postos (à direita do título)
  const ex = tx + ctx.measureText(hungerLabel).width + 16 * S
  const ey = midY - 4
  ctx.globalAlpha = st.queen.glow < 0.2 ? 0.4 : 0.85
  ctx.beginPath()
  ctx.ellipse(ex, ey - 4 * S, 5 * S, 2.4 * S, -0.5, 0, TAU)
  ctx.fillStyle = P.caterpillarCream
  ctx.fill()
  ctx.strokeStyle = INK_LINE
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.fillStyle = INK_LINE
  ctx.fillText(`× ${st.stats.eggs}`, ex + 9 * S, ey)

  // relógio do turno (canto direito)
  const cr = clamp(hb.h * 0.28, 11, 20)
  const cxr = hb.x + hb.w - 16 - cr
  const cyr = hb.y + hb.h / 2 + 2
  const rem = clamp(1 - st.t / SHIFT_DURATION, 0, 1)
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = INK_LINE
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.arc(cxr, cyr, cr, 0, TAU)
  ctx.stroke()
  ctx.globalAlpha = 0.85
  ctx.strokeStyle = P.leafSageShadow
  ctx.lineWidth = 3 * S
  ctx.beginPath()
  ctx.arc(cxr, cyr, cr, -Math.PI / 2, -Math.PI / 2 + TAU * rem)
  ctx.stroke()
  ctx.strokeStyle = INK_LINE
  ctx.lineWidth = 0.9
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * TAU
    ctx.beginPath()
    ctx.moveTo(cxr + Math.cos(a) * (cr + 3 * S), cyr + Math.sin(a) * (cr + 3 * S))
    ctx.lineTo(cxr + Math.cos(a) * (cr + (i % 7 === 0 ? 9 : 6) * S), cyr + Math.sin(a) * (cr + (i % 7 === 0 ? 9 : 6) * S))
    ctx.stroke()
  }
  const ha = -Math.PI / 2 + TAU * rem
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(cxr, cyr)
  ctx.lineTo(cxr + Math.cos(ha) * cr * 0.8, cyr + Math.sin(ha) * cr * 0.8)
  ctx.stroke()
  ctx.restore()
}

export default {
  id: 'feedQueen',
  enter,
  update,
  render,
  exit,
  __st: () => st, // inspeção/simulação headless
}
