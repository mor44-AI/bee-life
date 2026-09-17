// Tarefa: LIMPEZA - navegação + interceptação por reflexo no interior lotado da colmeia.
//
// A operária jovem recolhe detritos (cria morta, restos de cera) do favo e os
// leva até a entrada, desviando do trânsito das companheiras (colidir carregando
// = pode derrubar a carga). Larvas de traça-de-cera surgem em células, fogem de
// forma errática e roem o favo enquanto vivas (dano visível e crescente).
//
// Controles (via context.controls - celular e PC):
//   mover   = arrastar o dedo/mouse (a abelha segue) ou WASD/setas.
//   Ação    = botão AÇÃO / Espaço: sem carga = investida curta rumo ao alvo mais
//             próximo; com carga = largar o detrito. Tocar numa traça = investida nela.
//   Especial "Resina" = botão / E / Shift: onda de resina que embalsama as traças
//             (imóveis e sem roer o favo por ~6 s).
//   Pegar detrito / capturar larva = encostar.
//
// Mundo em coordenadas CANÔNICAS (entrada à esquerda, favo se estendendo para a
// direita). No retrato (design principal) o mundo é girado 90° para caber em
// context.layout.playfield com a entrada no topo; em paisagem fica centralizado.
//
// Dificuldade: data.difficulty (0-1) é a fonte da verdade entre turnos; dentro do
// turno usa inShiftRamp (primeiros ~10 s tranquilos).

import { create as createMovement } from '../../engine/MovementController.js'
import { create as createSpawner } from '../../engine/PatternSpawner.js'
import { create as createGauge } from '../../engine/Gauge.js'
import { create as createMeter } from '../../engine/SpecialMeter.js'
import { ease } from '../../engine/tween.js'
import { createFlightPose, createCarryingPose, drawBeeBody } from '../../art/bee.js'
import { drawHiveInterior, drawComb } from '../../art/hive.js'
import { createWaxMothLarvaPose, drawWaxMothLarva } from '../../art/creatures.js'
import {
  seededRandom,
  seedFromString,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  polygonPoints,
  tracePath,
  withAlpha,
  INK_LINE,
} from '../../art/textureUtils.js'
import { styleGuide } from '../../data/styleGuide.js'
import { config, difficultyFor, inShiftRamp } from '../../data/config.js'

const PAL = styleGuide.palettes.naturalist
const TAU = Math.PI * 2
const SHIFT_DURATION = config.shiftDuration
const END_FADE = 1.5
const RESIN_DURATION = 6
const WAVE_EXPAND = 0.9
const WAVE_LIFE = 1.7
const DASH_CD = 0.65

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const rand = (a, b) => a + Math.random() * (b - a)
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)
const expLerp = (rate, dt) => 1 - Math.exp(-rate * dt)
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI
  return a + d * t
}
function makeCanvas(w, h, dpr) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { canvas: c, g }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

let st = null

function dprNow() {
  return (typeof window !== 'undefined' && window.devicePixelRatio) || 1
}

// ---------------------------------------------------------------------------
// Vista: playfield (tela) <-> mundo canônico
// ---------------------------------------------------------------------------

function computeView(context) {
  const lay = context.layout
  const pf = { ...lay.playfield }
  const portrait = lay.orientation === 'portrait'
  // Garante que nenhum botão virtual cubra o mundo (por padrão eles já ficam fora).
  const buttons = context.controls?.getButtons ? context.controls.getButtons(lay) : []
  for (const b of buttons) {
    const inX = b.x + b.r > pf.x && b.x - b.r < pf.x + pf.w
    const inY = b.y + b.r > pf.y && b.y - b.r < pf.y + pf.h
    if (!inX || !inY) continue
    if (portrait) {
      const h = b.y - b.r - 6 - pf.y
      if (h > pf.h * 0.6) pf.h = h
    } else {
      const w = b.x - b.r - 6 - pf.x
      if (w > pf.w * 0.6) pf.w = w
    }
  }
  const Wc = portrait ? pf.h : pf.w
  const Hc = portrait ? pf.w : pf.h
  return {
    portrait,
    pf,
    Wc,
    Hc,
    rot: portrait ? Math.PI / 2 : 0,
    key: `${lay.width}x${lay.height}|${pf.x},${pf.y},${pf.w},${pf.h}|${portrait}`,
    screenW: lay.width,
    screenH: lay.height,
  }
}

function applyView(ctx) {
  const v = st.view
  if (v.portrait) {
    ctx.translate(v.pf.x + v.pf.w, v.pf.y)
    ctx.rotate(Math.PI / 2)
  } else {
    ctx.translate(v.pf.x, v.pf.y)
  }
}

function toCanon(sx, sy) {
  const v = st.view
  return v.portrait ? { x: sy - v.pf.y, y: v.pf.x + v.pf.w - sx } : { x: sx - v.pf.x, y: sy - v.pf.y }
}

function toScreen(x, y) {
  const v = st.view
  return v.portrait ? { x: v.pf.x + v.pf.w - y, y: v.pf.y + x } : { x: v.pf.x + x, y: v.pf.y + y }
}

function vecToCanon(vx, vy) {
  return st.view.portrait ? { x: vy, y: -vx } : { x: vx, y: vy }
}

// ---------------------------------------------------------------------------
// Layout canônico
// ---------------------------------------------------------------------------

function buildLayout(W, H) {
  const S = clamp(Math.min(W, H) / 600, 0.6, 1.6)
  const disc = { cx: W * 0.545, cy: H * 0.5, rx: W * 0.455, ry: H * 0.46 }
  const entrance = { x: Math.max(26 * S, W * 0.032), y: H * 0.5 }
  return {
    W, H, S,
    disc,
    entrance,
    margin: Math.round(90 * S),
    bounds: { x: 14 * S, y: 16 * S, width: W - 28 * S, height: H - 32 * S },
    loops: buildLoops(W, H, disc),
    lanes: buildLanes(W, H, entrance, S),
  }
}

function buildLoops(W, H, disc) {
  const defs = [
    { f: 0.2, ox: 0.02, dir: 1 },
    { f: 0.46, ox: -0.01, dir: -1 },
    { f: 0.74, ox: 0.02, dir: 1 },
  ]
  return defs.map((d, k) => {
    const rng = seededRandom(400 + k)
    const ph1 = rng() * TAU
    const ph2 = rng() * TAU
    const pts = []
    const N = 80
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const wob = 1 + Math.sin(a * 3 + ph1) * 0.1 + Math.sin(a * 5 + ph2) * 0.05
      pts.push({
        x: disc.cx + W * d.ox + Math.cos(a) * disc.rx * d.f * wob,
        y: disc.cy + Math.sin(a) * disc.ry * d.f * wob * 1.02,
      })
    }
    const cum = [0]
    for (let i = 1; i <= N; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i % N]
      cum.push(cum[i - 1] + dist(p0.x, p0.y, p1.x, p1.y))
    }
    return { pts, cum, length: cum[N], dir: d.dir }
  })
}

function loopPoint(loop, s) {
  const L = loop.length
  let d = ((s % L) + L) % L
  const { pts, cum } = loop
  let i = 0
  while (i < pts.length - 1 && cum[i + 1] < d) i++
  const p0 = pts[i]
  const p1 = pts[(i + 1) % pts.length]
  const seg = cum[i + 1] - cum[i] || 1
  const t = (d - cum[i]) / seg
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
}

function buildLanes(W, H, E, S) {
  const p = (fx, fy) => ({ x: W * fx, y: H * fy })
  const inA = { x: E.x + 8 * S, y: E.y - 10 * S }
  const inB = { x: E.x + 8 * S, y: E.y + 10 * S }
  return [
    [inA, p(0.17, 0.4), p(0.33, 0.24), p(0.52, 0.17), p(0.66, 0.3), p(0.5, 0.42), p(0.28, 0.46), p(0.12, 0.49), inA],
    [inB, p(0.19, 0.62), p(0.36, 0.78), p(0.58, 0.84), p(0.75, 0.68), p(0.56, 0.58), p(0.3, 0.54), p(0.12, 0.51), inB],
  ]
}

// ---------------------------------------------------------------------------
// Camadas estáticas (pré-renderizadas)
// ---------------------------------------------------------------------------

// Fundo da tela inteira (vaza para HUD/controles), em coordenadas de tela.
function buildBackdrop(W, H, dpr) {
  const { canvas, g } = makeCanvas(W, H, dpr)
  drawHiveInterior(g, { width: W, height: H, backgroundSeed: 31, combs: [] })
  return canvas
}

