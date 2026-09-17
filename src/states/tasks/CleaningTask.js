// Tarefa: LIMPEZA — navegação + interceptação por reflexo no interior lotado da colmeia.
//
// A operária jovem recolhe detritos (cria morta, restos de cera) do favo e os
// leva até a entrada, desviando do trânsito das companheiras (colidir carregando
// = derrubar a carga). Larvas de traça-de-cera surgem em células, fogem de forma
// errática e roem o favo enquanto vivas (dano visível e crescente).
//
// Controles: mover = WASD/setas ou segurar o ponteiro (a abelha segue).
//            Ação (Espaço / toque rápido) = sem carga: investida curta em direção
//            ao alvo mais próximo; com carga: largar o detrito.
//            Pegar detrito / capturar larva = encostar.

import { create as createMovement } from '../../engine/MovementController.js'
import { create as createSpawner } from '../../engine/PatternSpawner.js'
import { create as createGauge } from '../../engine/Gauge.js'
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

const PAL = styleGuide.palettes.naturalist
const TAU = Math.PI * 2
const SHIFT_DURATION = 70
const END_FADE = 1.5

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
// Layout (depende do tamanho da tela)
// ---------------------------------------------------------------------------

function buildLayout(W, H) {
  const S = clamp(Math.min(W, H) / 720, 0.7, 1.7)
  const disc = { cx: W * 0.545, cy: H * 0.5, rx: W * 0.455, ry: H * 0.46 }
  const entrance = { x: Math.max(26 * S, W * 0.032), y: H * 0.5 }
  return {
    W, H, S,
    HS: clamp(S, 0.8, 1.3),
    disc,
    entrance,
    deliverRadius: 62 * S,
    bounds: { x: 14 * S, y: 18 * S, width: W - 28 * S, height: H - 36 * S },
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

function insideDisc(L, x, y, k = 1) {
  const nx = (x - L.disc.cx) / (L.disc.rx * k)
  const ny = (y - L.disc.cy) / (L.disc.ry * k)
  return nx * nx + ny * ny <= 1
}

// ---------------------------------------------------------------------------
// Camadas estáticas (pré-renderizadas)
// ---------------------------------------------------------------------------

function buildBackground(L, dpr) {
  const { W, H, S, disc, entrance: E } = L
  const { canvas, g } = makeCanvas(W, H, dpr)

  drawHiveInterior(g, { width: W, height: H, backgroundSeed: 31, combs: [] })

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
  g.fillRect(0, 0, W, H)
  const vg = g.createRadialGradient(disc.cx, disc.cy, Math.min(disc.rx, disc.ry) * 0.45, disc.cx, disc.cy, Math.max(disc.rx, disc.ry))
  vg.addColorStop(0, 'rgba(26, 18, 8, 0)')
  vg.addColorStop(1, 'rgba(26, 18, 8, 0.5)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
  g.restore()
  strokeHandDrawn(g, discPts, { color: INK_LINE, baseWidth: 2.2, widthJitter: 0.6, closed: true, seed: 12, opacity: 0.85 })

  // Túnel da entrada atravessando o invólucro.
  g.save()
  const tunnel = g.createLinearGradient(0, 0, disc.cx - disc.rx + 30 * S, 0)
  tunnel.addColorStop(0, 'rgba(20, 14, 6, 0.85)')
  tunnel.addColorStop(1, 'rgba(20, 14, 6, 0)')
  g.fillStyle = tunnel
  g.beginPath()
  g.ellipse(E.x + 30 * S, E.y, 90 * S, 70 * S, 0, 0, TAU)
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

function rebuildLayers(W, H) {
  const dpr = dprNow()
  const L = buildLayout(W, H)
  st.L = L
  st.dpr = dpr
  st.bg = buildBackground(L, dpr)
  st.beeSprites = buildBeeSprites(1.45 * L.S, dpr)
  const dmg = makeCanvas(W, H, dpr)
  st.damageCanvas = dmg.canvas
  st.damageCtx = dmg.g
  for (const m of st.marks) paintMark(m)
  for (const d of st.debris) d.sprite = buildDebrisSprite(d.type, d.seed, L.S, dpr)
  st.iconDebris = buildDebrisSprite('brood', 5, L.HS * 0.8, dpr)
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
// Dificuldade
// ---------------------------------------------------------------------------

function difficulty() {
  const p = clamp(st.time / SHIFT_DURATION, 0, 1)
  const d = Math.min(st.shiftIndex, 6)
  return {
    p,
    larvaInterval: Math.max(2.4, (9 - 4.8 * p) * (1 - 0.09 * d)),
    maxLarvae: 2 + Math.floor(p * 2.5) + Math.min(d, 3),
    patrollers: 3 + Math.floor(p * 4) + Math.min(d, 4),
    patrolSpeed: 95 * (1 + 0.08 * d),
    foragerRate: (0.16 + 0.28 * p) * (1 + 0.15 * d),
    foragerSpeed: 150 * (1 + 0.06 * d),
    fleeSpeed: 1 + 0.07 * d,
    damageRate: 0.3 * (1 + 0.1 * d),
  }
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
  const pos = randomDiscPoint(L.W * 0.32, 160 * L.S)
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
  const pos = randomDiscPoint(L.W * 0.22, 230 * L.S, 0.8)
  st.warnings.push({ x: pos.x, y: pos.y, t: 0, dur: 1.1 })
}

function spawnLarva(x, y) {
  const r = st.L.disc
  // Um spawner 'erratic' por larva: o PatternSpawner lê `fleeFrom` por
  // referência, então mutamos esse objeto a cada frame (fuga do jogador /
  // passeio). speed = 1 e update(dt * velocidade) permite variar a velocidade.
  // Não há API de spawn manual (spawnRate 0), então a entidade é inserida direto.
  const flee = { x, y }
  const spawner = createSpawner({
    pattern: 'erratic',
    spawnRate: 0,
    speed: 1,
    spawnPoint: { x, y },
    fleeFrom: flee,
    bounds: { x: r.cx - r.rx * 0.93, y: r.cy - r.ry * 0.93, width: r.rx * 1.86, height: r.ry * 1.86 },
    maxEntities: 1,
  })
  spawner.entities.push({ id: `larva-${st.larvaCounter++}`, x, y, _pathIndex: 0, _done: false })
  st.larvae.push({
    spawner, flee, home: { x, y }, target: { x, y }, wanderT: 0,
    dx: x, dy: y, heading: rand(0, TAU), anim: rand(0, 10), markX: x, markY: y,
    dodgeT: 0, dodgeSide: 1, seed: 1 + Math.floor(Math.random() * 999), age: 0, fleeing: false,
  })
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
    if (dist(p.x, p.y, pl.x, pl.y) > 220 * L.S) break
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
    sp.__speed = dif.foragerSpeed
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
  const reach = (forced ? rand(55, 85) : 34) * L.S
  let tx = pl.x + (dirX / len) * reach + (forced ? rand(-18, 18) * L.S : 0)
  let ty = pl.y + (dirY / len) * reach + (forced ? rand(-18, 18) * L.S : 0)
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

function doAction(tap) {
  const L = st.L
  const pl = st.mover.position
  if (st.carrying) {
    if (!tap || dist(tap.x, tap.y, pl.x, pl.y) < 70 * L.S) {
      dropCarried(Math.cos(st.heading), Math.sin(st.heading), false)
    }
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
  let dx, dy
  if (best) { dx = best.x - pl.x; dy = best.y - pl.y }
  else if (tap) { dx = tap.x - pl.x; dy = tap.y - pl.y }
  else { dx = Math.cos(st.heading); dy = Math.sin(st.heading) }
  const len = Math.hypot(dx, dy) || 1
  const power = 560 * L.S
  st.impX += (dx / len) * power
  st.impY += (dy / len) * power
  st.dashCd = 0.65
  st.dashT = 0.22
  fx('dash', pl.x, pl.y, { dur: 0.45, ang: Math.atan2(dy, dx) })
}

// ---------------------------------------------------------------------------
// Estado exportado
// ---------------------------------------------------------------------------

export default {
  id: 'cleaning',

  enter(context, data = {}) {
    const W = context.width
    const H = context.height
    st = {
      shiftIndex: Math.max(0, data?.shiftIndex ?? 0),
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
      larvaCounter: 0,
      nextLarva: 5.5,
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
      prevSpace: false,
      pendingTap: null,
      lastDmgStep: 0,
      dmgPulse: 0,
      tallyPulse: 0,
      capturePulse: 0,
      size: { W, H },
    }
    st.gauge = createGauge({ rate: 0, max: 100, min: 0, thresholds: { restless: 0.25, critical: 0.5 } })
    rebuildLayers(W, H)
    const L = st.L
    st.mover = createMovement({ bounds: L.bounds, speed: 250 * L.S })
    st.mover.setPosition(L.entrance.x + 140 * L.S, L.entrance.y + 40 * L.S)
    st.carryPoint = () => {
      const pl = st.mover.position
      const sc = 1.5 * st.L.S
      const flip = Math.cos(st.heading) < 0 ? -1 : 1
      const lx = 17 * sc
      const ly = 5 * sc * flip
      const c = Math.cos(st.heading), s = Math.sin(st.heading)
      return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c }
    }
    for (let i = 0; i < 3; i++) spawnDebris()
    for (let i = 0; i < 3; i++) addPatroller()
    for (const p of st.patrollers) p.fade = 1
    buildForagerSpawners()
    context.input.consumeClicks()
  },

  update(context, dt) {
    if (!st || st.finished) return
    const input = context.input

    // Redimensionamento: refaz camadas e reescala posições.
    if (context.width !== st.size.W || context.height !== st.size.H) {
      const kx = context.width / st.size.W
      const ky = context.height / st.size.H
      st.size = { W: context.width, H: context.height }
      rebuildLayers(context.width, context.height)
      const L = st.L
      const pl = st.mover.position
      st.mover = createMovement({ bounds: L.bounds, speed: 250 * L.S })
      st.mover.setPosition(pl.x * kx, pl.y * ky)
      for (const d of st.debris) { d.x *= kx; d.y *= ky; d.anim = null; if (d.state === 'air') d.state = 'floor' }
      for (const lv of st.larvae) {
        const e = lv.spawner.entities[0]
        if (e) { e.x *= kx; e.y *= ky }
        lv.dx *= kx; lv.dy *= ky; lv.markX *= kx; lv.markY *= ky; lv.home.x *= kx; lv.home.y *= ky
      }
      for (const w of st.warnings) { w.x *= kx; w.y *= ky }
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
        const result = computeResult()
        context.finishShift(result)
      }
      return
    }

    // Input de ação (Espaço com detecção de borda; toque/clique curto).
    const space = input.isKeyDown('Space')
    let actionTap = null
    let actionKey = space && !st.prevSpace
    st.prevSpace = space
    const clicks = input.consumeClicks()
    const pointer = input.getPointer()
    if (clicks.length) {
      const c = clicks[clicks.length - 1]
      st.pendingTap = { x: c.x, y: c.y, t: st.time }
    }
    if (st.pendingTap) {
      const age = st.time - st.pendingTap.t
      if (!input.isPointerDown()) {
        if (age < 0.28) actionTap = { x: st.pendingTap.x, y: st.pendingTap.y }
        st.pendingTap = null
      } else if (age >= 0.28) {
        st.pendingTap = null
      }
    }

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

    if (actionKey) doAction(null)
    else if (actionTap) doAction(actionTap)

    // ---- Movimento do jogador ----
    let ix = 0
    let iy = 0
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) ix -= 1
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) ix += 1
    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) iy -= 1
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) iy += 1
    const pl0 = st.mover.position
    if (ix === 0 && iy === 0 && input.isPointerDown()) {
      const dx = pointer.x - pl0.x
      const dy = pointer.y - pl0.y
      const dd = Math.hypot(dx, dy)
      if (dd > 6 * S) {
        const m = Math.min(1, dd / (70 * S))
        ix = (dx / dd) * m
        iy = (dy / dd) * m
      }
    } else {
      const m = Math.hypot(ix, iy)
      if (m > 1) { ix /= m; iy /= m }
    }
    const carry = st.carrying
    const speedMul = carry ? (carry.type === 'brood' ? 0.56 : 0.68) : 1
    const accel = carry ? (carry.type === 'brood' ? 3.2 : 4.2) : 11
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
    const mvX = st.velX * speedMul + st.impX / (250 * S)
    const mvY = st.velY * speedMul + st.impY / (250 * S)
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
    if (st.foragers.length && Math.abs(st.foragers[0].__speed - dif.foragerSpeed) > 8) buildForagerSpawners()
    for (const sp of st.foragers) {
      sp.spawnRate = dif.foragerRate
      for (const e of sp.entities) {
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
      const hitR = 31 * S
      const check = (bx, by, bee) => {
        const d = dist(bx, by, pl.x, pl.y)
        if (d >= hitR) return false
        const nx = (pl.x - bx) / (d || 1)
        const ny = (pl.y - by) / (d || 1)
        const hadCargo = !!st.carrying
        st.impX = nx * 330 * S
        st.impY = ny * 330 * S
        st.velX *= 0.2
        st.velY *= 0.2
        st.invuln = 0.75
        st.stun = hadCargo ? 0.45 : 0.25
        bee.bump = 0.35
        bee._bump = 0.35
        if (hadCargo) {
          dropCarried(nx, ny, true)
        } else {
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
        if (dist(d.x, d.y, pl.x, pl.y) < 30 * S) {
          d.state = 'carried'
          st.carrying = d
          fx('pickup', d.x, d.y, { dur: 0.45 })
        }
      }
    }
    st.debris = st.debris.filter((d) => d.state !== 'out')
    if (st.carrying) {
      const cp = st.carryPoint()
      st.carrying.x = cp.x
      st.carrying.y = cp.y
      if (dist(pl.x, pl.y, L.entrance.x, L.entrance.y) < L.deliverRadius) {
        const d = st.carrying
        st.carrying = null
        d.state = 'delivering'
        d.anim = { t: 0, dur: 0.55, fx: d.x, fy: d.y, tx: -30 * S, ty: L.entrance.y + rand(-10, 10) * S }
        st.delivered++
        st.tallyPulse = 0.6
        st.hitStop = 0.05
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

    // ---- Traças: movimento errático com fuga ----
    const fleeR = 175 * S
    const baseFlee = 250 * S * 1.2 * dif.fleeSpeed
    for (const lv of st.larvae) {
      const e = lv.spawner.entities[0]
      if (!e) continue
      lv.age += dt
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
        speed = baseFlee * (dp < 80 * S ? 1.2 : 1) * (0.75 + 0.25 * Math.min(1, lv.age / 1.5))
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
        speed = 55 * S
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
    const capR = (st.dashT > 0 ? 34 : 28) * S
    for (const lv of st.larvae) {
      const got = lv.spawner.checkCapture(pl, capR)
      if (got.length) {
        st.captured++
        st.capturePulse = 0.6
        st.hitStop = 0.08
        shake(3.5 * S, 0.18)
        fx('capture', lv.dx, lv.dy, { dur: 0.9, heading: lv.heading, seed: lv.seed })
        lv.dead = true
      }
    }
    st.larvae = st.larvae.filter((lv) => !lv.dead)

    // ---- Dano ----
    st.gauge.setRate(st.larvae.length * dif.damageRate)
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
    const { W, H, S } = L
    const t = st.time

    ctx.save()
    if (st.shakeMag > 0) ctx.translate(rand(-1, 1) * st.shakeMag, rand(-1, 1) * st.shakeMag)

    ctx.drawImage(st.bg, 0, 0, W, H)
    ctx.drawImage(st.damageCanvas, 0, 0, W, H)
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
      drawWaxMothLarva(ctx, createWaxMothLarvaPose(lv.dx, lv.dy, lv.anim / 3, { rotation: lv.heading, scale: sc, seed: lv.seed }))
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

    renderPlayer(ctx)
    renderFx(ctx)
    ctx.restore()

    renderHud(ctx)

    if (st.time >= SHIFT_DURATION) {
      const k = clamp(st.endT / END_FADE, 0, 1)
      ctx.save()
      ctx.fillStyle = `rgba(26, 20, 16, ${0.7 * ease(k, 'easeInOutQuad')})`
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
      renderHud(ctx, true)
    }
  },

  exit() {
    st = null
  },
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderEntranceGlow(ctx) {
  const L = st.L
  const { S } = L
  const E = L.entrance
  const carrying = !!st.carrying
  const breath = 0.5 + 0.5 * Math.sin(st.time * 1.3)
  const strength = carrying ? 0.32 + 0.1 * breath : 0.14 + 0.06 * breath
  const R = (carrying ? 170 : 130) * S
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
    ctx.arc(E.x, E.y, L.deliverRadius, -Math.PI * 0.5, Math.PI * 0.5)
    ctx.stroke()
    ctx.setLineDash([])
    for (let i = -4; i <= 4; i++) {
      const a = (i / 4) * Math.PI * 0.45
      const r0 = L.deliverRadius
      ctx.beginPath()
      ctx.moveTo(E.x + Math.cos(a) * r0, E.y + Math.sin(a) * r0)
      ctx.lineTo(E.x + Math.cos(a) * (r0 + (i % 2 ? 3 : 6) * S), E.y + Math.sin(a) * (r0 + (i % 2 ? 3 : 6) * S))
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
  if (Math.cos(heading) < 0) ctx.scale(1, -1)
  if (scale !== 1) ctx.scale(scale, scale)
  ctx.globalAlpha = alpha
  ctx.drawImage(img, -spr.box / 2, -spr.box / 2, spr.box, spr.box)
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
    ctx.arc(pl.x, pl.y, 34 * S, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - st.dashCd / 0.65))
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
  const flip = Math.cos(st.heading) < 0
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

function renderHud(ctx, final = false) {
  const L = st.L
  const { W, HS } = L
  const t = st.time
  const reveal = ease(clamp(t / 1.4, 0, 1), 'easeInOutCubic')
  const cx = W - 78 * HS
  const cy = 80 * HS
  const R = 52 * HS
  const cream = PAL.paperCreamLight
  const p = clamp(t / SHIFT_DURATION, 0, 1)
  const lastSecs = SHIFT_DURATION - t < 10 && !final

  ctx.save()
  ctx.lineCap = 'round'

  // Disco de fundo translúcido para leitura.
  const bgG = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5)
  bgG.addColorStop(0, 'rgba(26, 20, 16, 0.55)')
  bgG.addColorStop(1, 'rgba(26, 20, 16, 0)')
  ctx.fillStyle = bgG
  ctx.fillRect(cx - R * 1.6, cy - R * 1.6, R * 3.2, R * 3.2)

  // Mostrador do tempo: círculo fino + marcas de escala reveladas progressivamente.
  const top = -Math.PI / 2
  ctx.strokeStyle = withAlpha(cream, 0.28)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, R, top, top + TAU * reveal)
  ctx.stroke()
  const ticks = 70
  for (let i = 0; i < ticks * reveal; i++) {
    const a = top + (i / ticks) * TAU
    const major = i % 10 === 0
    const passed = i / ticks <= p
    const len = (major ? 7 : 3) * HS
    ctx.strokeStyle = withAlpha(cream, passed ? 0.22 : major ? 0.7 : 0.42)
    ctx.lineWidth = major ? 1.2 : 0.8
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * (R + 3 * HS), cy + Math.sin(a) * (R + 3 * HS))
    ctx.lineTo(cx + Math.cos(a) * (R + 3 * HS + len), cy + Math.sin(a) * (R + 3 * HS + len))
    ctx.stroke()
  }
  const timeCol = lastSecs && Math.sin(t * 10) > 0 ? PAL.sunHalo : PAL.sunGold
  ctx.strokeStyle = timeCol
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.arc(cx, cy, R, top, top + TAU * p * reveal)
  ctx.stroke()
  const ea = top + TAU * p * reveal
  ctx.fillStyle = timeCol
  ctx.beginPath()
  ctx.arc(cx + Math.cos(ea) * R, cy + Math.sin(ea) * R, 2.6 * HS, 0, TAU)
  ctx.fill()

  // Transferidor interno: dano no favo (único uso de accentPink na cena).
  const r2 = 34 * HS
  const a0 = Math.PI * 0.75
  const span = Math.PI * 1.5
  const dmg = clamp(st.gauge.value / 100, 0, 1)
  ctx.strokeStyle = withAlpha(cream, 0.3)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, r2, a0, a0 + span * reveal)
  ctx.stroke()
  for (let i = 0; i <= 20; i++) {
    if (i / 20 > reveal) break
    const a = a0 + (i / 20) * span
    const len = (i % 5 === 0 ? 5 : 2) * HS
    ctx.strokeStyle = withAlpha(cream, i % 5 === 0 ? 0.6 : 0.3)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * (r2 - 2 * HS), cy + Math.sin(a) * (r2 - 2 * HS))
    ctx.lineTo(cx + Math.cos(a) * (r2 - 2 * HS - len), cy + Math.sin(a) * (r2 - 2 * HS - len))
    ctx.stroke()
  }
  // Escala do dano: 0–50% ocupa o arco todo (acima disso fica cheio e pulsa).
  const dmgK = clamp(dmg / 0.5, 0, 1)
  const pulse = st.dmgPulse > 0 ? st.dmgPulse / 0.7 : 0
  if (dmgK > 0.001) {
    ctx.strokeStyle = PAL.accentPink
    ctx.lineWidth = 2.4 + pulse * 2
    ctx.beginPath()
    ctx.arc(cx, cy, r2, a0, a0 + span * dmgK)
    ctx.stroke()
  }
  const na = a0 + span * dmgK
  ctx.strokeStyle = withAlpha(cream, 0.75)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(na) * (r2 - 9 * HS), cy + Math.sin(na) * (r2 - 9 * HS))
  ctx.stroke()
  ctx.fillStyle = withAlpha(cream, 0.8)
  ctx.beginPath()
  ctx.arc(cx, cy, 2 * HS, 0, TAU)
  ctx.fill()
  ctx.globalAlpha = reveal
  ctx.fillStyle = cream
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `italic ${Math.round(12 * HS + pulse * 3)}px Georgia, serif`
  ctx.fillText(`${Math.round(st.gauge.value)}%`, cx, cy + r2 * 0.62)

  // Mini-diagramas: detritos entregues e traças capturadas.
  const iconR = 15 * HS
  const ix = cx - R - 44 * HS
  const iy1 = cy - 20 * HS
  const iy2 = cy + 22 * HS
  const tallyK = st.tallyPulse / 0.6
  const capK = st.capturePulse / 0.6
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(cream, 0.5 + 0.5 * tallyK)
  ctx.beginPath()
  ctx.arc(ix, iy1, iconR + tallyK * 4 * HS, 0, TAU)
  ctx.stroke()
  const ic = st.iconDebris
  ctx.drawImage(ic.canvas, ix - ic.box / 2, iy1 - ic.box / 2, ic.box, ic.box)
  ctx.strokeStyle = withAlpha(cream, 0.5 + 0.5 * capK)
  ctx.beginPath()
  ctx.arc(ix, iy2, iconR + capK * 4 * HS, 0, TAU)
  ctx.stroke()
  drawWaxMothLarva(ctx, createWaxMothLarvaPose(ix, iy2, t, { scale: 0.95 * HS, seed: 4 }))
  ctx.textAlign = 'right'
  ctx.font = `${Math.round(17 * HS + tallyK * 4)}px Georgia, serif`
  ctx.fillText(String(st.delivered), ix - iconR - 8 * HS, iy1 + 1)
  ctx.font = `${Math.round(17 * HS + capK * 4)}px Georgia, serif`
  ctx.fillText(String(st.captured), ix - iconR - 8 * HS, iy2 + 1)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function computeResult() {
  const d = Math.min(st.shiftIndex, 4)
  const dmg = st.gauge.value
  const deliverTarget = 9 + 0.5 * d
  const dNorm = clamp(st.delivered / deliverTarget, 0, 1)
  const pestRatio = st.pestsSpawned > 0 ? st.captured / st.pestsSpawned : 1
  const dmgNorm = clamp(1 - dmg / 50, 0, 1)
  const score = Math.round(clamp(100 * (0.4 * dNorm + 0.3 * pestRatio + 0.3 * dmgNorm), 0, 100))
  const nd = st.delivered
  const nc = st.captured
  const summary =
    `${nd} ${nd === 1 ? 'detrito removido' : 'detritos removidos'}, ` +
    `${nc} ${nc === 1 ? 'traça capturada' : 'traças capturadas'}, ` +
    `favo ${Math.round(dmg)}% danificado`
  return { score, summary }
}