// Favo + invólucro + entrada, em coordenadas canônicas com margem M em volta
// (o invólucro se dissolve no fundo em vez de ser cortado na borda do playfield).
function buildBackground(L, dpr) {
  const { W, H, S, disc, entrance: E, margin: M } = L
  const { canvas, g } = makeCanvas(W + M * 2, H + M * 2, dpr)
  g.translate(M, M)

  // Invólucro: lâminas de cerume concêntricas em volta do disco de cria.
  for (let i = 6; i >= 1; i--) {
    const pts = polygonPoints(disc.cx, disc.cy, disc.rx + i * 11 * S, disc.ry + i * 10 * S, 56, {
      jitter: 0.018,
      seed: 120 + i,
    })
    g.save()
    g.beginPath()
    tracePath(g, pts, { closed: true, smooth: true })
    g.fillStyle = withAlpha(i % 2 ? '#3B2C1C' : '#2E2114', 0.55)
    g.fill()
    g.restore()
    strokeHandDrawn(g, pts, { color: '#8A6626', baseWidth: 0.9, widthJitter: 0.4, closed: true, seed: 140 + i, opacity: 0.28 })
  }

  // Disco de cria (favo).
  const discPts = polygonPoints(disc.cx, disc.cy, disc.rx, disc.ry, 48, { jitter: 0.02, seed: 9 })
  g.save()
  g.beginPath()
  tracePath(g, discPts, { closed: true, smooth: true })
  g.clip()
  g.fillStyle = '#5C4419'
  g.fillRect(disc.cx - disc.rx, disc.cy - disc.ry, disc.rx * 2, disc.ry * 2)
  const cell = 19 * S
  const horiz = cell * 1.5
  const vert = Math.sqrt(3) * cell
  drawComb(g, {
    x: disc.cx - disc.rx,
    y: disc.cy - disc.ry - vert * 0.5,
    cols: Math.ceil((disc.rx * 2) / horiz) + 2,
    rows: Math.ceil((disc.ry * 2) / vert) + 2,
    cellSize: cell,
    seed: 5,
    getState(col, row) {
      const r = seededRandom(seedFromString(`st-${col}-${row}`))()
      return r < 0.7 ? 'capped' : r < 0.92 ? 'empty' : 'egg'
    },
  })
  // Lavagem escura para as criaturas "saltarem" do fundo + vinheta nas bordas do disco.
  g.fillStyle = 'rgba(36, 26, 16, 0.42)'
  g.fillRect(-M, -M, W + M * 2, H + M * 2)
  const vg = g.createRadialGradient(disc.cx, disc.cy, Math.min(disc.rx, disc.ry) * 0.45, disc.cx, disc.cy, Math.max(disc.rx, disc.ry))
  vg.addColorStop(0, 'rgba(26, 18, 8, 0)')
  vg.addColorStop(1, 'rgba(26, 18, 8, 0.5)')
  g.fillStyle = vg
  g.fillRect(-M, -M, W + M * 2, H + M * 2)
  g.restore()
  strokeHandDrawn(g, discPts, { color: INK_LINE, baseWidth: 2.2, widthJitter: 0.6, closed: true, seed: 12, opacity: 0.85 })

  // Túnel da entrada atravessando o invólucro.
  g.save()
  const tunnel = g.createLinearGradient(-M, 0, disc.cx - disc.rx + 30 * S, 0)
  tunnel.addColorStop(0, 'rgba(20, 14, 6, 0.85)')
  tunnel.addColorStop(1, 'rgba(20, 14, 6, 0)')
  g.fillStyle = tunnel
  g.beginPath()
  g.ellipse(E.x + 20 * S, E.y, 100 * S, 70 * S, 0, 0, TAU)
  g.fill()
  g.restore()

  // Raios de geoprópolis em volta do orifício (detalhe real da Mandaçaia).
  const rng = seededRandom(77)
  const holeRx = 22 * S
  const holeRy = 34 * S
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * TAU + (rng() - 0.5) * 0.08
    const r0 = 1.05
    const len = (10 + rng() * 22) * S
    const x0 = E.x + Math.cos(a) * holeRx * r0
    const y0 = E.y + Math.sin(a) * holeRy * r0
    strokeHandDrawn(g, [
      { x: x0, y: y0 },
      { x: x0 + Math.cos(a) * len * 0.5 + (rng() - 0.5) * 2 * S, y: y0 + Math.sin(a) * len * 0.5 },
      { x: x0 + Math.cos(a) * len, y: y0 + Math.sin(a) * len },
    ], { color: i % 3 ? '#1A1208' : '#8A6626', baseWidth: 1.6 * S, widthJitter: 0.6, seed: 300 + i, opacity: 0.55 })
  }
  const holePts = polygonPoints(E.x, E.y, holeRx, holeRy, 20, { jitter: 0.05, seed: 31 })
  g.save()
  g.beginPath()
  tracePath(g, holePts, { closed: true, smooth: true })
  const hg = g.createRadialGradient(E.x - 6 * S, E.y, 2, E.x, E.y, holeRy)
  hg.addColorStop(0, PAL.sunHalo)
  hg.addColorStop(0.55, PAL.sunGold)
  hg.addColorStop(1, '#8A6626')
  g.fillStyle = hg
  g.fill()
  g.clip()
  drawHatching(g, { x: E.x - holeRx, y: E.y - holeRy, width: holeRx * 2, height: holeRy * 2 }, {
    angle: 1.2, lineCount: 14, color: '#C9861F', opacityRange: [0.12, 0.25], seed: 32, curveAmount: 2,
  })
  g.restore()
  strokeHandDrawn(g, holePts, { color: INK_LINE, baseWidth: 2.4, widthJitter: 0.7, closed: true, seed: 33, opacity: 0.9 })

  // Grão de papel muito sutil sobre tudo.
  drawStipple(g, { x: 0, y: 0, width: W, height: H }, {
    color: PAL.paperCreamLight, count: 420, seed: 55, radius: [0.4, 1], opacity: [0.02, 0.05],
  })
  return canvas
}

function buildBeeSprites(scale, dpr) {
  const box = 64 * scale
  const frames = {}
  for (const variant of ['adult', 'old']) {
    frames[variant] = []
    for (let i = 0; i < 6; i++) {
      const { canvas, g } = makeCanvas(box, box, dpr)
      g.translate(box / 2, box / 2)
      g.scale(scale, scale)
      const t = (i / 6) * (TAU / 26)
      drawBeeBody(g, createFlightPose(0, 0, t, { colorVariant: variant, seed: variant === 'old' ? 17 : 7 }))
      frames[variant].push(canvas)
    }
  }
  return { frames, box }
}

function buildDebrisSprite(type, seed, S, dpr) {
  const box = 46 * S
  const { canvas, g } = makeCanvas(box, box, dpr)
  g.translate(box / 2, box / 2)
  g.scale(S * 1.5, S * 1.5)
  if (type === 'brood') {
    // Cria morta: pupa pálida-amarronzada, levemente curvada, com manchas escuras.
    const pts = []
    const N = 16
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const bend = Math.cos(a) * 1.6
      pts.push({ x: Math.cos(a) * 9, y: Math.sin(a) * (4.2 + Math.cos(a) * 0.9) + bend * Math.abs(Math.cos(a)) })
    }
    g.beginPath()
    tracePath(g, pts, { closed: true, smooth: true })
    g.fillStyle = '#C9B78E'
    g.fill()
    g.save()
    g.clip()
    for (let i = -3; i <= 3; i++) {
      g.beginPath()
      g.moveTo(i * 2.4, -6)
      g.quadraticCurveTo(i * 2.4 + 0.8, 0, i * 2.4, 6)
      g.strokeStyle = '#6B5433'
      g.globalAlpha = 0.35
      g.lineWidth = 0.5
      g.stroke()
    }
    g.globalAlpha = 1
    drawStipple(g, { x: -9, y: -5, width: 18, height: 10 }, {
      color: '#5A4530', count: 55, seed: seed + 1, radius: [0.3, 1.1], opacity: [0.15, 0.45], densityBias: (u) => u,
    })
    drawHatching(g, { x: -10, y: -6, width: 20, height: 12 }, {
      angle: 0.2, lineCount: 10, color: '#6B5433', opacityRange: [0.1, 0.2], seed: seed + 2, curveAmount: 1,
    })
    g.restore()
    g.beginPath()
    g.ellipse(8, 0.4, 2.6, 2.4, 0, 0, TAU)
    g.fillStyle = '#7A5C3B'
    g.fill()
    strokeHandDrawn(g, pts, { color: INK_LINE, baseWidth: 1, widthJitter: 0.3, closed: true, seed: seed + 3, opacity: 0.85 })
  } else {
    // Resto de cera/cerume: lasca irregular.
    const pts = polygonPoints(0, 0, 8.5, 6, 8, { jitter: 0.32, seed, rotation: seed % 3 })
    g.beginPath()
    tracePath(g, pts, { closed: true, smooth: false })
    const gr = g.createLinearGradient(-8, -6, 8, 6)
    gr.addColorStop(0, '#6B4A1C')
    gr.addColorStop(1, '#2E2114')
    g.fillStyle = gr
    g.fill()
    g.save()
    g.clip()
    drawHatching(g, { x: -9, y: -7, width: 18, height: 14 }, {
      angle: 0.7 + (seed % 5) * 0.2, lineCount: 12, color: '#E3DAC0', opacityRange: [0.12, 0.26], seed: seed + 4, curveAmount: 0.8,
    })
    g.restore()
    strokeHandDrawn(g, pts, { color: INK_LINE, baseWidth: 1, widthJitter: 0.35, closed: true, seed: seed + 5, opacity: 0.9 })
  }
  return { canvas, box }
}

function rebuildLayers(context) {
  const dpr = dprNow()
  st.view = computeView(context)
  const L = buildLayout(st.view.Wc, st.view.Hc)
  st.L = L
  st.dpr = dpr
  st.backdrop = buildBackdrop(st.view.screenW, st.view.screenH, dpr)
  st.bg = buildBackground(L, dpr)
  st.beeSprites = buildBeeSprites(1.45 * L.S, dpr)
  const dmg = makeCanvas(L.W, L.H, dpr)
  st.damageCanvas = dmg.canvas
  st.damageCtx = dmg.g
  for (const m of st.marks) paintMark(m)
  for (const d of st.debris) d.sprite = buildDebrisSprite(d.type, d.seed, L.S, dpr)
  const u = clamp(context.layout.uiScale || 1, 0.85, 1.3)
  st.iconDebris = buildDebrisSprite('brood', 5, 0.62 * u, dpr)
}

// ---------------------------------------------------------------------------
// Dano no favo (marcas incrementais numa camada offscreen)
// ---------------------------------------------------------------------------

function addMark(x1, y1, x2, y2) {
  const { W, H } = st.L
  const m = { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H, r: Math.random() }
  st.marks.push(m)
  paintMark(m)
}

function paintMark(m) {
  const { W, H, S } = st.L
  const g = st.damageCtx
  const x1 = m.x1 * W, y1 = m.y1 * H, x2 = m.x2 * W, y2 = m.y2 * H
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = '#140E06'
  g.globalAlpha = 0.3
  g.lineWidth = (4 + m.r * 2.5) * S
  g.beginPath()
  g.moveTo(x1, y1)
  g.lineTo(x2, y2)
  g.stroke()
  // Borda roída clara (cera raspada) e fios de seda da traça.
  g.globalAlpha = 0.14
  g.strokeStyle = '#E3DAC0'
  g.lineWidth = 0.7
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const px = -(y2 - y1) / len
  const py = (x2 - x1) / len
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const k = (5 + m.r * 7) * S
  g.beginPath()
  g.moveTo(mx + px * k, my + py * k)
  g.quadraticCurveTo(mx + (m.r - 0.5) * 6 * S, my, mx - px * k * 0.8, my - py * k * 0.8)
  g.stroke()
  if (m.r > 0.7) {
    g.globalAlpha = 0.4
    g.fillStyle = '#1A1208'
    g.beginPath()
    g.arc(mx + px * k * 0.6, my + py * k * 0.6, 1.1 * S, 0, TAU)
    g.fill()
  }
  g.restore()
}

// ---------------------------------------------------------------------------
// Dificuldade - tudo deriva de st.D (data.difficulty) + rampa dentro do turno.
// ---------------------------------------------------------------------------

function difficulty() {
  const D = st.D
  const r = inShiftRamp(st.time, SHIFT_DURATION)
  // Intensidade efetiva: começa em 60% de D e chega a D no fim do turno.
  const e = clamp(D * (0.6 + 0.4 * r), 0, 1)
  return {
    D, r, e,
    patrollers: 1 + Math.round(6 * e),
    patrolSpeed: 60 + 50 * e,
    foragerRate: 0.04 + 0.34 * e,
    foragerSpeed: 105 + 60 * e,
    larvaInterval: 14 - 10 * e,
    maxLarvae: 1 + Math.round(3 * e),
    fleeSpeed: 0.5 + 0.6 * e, // × velocidade da jogadora
    fleeR: 110 + 70 * e,
    wanderSpeed: 32 + 28 * e,
    damageRate: 0.12 + 0.4 * e, // % do medidor por segundo, por traça ativa
    dropChance: 0.12 + 0.6 * e,
    hitR: 21 + 8 * e,
    carryBrood: 0.86 - 0.32 * e,
    carryWax: 0.92 - 0.24 * e,
    accelBrood: 7.5 - 4.3 * e,
    accelWax: 8.5 - 4.3 * e,
    deliverR: 62 + 34 * (1 - D),
    capR: 28 + 10 * (1 - D),
  }
}

function deliverTarget() {
  // Carregar fica mais pesado com a dificuldade, então a meta cai um pouco.
  return Math.round((15 - 3 * st.D) * config.durationScale)
}

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------

function randomDiscPoint(minX, avoidR, k = 0.86) {
  const L = st.L
  const pl = st.mover.position
  for (let tries = 0; tries < 40; tries++) {
    const a = Math.random() * TAU
    const r = Math.sqrt(Math.random())
    const x = L.disc.cx + Math.cos(a) * L.disc.rx * k * r
    const y = L.disc.cy + Math.sin(a) * L.disc.ry * k * r
    if (x < minX) continue
    if (dist(x, y, pl.x, pl.y) < avoidR) continue
    if (st.debris.some((d) => d.state === 'floor' && dist(d.x, d.y, x, y) < 50 * L.S)) continue
    return { x, y }
  }
  return { x: L.disc.cx + L.disc.rx * 0.5, y: L.disc.cy }
}

function spawnDebris() {
  const L = st.L
  const pos = randomDiscPoint(L.W * 0.32, 140 * L.S)
  const type = Math.random() < 0.55 ? 'brood' : 'wax'
  const seed = 1 + Math.floor(Math.random() * 9999)
  st.debris.push({
    type, seed, x: pos.x, y: pos.y, rot: rand(0, TAU),
    sprite: buildDebrisSprite(type, seed, L.S, st.dpr),
    state: 'floor', cooldown: 0, anim: null, born: st.time, flag: 0,
  })
}

function spawnLarvaWarning() {
  const L = st.L
  const pos = randomDiscPoint(L.W * 0.22, 200 * L.S, 0.8)
  st.warnings.push({ x: pos.x, y: pos.y, t: 0, dur: 1.3 - 0.3 * st.D })
}

function larvaBounds() {
  const r = st.L.disc
  return { x: r.cx - r.rx * 0.93, y: r.cy - r.ry * 0.93, width: r.rx * 1.86, height: r.ry * 1.86 }
}

function spawnLarva(x, y) {
  // Um spawner 'erratic' por larva: o PatternSpawner lê `fleeFrom` por
  // referência, então mutamos esse objeto a cada frame (fuga do jogador /
  // passeio). speed = 1 e update(dt * velocidade) permite variar a velocidade.
  const flee = { x, y }
  const spawner = createSpawner({
    pattern: 'erratic',
    spawnRate: 0,
    speed: 1,
    spawnPoint: { x, y },
    fleeFrom: flee,
    bounds: larvaBounds(),
    maxEntities: 1,
  })
  spawner.spawn({ x, y })
  const lv = {
    spawner, flee, home: { x, y }, target: { x, y }, wanderT: 0,
    dx: x, dy: y, heading: rand(0, TAU), anim: rand(0, 10), markX: x, markY: y,
    dodgeT: 0, dodgeSide: 1, seed: 1 + Math.floor(Math.random() * 999), age: 0, fleeing: false,
    resined: false, resinAt: 0,
  }
  // Nascida com a resina já espalhada: embalsamada na hora.
  if (st.meter.isActive && (!st.wave || st.wave.t >= WAVE_EXPAND)) {
    lv.resined = true
    lv.resinAt = st.time
  }
  st.larvae.push(lv)
  st.pestsSpawned++
}

function addPatroller() {
  const L = st.L
  const loopIdx = st.patrollers.length % L.loops.length
  const loop = L.loops[loopIdx]
  const pl = st.mover.position
  let s = rand(0, loop.length)
  for (let i = 0; i < 12; i++) {
    const p = loopPoint(loop, s)
    if (dist(p.x, p.y, pl.x, pl.y) > 200 * L.S) break
    s += loop.length / 12
  }
  const p = loopPoint(loop, s)
  st.patrollers.push({
    loopIdx, s, x: p.x, y: p.y, heading: 0, phase: rand(0, TAU), speedK: rand(0.85, 1.15),
    variant: Math.random() < 0.5 ? 'adult' : 'old', fade: 0, frame: Math.random() * 6, bump: 0,
  })
}

function buildForagerSpawners() {
  const L = st.L
  const dif = difficulty()
  st.foragers = L.lanes.map((path, i) => {
    const sp = createSpawner({ pattern: 'file', spawnRate: dif.foragerRate, path, speed: dif.foragerSpeed * L.S, maxEntities: 6 })
    sp._timeSinceSpawn = i === 0 ? 2.5 : 0
    return sp
  })
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

function fx(kind, x, y, extra = {}) {
  st.fx.push({ kind, x, y, t: 0, dur: extra.dur ?? 0.6, ...extra })
}

function shake(mag, dur = 0.25) {
  st.shakeMag = Math.max(st.shakeMag, mag)
  st.shakeT = Math.max(st.shakeT, dur)
}

// ---------------------------------------------------------------------------
// Ações do jogador
// ---------------------------------------------------------------------------

function dropCarried(dirX, dirY, forced) {
  const L = st.L
  const d = st.carrying
  if (!d) return
  const pl = st.mover.position
  const len = Math.hypot(dirX, dirY) || 1
  const reach = (forced ? rand(45, 70) : 34) * L.S
  let tx = pl.x + (dirX / len) * reach + (forced ? rand(-14, 14) * L.S : 0)
  let ty = pl.y + (dirY / len) * reach + (forced ? rand(-14, 14) * L.S : 0)
  tx = clamp(tx, L.bounds.x + 10, L.bounds.x + L.bounds.width - 10)
  ty = clamp(ty, L.bounds.y + 10, L.bounds.y + L.bounds.height - 10)
  const from = st.carryPoint()
  d.state = 'air'
  d.anim = { t: 0, dur: forced ? 0.55 : 0.3, fx: from.x, fy: from.y, tx, ty, spin: forced ? rand(-7, 7) : rand(-2, 2), h: (forced ? 34 : 12) * L.S }
  d.cooldown = forced ? 0.9 : 0.6
  st.carrying = null
  if (forced) {
    st.drops++
    shake(5 * L.S, 0.28)
    fx('drop', tx, ty, { dur: 1.6 })
  }
}

function dash(dx, dy) {
  const L = st.L
  const pl = st.mover.position
  const len = Math.hypot(dx, dy) || 1
  const power = 560 * L.S
  st.impX += (dx / len) * power
  st.impY += (dy / len) * power
  st.dashCd = DASH_CD
  st.dashT = 0.22
  fx('dash', pl.x, pl.y, { dur: 0.45, ang: Math.atan2(dy, dx) })
}

function doAction() {
  const L = st.L
  const pl = st.mover.position
  if (st.carrying) {
    dropCarried(Math.cos(st.heading), Math.sin(st.heading), false)
    return
  }
  if (st.dashCd > 0) return
  let best = null
  let bestD = 150 * L.S
  for (const lv of st.larvae) {
    const e = lv.spawner.entities[0]
    if (!e) continue
    const dd = dist(e.x, e.y, pl.x, pl.y)
    if (dd < bestD) { bestD = dd; best = e }
  }
  if (!best) {
    bestD = 110 * L.S
    for (const d of st.debris) {
      if (d.state !== 'floor') continue
      const dd = dist(d.x, d.y, pl.x, pl.y)
      if (dd < bestD) { bestD = dd; best = d }
    }
  }
  if (best) dash(best.x - pl.x, best.y - pl.y)
  else dash(Math.cos(st.heading), Math.sin(st.heading))
}

// Toque/clique curto em cima de uma traça: investida direto nela.
function doTapOnLarva(tap) {
  if (st.carrying || st.dashCd > 0) return
  const L = st.L
  const pl = st.mover.position
  const c = toCanon(tap.x, tap.y)
  let best = null
  let bestD = 48 * L.S
  for (const lv of st.larvae) {
    const e = lv.spawner.entities[0]
    if (!e) continue
    const dd = dist(e.x, e.y, c.x, c.y)
    if (dd < bestD) { bestD = dd; best = e }
  }
  if (best && dist(best.x, best.y, pl.x, pl.y) < 260 * L.S) dash(best.x - pl.x, best.y - pl.y)
}

function activateResin() {
  if (!st.meter.activate()) return
  const pl = st.mover.position
  st.wave = { x: pl.x, y: pl.y, t: 0 }
  st.resinUses++
  st.hitStop = 0.06
  shake(3 * st.L.S, 0.2)
}

function waveRadius() {
  if (!st.wave) return 0
  const L = st.L
  const maxR = Math.hypot(L.W, L.H) * 1.05
  return maxR * ease(clamp(st.wave.t / WAVE_EXPAND, 0, 1), 'easeOutCubic')
}

// ---------------------------------------------------------------------------
// Estado exportado
// ---------------------------------------------------------------------------

export default {
  id: 'cleaning',

  enter(context, data = {}) {
    const shiftIndex = Math.max(0, data?.shiftIndex ?? 0)
    const D = Number.isFinite(data?.difficulty) ? clamp(data.difficulty, 0, 1) : difficultyFor('cleaning', shiftIndex, [])
    st = {
      shiftIndex,
      D,
      time: 0,
      finished: false,
      endT: 0,
      debris: [],
      larvae: [],
      warnings: [],
      patrollers: [],
      foragers: [],
      marks: [],
      fx: [],
      carrying: null,
      delivered: 0,
      captured: 0,
      drops: 0,
      pestsSpawned: 0,
      resinUses: 0,
      resinCaptures: 0,
      captureValue: 0,
      nextLarva: 6 + 6 * (1 - D),
      nextDebris: 4,
      heading: 0,
      velX: 0,
      velY: 0,
      impX: 0,
      impY: 0,
      invuln: 0,
      stun: 0,
      dashCd: 0,
      dashT: 0,
      hitStop: 0,
      shakeT: 0,
      shakeMag: 0,
      pendingAction: false,
      pendingSpecial: false,
      pendingTap: null,
      lastDmgStep: 0,
      dmgPulse: 0,
      tallyPulse: 0,
      capturePulse: 0,
      wave: null,
      viewKey: '',
    }
    st.gauge = createGauge({ rate: 0, max: 100, min: 0, thresholds: { restless: 0.25, critical: 0.5 } })
    st.meter = createMeter({ chargeTime: 50, duration: RESIN_DURATION })
    context.controls.configure({
      showAction: true,
      showSpecial: true,
      showDirections: false,
      meter: st.meter,
      actionLabel: 'AÇÃO',
      specialLabel: 'RESINA',
    })
    rebuildLayers(context)
    st.viewKey = st.view.key
    const L = st.L
    st.mover = createMovement({ bounds: L.bounds, speed: 260 * L.S })
    st.mover.setPosition(L.entrance.x + 120 * L.S, L.entrance.y + 30 * L.S)
    st.carryPoint = () => {
      const pl = st.mover.position
      const sc = 1.5 * st.L.S
      const flip = Math.cos(st.heading + st.view.rot) < 0 ? -1 : 1
      const lx = 17 * sc
      const ly = 5 * sc * flip
      const c = Math.cos(st.heading), s = Math.sin(st.heading)
      return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c }
    }
    for (let i = 0; i < 3; i++) spawnDebris()
    const dif = difficulty()
    for (let i = 0; i < dif.patrollers; i++) addPatroller()
    for (const p of st.patrollers) p.fade = 1
    buildForagerSpawners()
  },

  update(context, dt) {
    if (!st || st.finished) return
    const controls = context.controls

    // Redimensionamento / rotação: refaz camadas e reescala posições.
    const nv = computeView(context)
    if (nv.key !== st.viewKey) {
      const kx = nv.Wc / st.L.W
      const ky = nv.Hc / st.L.H
      st.viewKey = nv.key
      rebuildLayers(context)
      const L = st.L
      const pl = st.mover.position
      st.mover = createMovement({ bounds: L.bounds, speed: 260 * L.S })
      st.mover.setPosition(pl.x * kx, pl.y * ky)
      for (const d of st.debris) { d.x *= kx; d.y *= ky; d.anim = null; if (d.state === 'air') d.state = 'floor' }
      for (const d of st.debris) if (d.state === 'delivering') d.state = 'out'
      for (const lv of st.larvae) {
        const e = lv.spawner.entities[0]
        if (e) { e.x *= kx; e.y *= ky }
        lv.dx *= kx; lv.dy *= ky; lv.markX *= kx; lv.markY *= ky; lv.home.x *= kx; lv.home.y *= ky
        lv.target.x *= kx; lv.target.y *= ky
        lv.spawner = Object.assign(createSpawner({
          pattern: 'erratic', spawnRate: 0, speed: 1, spawnPoint: { x: lv.dx, y: lv.dy }, fleeFrom: lv.flee, bounds: larvaBounds(), maxEntities: 1,
        }), {})
        if (e) lv.spawner.spawn({ x: e.x, y: e.y })
      }
      for (const w of st.warnings) { w.x *= kx; w.y *= ky }
      if (st.wave) { st.wave.x *= kx; st.wave.y *= ky }
      st.fx = []
      buildForagerSpawners()
    }

    const L = st.L
    const S = L.S

    // Fim de turno.
    if (st.time >= SHIFT_DURATION) {
      st.endT += dt
      st.fx.forEach((f) => { f.t += dt })
      st.fx = st.fx.filter((f) => f.t < f.dur)
      if (st.endT >= END_FADE) {
        st.finished = true
        context.finishShift(computeResult())
      }
      return
    }

    // Bordas de entrada: guardadas para não se perderem durante o hit-stop.
    if (controls.actionPressed) st.pendingAction = true
    if (controls.specialPressed) st.pendingSpecial = true
    if (controls.pointerTap) st.pendingTap = controls.pointerTap

    // Timers que correm mesmo durante hit-stop.
    st.fx.forEach((f) => { f.t += dt })
    st.fx = st.fx.filter((f) => f.t < f.dur)
    st.shakeT = Math.max(0, st.shakeT - dt)
    if (st.shakeT <= 0) st.shakeMag = 0
    st.dmgPulse = Math.max(0, st.dmgPulse - dt)
    st.tallyPulse = Math.max(0, st.tallyPulse - dt)
    st.capturePulse = Math.max(0, st.capturePulse - dt)
    if (st.hitStop > 0) {
      st.hitStop -= dt
      return
    }

    st.time += dt
    const dif = difficulty()

    // ---- Especial: Resina ----
    st.meter.update(dt)
    if (st.meter.justEnded) {
      for (const lv of st.larvae) lv.resined = false
    }
    if (st.pendingSpecial) {
      st.pendingSpecial = false
      activateResin()
    }
    if (st.wave) {
      st.wave.t += dt
      const R = waveRadius()
      if (st.meter.isActive) {
        for (const lv of st.larvae) {
          if (!lv.resined && dist(lv.dx, lv.dy, st.wave.x, st.wave.y) <= R) {
            lv.resined = true
            lv.resinAt = st.time
            fx('resin', lv.dx, lv.dy, { dur: 0.7 })
          }
        }
      }
      if (st.wave.t >= WAVE_LIFE) st.wave = null
    }

    if (st.pendingAction) {
      st.pendingAction = false
      doAction()
    }
    if (st.pendingTap) {
      doTapOnLarva(st.pendingTap)
      st.pendingTap = null
    }

    // ---- Movimento do jogador ----
    let ix = 0
    let iy = 0
    const pl0 = st.mover.position
    const mv = controls.move
    if (mv && mv.vx != null) {
      const v = vecToCanon(mv.vx, mv.vy)
      ix = v.x
      iy = v.y
    } else if (mv && mv.targetX != null) {
      const tgt = toCanon(mv.targetX, mv.targetY)
      const dx = tgt.x - pl0.x
      const dy = tgt.y - pl0.y
      const dd = Math.hypot(dx, dy)
      if (dd > 5 * S) {
        const m = Math.min(1, dd / (60 * S))
        ix = (dx / dd) * m
        iy = (dy / dd) * m
      }
    }
    const carry = st.carrying
    const speedMul = carry ? (carry.type === 'brood' ? dif.carryBrood : dif.carryWax) : 1
    const accel = carry ? (carry.type === 'brood' ? dif.accelBrood : dif.accelWax) : 11
    const stunK = st.stun > 0 ? 0.35 : 1
    st.velX += (ix * stunK - st.velX) * expLerp(accel, dt)
    st.velY += (iy * stunK - st.velY) * expLerp(accel, dt)
    st.mover.setSpeedMultiplier(speedMul)
    st.mover.update(dt, { x: st.velX, y: st.velY })

    // Impulso (empurrões e investida), fora do controller.
    if (Math.abs(st.impX) + Math.abs(st.impY) > 0.5) {
      const p = st.mover.position
      const b = L.bounds
      const nx = clamp(p.x + st.impX * dt, b.x, b.x + b.width)
      const ny = clamp(p.y + st.impY * dt, b.y, b.y + b.height)
      st.mover.setPosition(nx, ny)
      const decay = Math.exp(-(st.dashT > 0 ? 5 : 7) * dt)
      st.impX *= decay
      st.impY *= decay
    }
    st.invuln = Math.max(0, st.invuln - dt)
    st.stun = Math.max(0, st.stun - dt)
    st.dashCd = Math.max(0, st.dashCd - dt)
    st.dashT = Math.max(0, st.dashT - dt)

    const pl = st.mover.position
    const mvX = st.velX * speedMul + st.impX / (260 * S)
    const mvY = st.velY * speedMul + st.impY / (260 * S)
    if (Math.hypot(mvX, mvY) > 0.08) {
      st.heading = angleLerp(st.heading, Math.atan2(mvY, mvX), expLerp(carry ? 5 : 12, dt))
    }

    // ---- Trânsito: patrulheiras em anéis ----
    while (st.patrollers.length < dif.patrollers) addPatroller()
    for (const b of st.patrollers) {
      const loop = L.loops[b.loopIdx]
      const pulse = 0.55 + 0.45 * Math.sin(b.phase + st.time * 0.85)
      const v = dif.patrolSpeed * S * b.speedK * pulse
      b.s += v * dt * loop.dir
      const p = loopPoint(loop, b.s)
      const dx = p.x - b.x
      const dy = p.y - b.y
      if (Math.hypot(dx, dy) > 0.01) b.heading = angleLerp(b.heading, Math.atan2(dy, dx), expLerp(8, dt))
      b.x = p.x
      b.y = p.y
      b.fade = Math.min(1, b.fade + dt * 1.5)
      b.frame = (b.frame + dt * 26) % 6
      b.bump = Math.max(0, b.bump - dt)
    }

    // ---- Trânsito: forrageiras entrando/saindo pela entrada ----
    for (const sp of st.foragers) {
      sp.spawnRate = dif.foragerRate
      for (const e of sp.entities) {
        e.speed = dif.foragerSpeed * S
        e._px = e._px ?? e.x
        e._py = e._py ?? e.y
      }
      sp.update(dt)
      for (const e of sp.entities) {
        e._age = (e._age ?? 0) + dt
        const dx = e.x - e._px
        const dy = e.y - e._py
        if (Math.hypot(dx, dy) > 0.01) e._h = angleLerp(e._h ?? Math.atan2(dy, dx), Math.atan2(dy, dx), expLerp(7, dt))
        e._px = e.x
        e._py = e.y
        e._frame = ((e._frame ?? Math.random() * 6) + dt * 26) % 6
        e._bump = Math.max(0, (e._bump ?? 0) - dt)
        e._variant = e._variant ?? (e.id % 2 ? 'adult' : 'old')
      }
    }

    // ---- Colisões com o trânsito ----
    if (st.invuln <= 0) {
      const hitR = dif.hitR * S
      const check = (bx, by, bee) => {
        const d = dist(bx, by, pl.x, pl.y)
        if (d >= hitR) return false
        const nx = (pl.x - bx) / (d || 1)
        const ny = (pl.y - by) / (d || 1)
        const hadCargo = !!st.carrying
        st.impX = nx * 300 * S
        st.impY = ny * 300 * S
        st.velX *= 0.3
        st.velY *= 0.3
        st.invuln = 0.75
        bee.bump = 0.35
        bee._bump = 0.35
        if (hadCargo && Math.random() < dif.dropChance) {
          st.stun = 0.4
          dropCarried(nx, ny, true)
        } else {
          st.stun = hadCargo ? 0.22 : 0.18
          shake(2.5 * S, 0.15)
          fx('bump', (pl.x + bx) / 2, (pl.y + by) / 2, { dur: 0.4 })
        }
        return true
      }
      let hit = false
      for (const b of st.patrollers) {
        if (b.fade < 0.6) continue
        if (check(b.x, b.y, b)) { hit = true; break }
      }
      if (!hit) {
        outer: for (const sp of st.foragers) {
          for (const e of sp.entities) {
            if (e._age < 0.35) continue
            if (dist(e.x, e.y, L.entrance.x, L.entrance.y) < 26 * S) continue
            if (check(e.x, e.y, e)) break outer
          }
        }
      }
    }

    // ---- Detritos ----
    st.nextDebris -= dt
    const onFloor = st.debris.filter((d) => d.state === 'floor' || d.state === 'air').length
    if ((st.nextDebris <= 0 && onFloor < 5) || onFloor + (st.carrying ? 1 : 0) < 2) {
      spawnDebris()
      st.nextDebris = rand(4, 6)
    }
    for (const d of st.debris) {
      d.cooldown = Math.max(0, d.cooldown - dt)
      if (d.state === 'air') {
        d.anim.t += dt
        const k = clamp(d.anim.t / d.anim.dur, 0, 1)
        const e = ease(k, 'easeOutBounce')
        d.x = d.anim.fx + (d.anim.tx - d.anim.fx) * ease(k, 'easeOutQuad')
        d.y = d.anim.fy + (d.anim.ty - d.anim.fy) * e
        d.rot += d.anim.spin * dt * (1 - k)
        if (k >= 1) { d.state = 'floor'; d.anim = null }
      } else if (d.state === 'delivering') {
        d.anim.t += dt
        const k = clamp(d.anim.t / d.anim.dur, 0, 1)
        const e = ease(k, 'easeInCubic')
        d.x = d.anim.fx + (d.anim.tx - d.anim.fx) * e
        d.y = d.anim.fy + (d.anim.ty - d.anim.fy) * e
        d.rot += 6 * dt
        d.scaleOut = 1 - e * 0.85
        if (k >= 1) d.state = 'out'
      } else if (d.state === 'floor' && !st.carrying && d.cooldown <= 0 && st.stun <= 0) {
        if (dist(d.x, d.y, pl.x, pl.y) < (30 + 8 * (1 - st.D)) * S) {
          d.state = 'carried'
          st.carrying = d
          fx('pickup', d.x, d.y, { dur: 0.45 })
        }
      }
    }
    st.debris = st.debris.filter((d) => d.state !== 'out')
    st.deliverR = dif.deliverR * S
    if (st.carrying) {
      const cp = st.carryPoint()
      st.carrying.x = cp.x
      st.carrying.y = cp.y
      if (dist(pl.x, pl.y, L.entrance.x, L.entrance.y) < st.deliverR) {
        const d = st.carrying
        st.carrying = null
        d.state = 'delivering'
        d.anim = { t: 0, dur: 0.55, fx: d.x, fy: d.y, tx: -30 * S, ty: L.entrance.y + rand(-10, 10) * S }
        st.delivered++
        st.tallyPulse = 0.6
        st.hitStop = 0.05
        st.meter.add(0.1)
        fx('deliver', L.entrance.x, L.entrance.y, { dur: 1.1 })
      }
    }

    // ---- Traças: aviso -> emergência ----
    st.nextLarva -= dt
    const pending = st.larvae.length + st.warnings.length
    if (st.nextLarva <= 0) {
      if (pending < dif.maxLarvae) spawnLarvaWarning()
      st.nextLarva = dif.larvaInterval * rand(0.8, 1.2)
    }
    for (const w of st.warnings) w.t += dt
    for (const w of st.warnings.filter((w) => w.t >= w.dur)) spawnLarva(w.x, w.y)
    st.warnings = st.warnings.filter((w) => w.t < w.dur)

    // ---- Traças: movimento errático com fuga (paradas se embalsamadas) ----
    const fleeR = dif.fleeR * S
    const baseFlee = 260 * S * dif.fleeSpeed
    for (const lv of st.larvae) {
      const e = lv.spawner.entities[0]
      if (!e) continue
      lv.age += dt
      if (lv.resined) {
        lv.fleeing = false
        lv.anim += dt * 0.4
        continue
      }
      const dp = dist(e.x, e.y, pl.x, pl.y)
      let speed
      if (dp < fleeR) {
        lv.fleeing = true
        lv.dodgeT -= dt
        if (lv.dodgeT <= 0) {
          lv.dodgeSide = Math.random() < 0.5 ? -1 : 1
          lv.dodgeT = rand(0.3, 0.75)
        }
        const ax = e.x - pl.x
        const ay = e.y - pl.y
        const al = Math.hypot(ax, ay) || 1
        const px = -ay / al
        const py = ax / al
        const k = 70 * S * lv.dodgeSide
        lv.flee.x = pl.x + px * k
        lv.flee.y = pl.y + py * k
        speed = baseFlee * (dp < 80 * S ? 1.15 : 1) * (0.7 + 0.3 * Math.min(1, lv.age / 1.5))
      } else {
        lv.fleeing = false
        lv.wanderT -= dt
        if (lv.wanderT <= 0 || dist(e.x, e.y, lv.target.x, lv.target.y) < 10 * S) {
          const a = Math.random() * TAU
          const r = rand(20, 110) * S
          lv.target = { x: lv.home.x + Math.cos(a) * r, y: lv.home.y + Math.sin(a) * r }
          lv.wanderT = rand(1.5, 3.5)
        }
        // Truque: fugir do ponto espelhado = andar em direção ao alvo.
        lv.flee.x = 2 * e.x - lv.target.x
        lv.flee.y = 2 * e.y - lv.target.y
        speed = dif.wanderSpeed * S
      }
      lv.spawner.update(dt * speed)
      // Mantém dentro do disco do favo (elíptico).
      const nx = (e.x - L.disc.cx) / (L.disc.rx * 0.92)
      const ny = (e.y - L.disc.cy) / (L.disc.ry * 0.92)
      const n = Math.hypot(nx, ny)
      if (n > 1) {
        e.x = L.disc.cx + (nx / n) * L.disc.rx * 0.92
        e.y = L.disc.cy + (ny / n) * L.disc.ry * 0.92
      }
      const odx = lv.dx
      const ody = lv.dy
      const smooth = expLerp(lv.fleeing ? 16 : 7, dt)
      lv.dx += (e.x - lv.dx) * smooth
      lv.dy += (e.y - lv.dy) * smooth
      const mdx = lv.dx - odx
      const mdy = lv.dy - ody
      if (Math.hypot(mdx, mdy) > 0.05) lv.heading = angleLerp(lv.heading, Math.atan2(mdy, mdx), expLerp(lv.fleeing ? 10 : 4, dt))
      lv.anim += dt * (lv.fleeing ? 11 : 3)
      if (dist(lv.dx, lv.dy, lv.markX, lv.markY) > 7 * S) {
        addMark(lv.markX, lv.markY, lv.dx, lv.dy)
        lv.markX = lv.dx
        lv.markY = lv.dy
      }
    }

    // ---- Captura ----
    const capR = (st.dashT > 0 ? dif.capR + 6 : dif.capR) * S
    for (const lv of st.larvae) {
      const got = lv.spawner.checkCapture(pl, lv.resined ? capR * 1.25 : capR)
      if (got.length) {
        st.captured++
        if (lv.resined) st.resinCaptures++
        // Captura rápida vale mais (menos tempo roendo o favo).
        st.captureValue += clamp(1.25 - lv.age / 14, 0.35, 1)
        st.capturePulse = 0.6
        st.hitStop = 0.08
        st.meter.add(0.12)
        shake(3.5 * S, 0.18)
        fx('capture', lv.dx, lv.dy, { dur: 0.9, heading: lv.heading, seed: lv.seed })
        lv.dead = true
      }
    }
    st.larvae = st.larvae.filter((lv) => !lv.dead)

    // ---- Dano (traças embalsamadas não roem) ----
    const active = st.larvae.filter((lv) => !lv.resined).length
    st.gauge.setRate(active * dif.damageRate)
    st.gauge.update(dt)
    const step = Math.floor(st.gauge.value / 5)
    if (step > st.lastDmgStep) {
      st.lastDmgStep = step
      st.dmgPulse = 0.7
    }
  },

  render(context, ctx) {
    if (!st) return
    const L = st.L
    const { S } = L
    const t = st.time
    const lay = context.layout

    // Fundo da tela toda.
    ctx.fillStyle = '#241A10'
    ctx.fillRect(0, 0, lay.width, lay.height)
    ctx.drawImage(st.backdrop, 0, 0, st.view.screenW, st.view.screenH)

    ctx.save()
    if (st.shakeMag > 0) ctx.translate(rand(-1, 1) * st.shakeMag, rand(-1, 1) * st.shakeMag)
    applyView(ctx)

    const M = L.margin
    ctx.drawImage(st.bg, -M, -M, L.W + M * 2, L.H + M * 2)
    ctx.drawImage(st.damageCanvas, 0, 0, L.W, L.H)
    renderEntranceGlow(ctx)

    // Detritos no chão / no ar.
    for (const d of st.debris) {
      if (d.state === 'carried') continue
      const lift = d.state === 'air' ? (1 - clamp(d.anim.t / d.anim.dur, 0, 1)) * 0.25 : 0
      drawDebris(ctx, d, 1 + lift, d.scaleOut ?? 1)
      if (d.state === 'floor' && t - d.born < 0.8) {
        const k = (t - d.born) / 0.8
        dottedRing(ctx, d.x, d.y, (10 + 18 * ease(k, 'easeOutCubic')) * S, withAlpha(PAL.paperCreamLight, 0.5 * (1 - k)), t)
      }
    }

    // Avisos de traça: célula tremendo + anel pontilhado se fechando.
    for (const w of st.warnings) {
      const k = w.t / w.dur
      const r = (34 - 22 * ease(k, 'easeInQuad')) * S
      dottedRing(ctx, w.x, w.y, r, withAlpha(PAL.paperCreamLight, 0.25 + 0.4 * k), -t * 2)
      ctx.save()
      ctx.fillStyle = withAlpha('#F0EAD8', 0.35 * k)
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3 + t * 9
        ctx.beginPath()
        ctx.arc(w.x + Math.cos(a) * 5 * S * k, w.y + Math.sin(a * 1.3) * 4 * S * k, 1.3 * S, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    }

    // Traças.
    for (const lv of st.larvae) {
      const sc = 2.2 * S * Math.min(1, 0.4 + lv.age * 2)
      if (lv.resined) renderResinedLarva(ctx, lv, sc)
      else drawWaxMothLarva(ctx, createWaxMothLarvaPose(lv.dx, lv.dy, lv.anim / 3, { rotation: lv.heading, scale: sc, seed: lv.seed }))
    }

    // Abelhas do trânsito.
    for (const b of st.patrollers) drawSpriteBee(ctx, b.x, b.y, b.heading, b.variant, b.frame, b.fade, b.bump)
    for (const sp of st.foragers) {
      for (const e of sp.entities) {
        const de = dist(e.x, e.y, L.entrance.x, L.entrance.y)
        const k = clamp((de - 8 * S) / (50 * S), 0, 1)
        drawSpriteBee(ctx, e.x, e.y, e._h ?? 0, e._variant ?? 'adult', e._frame ?? 0, 0.35 + 0.65 * k, e._bump ?? 0, 0.6 + 0.4 * k)
      }
    }

    renderWave(ctx)
    renderPlayer(ctx)
    renderFx(ctx)
    ctx.restore()

    renderHint(ctx, context)

    if (st.time >= SHIFT_DURATION) {
      const k = clamp(st.endT / END_FADE, 0, 1)
      ctx.save()
      ctx.fillStyle = `rgba(26, 20, 16, ${0.7 * ease(k, 'easeInOutQuad')})`
      ctx.fillRect(0, 0, lay.width, lay.height)
      ctx.restore()
    }
    renderHud(ctx, context)

    context.controls.render(ctx, lay)
  },

  exit() {
    st = null
  },
}

// ---------------------------------------------------------------------------
// Render helpers (mundo, coordenadas canônicas)
// ---------------------------------------------------------------------------

function renderEntranceGlow(ctx) {
  const L = st.L
  const { S } = L
  const E = L.entrance
  const carrying = !!st.carrying
  const breath = 0.5 + 0.5 * Math.sin(st.time * 1.3)
  const strength = carrying ? 0.32 + 0.1 * breath : 0.14 + 0.06 * breath
  const R = (carrying ? 170 : 130) * S
  const dr = st.deliverR ?? 80 * S
  ctx.save()
  const g = ctx.createRadialGradient(E.x, E.y, 4 * S, E.x, E.y, R)
  g.addColorStop(0, withAlpha(PAL.sunHalo, strength))
  g.addColorStop(0.4, withAlpha(PAL.sunGold, strength * 0.45))
  g.addColorStop(1, withAlpha(PAL.sunGold, 0))
  ctx.fillStyle = g
  ctx.fillRect(E.x - R, E.y - R, R * 2, R * 2)
  // Arco técnico fino marcando a zona de entrega (só quando carregando).
  if (carrying) {
    ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.35 + 0.2 * breath)
    ctx.lineWidth = 1
    ctx.setLineDash([2 * S, 5 * S])
    ctx.lineDashOffset = -st.time * 12
    ctx.beginPath()
    ctx.arc(E.x, E.y, dr, -Math.PI * 0.5, Math.PI * 0.5)
    ctx.stroke()
    ctx.setLineDash([])
    for (let i = -4; i <= 4; i++) {
      const a = (i / 4) * Math.PI * 0.45
      ctx.beginPath()
      ctx.moveTo(E.x + Math.cos(a) * dr, E.y + Math.sin(a) * dr)
      ctx.lineTo(E.x + Math.cos(a) * (dr + (i % 2 ? 3 : 6) * S), E.y + Math.sin(a) * (dr + (i % 2 ? 3 : 6) * S))
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawDebris(ctx, d, lift = 1, scaleOut = 1) {
  const { canvas, box } = d.sprite
  const S = st.L.S
  ctx.save()
  if (d.state === 'floor' || d.state === 'air') {
    ctx.fillStyle = 'rgba(20, 14, 6, 0.28)'
    ctx.beginPath()
    ctx.ellipse(d.x + 2 * S, d.y + 4 * S, 11 * S, 6 * S, 0, 0, TAU)
    ctx.fill()
  }
  ctx.translate(d.x, d.y)
  ctx.rotate(d.rot)
  const s = lift * scaleOut
  ctx.scale(s, s)
  if (scaleOut < 1) ctx.globalAlpha = clamp(scaleOut * 1.3, 0, 1)
  ctx.drawImage(canvas, -box / 2, -box / 2, box, box)
  ctx.restore()
}

function drawSpriteBee(ctx, x, y, heading, variant, frame, alpha = 1, bump = 0, scale = 1) {
  const spr = st.beeSprites
  const img = spr.frames[variant][Math.floor(frame) % 6]
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(heading + (bump > 0 ? Math.sin(bump * 40) * 0.25 : 0))
  if (Math.cos(heading + st.view.rot) < 0) ctx.scale(1, -1)
  if (scale !== 1) ctx.scale(scale, scale)
  ctx.globalAlpha = alpha
  ctx.drawImage(img, -spr.box / 2, -spr.box / 2, spr.box, spr.box)
  ctx.restore()
}

// Traça embalsamada: halo âmbar, casca de resina translúcida e contagem regressiva fina.
function renderResinedLarva(ctx, lv, sc) {
  const S = st.L.S
  const t = st.time
  const remain = st.meter.activeRemaining
  const blink = remain < 1.2 && Math.sin(t * 22) > 0
  const since = clamp((t - lv.resinAt) / 0.35, 0, 1)
  ctx.save()
  const R = 26 * S
  const glow = ctx.createRadialGradient(lv.dx, lv.dy, 2, lv.dx, lv.dy, R * (1.1 + 0.1 * Math.sin(t * 5)))
  glow.addColorStop(0, withAlpha(PAL.sunGold, 0.5 * since))
  glow.addColorStop(1, withAlpha(PAL.sunGold, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(lv.dx, lv.dy, R * 1.3, 0, TAU)
  ctx.fill()
  ctx.restore()

  drawWaxMothLarva(ctx, createWaxMothLarvaPose(lv.dx, lv.dy, lv.anim, { rotation: lv.heading, scale: sc, seed: lv.seed }))

  ctx.save()
  ctx.translate(lv.dx, lv.dy)
  ctx.rotate(lv.heading)
  ctx.fillStyle = withAlpha(blink ? PAL.sunHalo : PAL.caterpillarGold, 0.38 * since)
  ctx.beginPath()
  ctx.ellipse(0, 0, 17 * S, 9 * S, 0, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.7 * since)
  ctx.lineWidth = 1
  ctx.stroke()
  // brilho especular
  ctx.strokeStyle = withAlpha('#FFFFFF', 0.35 * since)
  ctx.beginPath()
  ctx.ellipse(-3 * S, -3 * S, 9 * S, 3.5 * S, 0, Math.PI * 1.1, Math.PI * 1.7)
  ctx.stroke()
  ctx.restore()

  // Arco de contagem do efeito.
  const frac = st.meter.duration > 0 ? remain / st.meter.duration : 0
  ctx.save()
  ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.75)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(lv.dx, lv.dy, 22 * S, -Math.PI / 2, -Math.PI / 2 + TAU * frac)
  ctx.stroke()
  ctx.restore()
}

// Onda de resina: arco técnico fino + preenchimento âmbar translúcido.
function renderWave(ctx) {
  const w = st.wave
  if (!w) return
  const S = st.L.S
  const R = waveRadius()
  if (R < 1) return
  const k = clamp(w.t / WAVE_EXPAND, 0, 1)
  const fade = 1 - clamp((w.t - WAVE_EXPAND) / (WAVE_LIFE - WAVE_EXPAND), 0, 1)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, st.L.W, st.L.H)
  ctx.clip()
  const g = ctx.createRadialGradient(w.x, w.y, R * 0.55, w.x, w.y, R)
  g.addColorStop(0, withAlpha(PAL.caterpillarGold, 0.04 * fade))
  g.addColorStop(0.85, withAlpha(PAL.sunGold, 0.2 * fade))
  g.addColorStop(1, withAlpha(PAL.sunGold, 0.05 * fade))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(w.x, w.y, R, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.85 * fade)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(w.x, w.y, R, 0, TAU)
  ctx.stroke()
  // marcas de escala no arco
  const ticks = 72
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * TAU + k * 0.4
    const len = (i % 6 === 0 ? 9 : 4) * S
    ctx.lineWidth = i % 6 === 0 ? 1 : 0.7
    ctx.beginPath()
    ctx.moveTo(w.x + Math.cos(a) * R, w.y + Math.sin(a) * R)
    ctx.lineTo(w.x + Math.cos(a) * (R - len), w.y + Math.sin(a) * (R - len))
    ctx.stroke()
  }
  // segundo arco interno pontilhado
  ctx.setLineDash([2 * S, 5 * S])
  ctx.strokeStyle = withAlpha(PAL.sunGold, 0.5 * fade)
  ctx.beginPath()
  ctx.arc(w.x, w.y, R * 0.82, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function renderPlayer(ctx) {
  const L = st.L
  const S = L.S
  const pl = st.mover.position
  const t = st.time
  const carry = st.carrying

  // Anel técnico sob a operária (identifica o jogador sem texto).
  ctx.save()
  ctx.strokeStyle = withAlpha(PAL.paperCreamLight, 0.32)
  ctx.lineWidth = 1
  ctx.setLineDash([1.5 * S, 4 * S])
  ctx.lineDashOffset = t * 10
  ctx.beginPath()
  ctx.arc(pl.x, pl.y, 30 * S, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([])
  // Indicador de recarga da investida: arco fino que se completa.
  if (!carry && st.dashCd > 0) {
    ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.5)
    ctx.beginPath()
    ctx.arc(pl.x, pl.y, 34 * S, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - st.dashCd / DASH_CD))
    ctx.stroke()
  }
  ctx.restore()

  if (st.invuln > 0 && Math.floor(st.invuln * 20) % 2 === 0) return

  const sc = 1.5 * S
  const pose = carry
    ? createCarryingPose(0, 0, t, { colorVariant: 'young', cargo: 'debris', seed: 3 })
    : createFlightPose(0, 0, t, { colorVariant: 'young', seed: 3 })
  pose.scale = sc
  ctx.save()
  ctx.translate(pl.x, pl.y)
  const wob = st.stun > 0 ? Math.sin(st.stun * 50) * 0.3 : 0
  ctx.rotate(st.heading + wob)
  const flip = Math.cos(st.heading + st.view.rot) < 0
  if (flip) ctx.scale(1, -1)
  drawBeeBody(ctx, pose)
  ctx.restore()

  if (carry) {
    const cp = st.carryPoint()
    const { canvas, box } = carry.sprite
    ctx.save()
    ctx.translate(cp.x, cp.y)
    ctx.rotate(st.heading + Math.PI / 2 + Math.sin(t * 6) * 0.05)
    ctx.scale(0.9, 0.9)
    ctx.drawImage(canvas, -box / 2, -box / 2, box, box)
    ctx.restore()
  }
}

function dottedRing(ctx, x, y, r, color, offset = 0) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([1.5, 4])
  ctx.lineDashOffset = offset * 10
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.5, r), 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function renderFx(ctx) {
  const S = st.L.S
  for (const f of st.fx) {
    const k = clamp(f.t / f.dur, 0, 1)
    ctx.save()
    switch (f.kind) {
      case 'capture': {
        // Larva se contraindo + transferidor que se abre.
        if (k < 0.45) {
          const kk = k / 0.45
          ctx.globalAlpha = 1 - kk
          drawWaxMothLarva(ctx, createWaxMothLarvaPose(f.x, f.y, f.t * 8, {
            rotation: f.heading + kk * 2, scale: 2.2 * S * (1 - 0.6 * ease(kk, 'easeInBack')), seed: f.seed,
          }))
          ctx.globalAlpha = 1
        }
        const r = (14 + 30 * ease(k, 'easeOutCubic')) * S
        ctx.strokeStyle = withAlpha(PAL.paperCreamLight, 0.75 * (1 - k))
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(f.x, f.y, r, 0, TAU)
        ctx.stroke()
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU
          const len = (i % 4 === 0 ? 8 : 4) * S
          ctx.beginPath()
          ctx.moveTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r)
          ctx.lineTo(f.x + Math.cos(a) * (r + len), f.y + Math.sin(a) * (r + len))
          ctx.stroke()
        }
        ctx.strokeStyle = withAlpha(PAL.sunGold, 0.6 * (1 - k))
        ctx.beginPath()
        ctx.arc(f.x, f.y, r * 0.55, -Math.PI / 2, -Math.PI / 2 + TAU * ease(k, 'easeOutQuad'))
        ctx.stroke()
        break
      }
      case 'resin': {
        const r = (8 + 26 * ease(k, 'easeOutCubic')) * S
        ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.8 * (1 - k))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(f.x, f.y, r, 0, TAU)
        ctx.stroke()
        break
      }
      case 'deliver': {
        for (let i = 0; i < 3; i++) {
          const kk = clamp(k * 1.4 - i * 0.18, 0, 1)
          if (kk <= 0) continue
          ctx.strokeStyle = withAlpha(PAL.sunHalo, 0.7 * (1 - kk))
          ctx.lineWidth = 1.4 - i * 0.3
          ctx.beginPath()
          ctx.arc(f.x, f.y, (24 + 110 * ease(kk, 'easeOutCubic')) * S, -Math.PI * 0.5, Math.PI * 0.5)
          ctx.stroke()
        }
        break
      }
      case 'drop': {
        const pulse = 0.5 + 0.5 * Math.sin(f.t * 14)
        dottedRing(ctx, f.x, f.y, (20 + 6 * pulse) * S, withAlpha(PAL.paperCreamLight, 0.6 * (1 - k)), f.t)
        if (k < 0.35) {
          const kk = k / 0.35
          drawStipple(ctx, { x: f.x - 24 * S * kk, y: f.y - 12 * S * kk, width: 48 * S * kk + 1, height: 24 * S * kk + 1 }, {
            color: '#E3DAC0', count: 18, seed: 9, radius: [0.5, 1.4], opacity: [0.1 * (1 - kk), 0.35 * (1 - kk)],
          })
        }
        break
      }
      case 'bump': {
        ctx.strokeStyle = withAlpha(PAL.paperCreamLight, 0.5 * (1 - k))
        ctx.lineWidth = 1
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.3
          const r0 = (4 + 10 * k) * S
          ctx.beginPath()
          ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0)
          ctx.lineTo(f.x + Math.cos(a) * (r0 + 5 * S), f.y + Math.sin(a) * (r0 + 5 * S))
          ctx.stroke()
        }
        break
      }
      case 'pickup': {
        dottedRing(ctx, f.x, f.y, (12 + 14 * ease(k, 'easeOutCubic')) * S, withAlpha(PAL.sunHalo, 0.6 * (1 - k)), f.t)
        break
      }
      case 'dash': {
        ctx.strokeStyle = withAlpha(PAL.paperCreamLight, 0.4 * (1 - k))
        ctx.lineWidth = 1
        ctx.setLineDash([2, 5])
        const pl = st.mover.position
        ctx.beginPath()
        ctx.moveTo(f.x, f.y)
        ctx.lineTo(pl.x, pl.y)
        ctx.stroke()
        break
      }
      default:
        break
    }
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// HUD (coordenadas de tela, na faixa layout.hudBar) e dica inicial
// ---------------------------------------------------------------------------

function renderHint(ctx, context) {
  const t = st.time
  const lay = context.layout
  const pf = st.view.pf
  const u = clamp(lay.uiScale || 1, 0.85, 1.3)
  let msg = null
  let alpha = 0
  if (t < 6) {
    msg = context.controls.isTouch
      ? 'arraste para voar · encoste para pegar · leve à entrada'
      : 'WASD/setas ou mouse · encoste para pegar · leve à entrada'
    alpha = clamp(Math.min(t / 0.5, (6 - t) / 0.8), 0, 1)
  } else if (st.meter.isReady && st.meter.readyTime < 3.5 && st.resinUses === 0) {
    msg = context.controls.isTouch ? 'resina pronta - toque RESINA' : 'resina pronta - tecla E'
    alpha = clamp(Math.min(st.meter.readyTime / 0.4, (3.5 - st.meter.readyTime) / 0.6), 0, 1)
  }
  if (!msg || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `italic ${Math.round(13 * u)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = Math.min(pf.w - 16, ctx.measureText(msg).width + 24 * u)
  const x = pf.x + pf.w / 2
  const y = pf.y + pf.h - 22 * u
  ctx.fillStyle = 'rgba(26, 20, 16, 0.72)'
  ctx.fillRect(x - w / 2, y - 13 * u, w, 26 * u)
  ctx.strokeStyle = withAlpha(PAL.paperCreamLight, 0.3)
  ctx.lineWidth = 1
  ctx.strokeRect(x - w / 2 + 0.5, y - 13 * u + 0.5, w - 1, 26 * u - 1)
  ctx.fillStyle = PAL.paperCreamLight
  ctx.fillText(msg, x, y, w - 12)
  ctx.restore()
}

function renderHud(ctx, context) {
  const lay = context.layout
  const hb = lay.hudBar
  const u = clamp(lay.uiScale || 1, 0.85, 1.3)
  const t = st.time
  const cream = PAL.paperCreamLight
  const reveal = ease(clamp(t / 1.2, 0, 1), 'easeInOutCubic')
  const p = clamp(t / SHIFT_DURATION, 0, 1)
  const remaining = Math.max(0, Math.ceil(SHIFT_DURATION - t))
  const lastSecs = SHIFT_DURATION - t < 10 && t < SHIFT_DURATION
  const cy = hb.y + hb.h / 2

  ctx.save()
  ctx.lineCap = 'round'
  // Faixa escura (cobre também o notch).
  ctx.fillStyle = 'rgba(26, 20, 16, 0.78)'
  ctx.fillRect(0, 0, lay.width, hb.y + hb.h)
  ctx.strokeStyle = withAlpha(cream, 0.22)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(hb.x, hb.y + hb.h - 0.5)
  ctx.lineTo(hb.x + hb.w, hb.y + hb.h - 0.5)
  ctx.stroke()

  // Relógio do turno.
  const R = Math.min(hb.h * 0.36, 19 * u)
  const tx = hb.x + 12 * u + R
  const top = -Math.PI / 2
  ctx.strokeStyle = withAlpha(cream, 0.28)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(tx, cy, R, 0, TAU)
  ctx.stroke()
  for (let i = 0; i < 12; i++) {
    const a = top + (i / 12) * TAU
    const len = (i % 3 === 0 ? 4 : 2) * u
    ctx.strokeStyle = withAlpha(cream, i / 12 <= p ? 0.2 : 0.55)
    ctx.beginPath()
    ctx.moveTo(tx + Math.cos(a) * (R + 2 * u), cy + Math.sin(a) * (R + 2 * u))
    ctx.lineTo(tx + Math.cos(a) * (R + 2 * u + len), cy + Math.sin(a) * (R + 2 * u + len))
    ctx.stroke()
  }
  const timeCol = lastSecs && Math.sin(t * 10) > 0 ? PAL.sunHalo : PAL.sunGold
  ctx.strokeStyle = timeCol
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.arc(tx, cy, R, top, top + TAU * p * reveal)
  ctx.stroke()
  ctx.fillStyle = cream
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.round(13 * u)}px Georgia, serif`
  ctx.fillText(String(remaining), tx, cy + 1)

  // Contadores: detritos entregues (x/meta) e traças capturadas.
  const tallyK = st.tallyPulse / 0.6
  const capK = st.capturePulse / 0.6
  const iconR = 12 * u
  const x1 = tx + R + 18 * u + iconR
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(cream, 0.45 + 0.55 * tallyK)
  ctx.beginPath()
  ctx.arc(x1, cy, iconR + tallyK * 3 * u, 0, TAU)
  ctx.stroke()
  const ic = st.iconDebris
  ctx.drawImage(ic.canvas, x1 - ic.box / 2, cy - ic.box / 2, ic.box, ic.box)
  ctx.textAlign = 'left'
  const goal = deliverTarget()
  ctx.font = `${Math.round(17 * u + tallyK * 3)}px Georgia, serif`
  ctx.fillStyle = st.delivered >= goal ? PAL.sunHalo : cream
  const dText = String(st.delivered)
  ctx.fillText(dText, x1 + iconR + 6 * u, cy + 1)
  const dW = ctx.measureText(dText).width
  ctx.font = `italic ${Math.round(12 * u)}px Georgia, serif`
  ctx.fillStyle = withAlpha(cream, 0.6)
  ctx.fillText(`/${goal}`, x1 + iconR + 7 * u + dW, cy + 3 * u)

  const x2 = x1 + iconR * 2 + 64 * u
  ctx.strokeStyle = withAlpha(cream, 0.45 + 0.55 * capK)
  ctx.beginPath()
  ctx.arc(x2, cy, iconR + capK * 3 * u, 0, TAU)
  ctx.stroke()
  drawWaxMothLarva(ctx, createWaxMothLarvaPose(x2, cy, t, { scale: 0.8 * u, seed: 4 }))
  ctx.fillStyle = cream
  ctx.font = `${Math.round(17 * u + capK * 3)}px Georgia, serif`
  ctx.fillText(String(st.captured), x2 + iconR + 6 * u, cy + 1)

  // Transferidor do dano no favo (único uso de accentPink fora do botão pronto).
  const r2 = Math.min(hb.h * 0.36, 18 * u)
  const dx = hb.x + hb.w - 12 * u - r2
  const dcy = cy + r2 * 0.12
  const a0 = Math.PI * 0.75
  const span = Math.PI * 1.5
  const dmg = clamp(st.gauge.value / 100, 0, 1)
  ctx.strokeStyle = withAlpha(cream, 0.3)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(dx, dcy, r2, a0, a0 + span * reveal)
  ctx.stroke()
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (i / 10) * span
    const len = (i % 5 === 0 ? 4 : 2) * u
    ctx.strokeStyle = withAlpha(cream, i % 5 === 0 ? 0.6 : 0.3)
    ctx.beginPath()
    ctx.moveTo(dx + Math.cos(a) * (r2 + 2 * u), dcy + Math.sin(a) * (r2 + 2 * u))
    ctx.lineTo(dx + Math.cos(a) * (r2 + 2 * u + len), dcy + Math.sin(a) * (r2 + 2 * u + len))
    ctx.stroke()
  }
  const dmgK = clamp(dmg / 0.5, 0, 1)
  const pulse = st.dmgPulse > 0 ? st.dmgPulse / 0.7 : 0
  if (dmgK > 0.001) {
    ctx.strokeStyle = PAL.accentPink
    ctx.lineWidth = 2.4 + pulse * 2
    ctx.beginPath()
    ctx.arc(dx, dcy, r2, a0, a0 + span * dmgK)
    ctx.stroke()
  }
  ctx.fillStyle = cream
  ctx.textAlign = 'center'
  ctx.font = `italic ${Math.round(11 * u + pulse * 2)}px Georgia, serif`
  ctx.fillText(`${Math.round(st.gauge.value)}%`, dx, dcy + 1)
  ctx.font = `${Math.round(9 * u)}px Georgia, serif`
  ctx.fillStyle = withAlpha(cream, 0.55)
  ctx.textAlign = 'right'
  ctx.fillText('favo', dx - r2 - 8 * u, cy + 1)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function computeResult() {
  const dmg = st.gauge.value
  const goal = deliverTarget()
  const dNorm = Math.pow(clamp(st.delivered / goal, 0, 1), 1.5)
  const pestRatio = st.pestsSpawned > 0 ? clamp(st.captureValue / st.pestsSpawned, 0, 1) : 1
  const dmgNorm = clamp(1 - dmg / 25, 0, 1)
  const score = Math.round(clamp(100 * (0.6 * dNorm + 0.25 * pestRatio + 0.15 * dmgNorm), 0, 100))
  const nd = st.delivered
  const nc = st.captured
  let summary =
    `${nd} ${nd === 1 ? 'detrito removido' : 'detritos removidos'}, ` +
    `${nc} ${nc === 1 ? 'traça capturada' : 'traças capturadas'}, ` +
    `favo ${Math.round(dmg)}% danificado`
  if (st.resinUses > 0) summary += `; resina usada ${st.resinUses}×`
  return { score, summary }
}
