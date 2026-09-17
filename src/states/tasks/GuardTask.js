// Tarefa: Defesa da entrada — a operária como guardiã.
//
// Gênero: reconhecimento visual + reflexo de ataque.
// A guardiã fica presa à zona da entrada (anel técnico em volta do gargalo de
// barro/geoprópolis). Chegam, misturados: formigas em fila pelo tronco/galho
// (PatternSpawner 'file'), moscas-forídeas nervosas (voo em arrancadas e
// pausas, às vezes "pegando carona" atrás de uma forrageira — comportamento
// real dos forídeos) e forrageiras legítimas voltando com bolotas de pólen,
// voo reto/calmo e um leve halo dourado de cheiro da colônia.
//
// Controles: mover = WASD/setas ou segurar o ponteiro; ação = Espaço/clique
// (investida com preparo 0,25s + recarga). Sem texto de tutorial.

import createMovement from '../../engine/MovementController.js'
import createPatternSpawner from '../../engine/PatternSpawner.js'
import { ease, lerp } from '../../engine/tween.js'
import { createFlightPose, createCarryingPose, drawBeeBody } from '../../art/bee.js'
import { createAntPose, drawAnt, createPhoridFlyPose, drawPhoridFly } from '../../art/creatures.js'
import { drawBackground, drawLightOverlay } from '../../art/environment.js'
import {
  seededRandom,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  polygonPoints,
  tracePath,
  mixColors,
  withAlpha,
  INK_LINE,
} from '../../art/textureUtils.js'
import { styleGuide } from '../../data/styleGuide.js'

const P = styleGuide.palettes.naturalist
const TAU = Math.PI * 2

// --- Ritmo do turno ---------------------------------------------------------
const DURATION = 70
const WAVES = 5
const WAVE_FIRST = 1.2
const WAVE_STEP = 13.7
const WAVE_LEN = 11.4
const OUTRO = 1.8

// --- Investida --------------------------------------------------------------
const WINDUP = 0.25
const LUNGE = 0.12
const RECOVER_MISS = 0.8
const RECOVER_HIT = 0.6
const BUFFER = 0.14

// --- Cores de barro / geoprópolis e casca (mutadas contra o papel) ----------
const CLAY_LIGHT = mixColors('#BFA27A', P.paperCreamDark, 0.15)
const CLAY_MID = mixColors('#8C6B4A', P.paperCreamDark, 0.12)
const CLAY_DARK = mixColors('#634832', P.paperCreamDark, 0.08)
const RESIN = '#46301F'
const BARK_MID = mixColors(P.paperCreamDark, '#7A6446', 0.5)
const BARK_EDGE = mixColors(P.paperCreamDark, '#4E3E2A', 0.62)
const BARK_LIGHT = mixColors(P.paperCreamLight, '#8C7858', 0.3)

const rand = (a = 0, b = 1) => a + Math.random() * (b - a)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const angDiff = (a, b) => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

let st = null

// ============================================================================
// Layout + camadas estáticas
// ============================================================================

function computeLayout(w, h) {
  const m = Math.min(w, h)
  const s = clamp(m / 720, 0.62, 1.5)
  const cx = w / 2
  const cy = h * 0.53
  const R = Math.min(m * 0.27, 190 * s)
  const tw = clamp(w * 0.5, 2.3 * R + 60 * s, w * 0.86)
  const L = { w, h, s, cx, cy, R, tw }
  L.trunkX = (side, y) => {
    const flare = Math.pow(clamp(y / h, 0, 1), 3) * 34 * s
    const wob = Math.sin(y * 0.0042 + (side < 0 ? 0.7 : 2.1)) * 12 * s + Math.sin(y * 0.013 + side) * 4 * s
    return cx + side * (tw / 2 + flare) + wob
  }
  L.by = cy - R * 1.3
  L.xr = L.trunkX(1, L.by) - 6 * s
  L.branchY = (x) => L.by - (x - L.xr) * 0.2 + Math.sin((x - L.xr) * 0.011) * 7 * s
  L.branchThick = (x) => lerp(34 * s, 20 * s, clamp((x - L.xr) / Math.max(1, w - L.xr + 40), 0, 1))
  L.routes = buildRoutes(L)
  return L
}

function buildRoutes(L) {
  const { w, h, s, cx, cy, tw } = L
  const top = []
  const steps = 9
  for (let k = 0; k <= steps; k++) {
    const u = k / steps
    const y = lerp(-26, cy, u)
    const x = cx + tw * 0.16 * Math.pow(1 - u, 1.3) + Math.sin(u * 7.1) * 9 * s * (1 - u)
    top.push({ x, y })
  }
  const bottom = []
  for (let k = 0; k <= steps; k++) {
    const u = k / steps
    const y = lerp(h + 26, cy, u)
    const x = cx - tw * 0.2 * Math.pow(1 - u, 1.2) + Math.sin(u * 6.3 + 1) * 10 * s * (1 - u)
    bottom.push({ x, y })
  }
  const branch = []
  const xEnd = w + 26
  for (let k = 0; k <= 6; k++) {
    const x = lerp(xEnd, L.xr, k / 6)
    branch.push({ x, y: L.branchY(x) - L.branchThick(x) * 0.15 })
  }
  for (let k = 1; k <= 4; k++) {
    const u = k / 4
    branch.push({ x: lerp(L.xr, cx, u), y: lerp(L.by, cy, ease(u, 'easeInOutQuad')) })
  }
  const mk = (path) => {
    const a = path[path.length - 2]
    return { path, angle: Math.atan2(a.y - cy, a.x - cx), busy: 0 }
  }
  return [mk(top), mk(bottom), mk(branch)]
}

function makeCanvas(w, h, dpr) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { c, g }
}

function buildStatic(L, dpr) {
  const { w, h } = L
  const { c, g } = makeCanvas(w, h, dpr)
  drawBackground(g, 'day', { width: w, height: h, seed: 311 })
  drawBranch(g, L)
  drawTrunk(g, L)
  drawLightOverlay(g, 'day', { width: w, height: h, cx: w * 0.74, cy: h * 0.12 })
  // vinheta quente e suave (sem preto)
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
  v.addColorStop(0, 'rgba(43,36,24,0)')
  v.addColorStop(1, 'rgba(43,36,24,0.16)')
  g.fillStyle = v
  g.fillRect(0, 0, w, h)
  return c
}

function drawTrunk(g, L) {
  const { w, h, s, cx, cy, R } = L
  const left = []
  const right = []
  for (let y = -30; y <= h + 30; y += 18) {
    left.push({ x: L.trunkX(-1, y), y })
    right.push({ x: L.trunkX(1, y), y })
  }
  const outline = [...left, ...right.slice().reverse()]
  const x0 = Math.min(...left.map((p) => p.x))
  const x1 = Math.max(...right.map((p) => p.x))

  g.save()
  // sombra projetada do tronco sobre o papel
  g.save()
  g.translate(8 * s, 4 * s)
  g.beginPath()
  tracePath(g, outline, { closed: true, smooth: true })
  g.fillStyle = 'rgba(43,36,24,0.10)'
  g.fill()
  g.restore()

  g.beginPath()
  tracePath(g, outline, { closed: true, smooth: true })
  const grad = g.createLinearGradient(x0, 0, x1, 0)
  grad.addColorStop(0, BARK_EDGE)
  grad.addColorStop(0.22, BARK_MID)
  grad.addColorStop(0.45, BARK_LIGHT)
  grad.addColorStop(0.78, BARK_MID)
  grad.addColorStop(1, BARK_EDGE)
  g.fillStyle = grad
  g.fill()
  g.clip()

  // hachura vertical seguindo as fibras
  const diag = Math.hypot(x1 - x0, h + 60)
  drawHatching(g, { x: x0, y: -30, width: x1 - x0, height: h + 60 }, {
    angle: Math.PI / 2, lineCount: Math.round(diag / 4.2), color: P.inkLine,
    opacityRange: [0.07, 0.18], seed: 57, curveAmount: 7 * s, segments: 14,
  })

  // fissuras da casca: sulco escuro + crista clara
  const rng = seededRandom(803)
  const nF = Math.round((x1 - x0) / (16 * s))
  for (let i = 0; i < nF; i++) {
    const fx = lerp(x0, x1, rng())
    let fy = rng() * h - 60 * s
    const len = (70 + rng() * 260) * s
    const pts = []
    const ph = rng() * 10
    for (let d = 0; d <= len; d += 12 * s) {
      pts.push({ x: fx + Math.sin(d * 0.03 + ph) * 3.5 * s + (rng() - 0.5) * 1.5 * s, y: fy + d })
    }
    if (Math.hypot(fx - cx, fy + len / 2 - cy) < R * 0.55) continue
    strokeHandDrawn(g, pts, { color: P.inkLine, baseWidth: (0.9 + rng()) * Math.max(1, s), widthJitter: 0.5, seed: 900 + i, opacity: 0.28 + rng() * 0.25 })
    const hl = pts.map((p) => ({ x: p.x + 2.2 * s, y: p.y }))
    strokeHandDrawn(g, hl, { color: P.paperCreamLight, baseWidth: 0.8, widthJitter: 0.3, seed: 1400 + i, opacity: 0.22 })
    fy += len
  }

  // sombra de volume nas bordas
  drawStipple(g, { x: x0, y: 0, width: x1 - x0, height: h }, {
    color: P.inkLine, count: Math.round(((x1 - x0) * h) / 260), seed: 61,
    radius: [0.4, 1.2], opacity: [0.06, 0.2],
    densityBias: (u) => Math.pow(Math.abs(u - 0.5) * 2, 2.2),
  })

  // manchas de líquen (sálvia) longe da entrada
  const lr = seededRandom(4411)
  for (let i = 0; i < 7; i++) {
    const lx = lerp(x0 + 20 * s, x1 - 20 * s, lr())
    const ly = lr() * h
    if (Math.hypot(lx - cx, ly - cy) < R * 1.1) continue
    const rx = (14 + lr() * 26) * s
    const pts = polygonPoints(lx, ly, rx, rx * (0.6 + lr() * 0.4), 18, { jitter: 0.28, seed: 50 + i, rotation: lr() * 3 })
    g.save()
    g.beginPath()
    tracePath(g, pts, { closed: true })
    g.globalAlpha = 0.55
    g.fillStyle = i % 2 ? P.leafSage : P.leafSageHighlight
    g.fill()
    g.globalAlpha = 1
    g.clip()
    drawStipple(g, { x: lx - rx, y: ly - rx, width: rx * 2, height: rx * 2 }, {
      color: P.leafSageShadow, count: 40, seed: 70 + i, radius: [0.5, 1.5], opacity: [0.2, 0.45],
    })
    g.restore()
    strokeHandDrawn(g, pts, { color: P.leafSageShadow, baseWidth: 0.8, widthJitter: 0.3, closed: true, seed: 80 + i, opacity: 0.6 })
  }
  g.restore()

  strokeHandDrawn(g, left, { color: P.inkLine, baseWidth: 2.2, widthJitter: 0.7, seed: 11, opacity: 0.85 })
  strokeHandDrawn(g, right, { color: P.inkLine, baseWidth: 2.2, widthJitter: 0.7, seed: 12, opacity: 0.85 })
}

function drawBranch(g, L) {
  const { w, s } = L
  const xStart = L.xr - 10 * s
  const xEnd = w + 40
  const upper = []
  const lower = []
  for (let x = xStart; x <= xEnd; x += 16) {
    const t = L.branchThick(x)
    upper.push({ x, y: L.branchY(x) - t / 2 })
    lower.push({ x, y: L.branchY(x) + t / 2 })
  }
  const outline = [...upper, ...lower.slice().reverse()]
  g.save()
  g.beginPath()
  tracePath(g, outline, { closed: true })
  g.fillStyle = BARK_MID
  g.fill()
  g.clip()
  drawHatching(g, { x: xStart, y: L.by - 90 * s, width: xEnd - xStart, height: 140 * s }, {
    angle: -0.2, lineCount: 40, color: P.inkLine, opacityRange: [0.08, 0.2], seed: 91, curveAmount: 3 * s, segments: 10,
  })
  drawStipple(g, { x: xStart, y: L.by - 70 * s, width: xEnd - xStart, height: 120 * s }, {
    color: P.inkLine, count: 220, seed: 92, opacity: [0.06, 0.18],
    densityBias: (u, v) => v,
  })
  g.restore()
  strokeHandDrawn(g, upper, { color: P.inkLine, baseWidth: 1.8, widthJitter: 0.5, seed: 21, opacity: 0.8 })
  strokeHandDrawn(g, lower, { color: P.inkLine, baseWidth: 2, widthJitter: 0.5, seed: 22, opacity: 0.85 })

  // duas folhas de sálvia saindo do galho perto da borda
  const leaves = [
    { x: w - 70 * s, a: -1.1, len: 58 },
    { x: w - 140 * s, a: 0.9, len: 46 },
  ]
  leaves.forEach((lf, i) => {
    if (lf.x < L.xr + 30 * s) return
    const bx = lf.x
    const byy = L.branchY(bx)
    const len = lf.len * s
    g.save()
    g.translate(bx, byy)
    g.rotate(lf.a)
    const pts = []
    for (let k = 0; k <= 10; k++) {
      const u = k / 10
      pts.push({ x: u * len, y: -Math.sin(u * Math.PI) * len * 0.22 })
    }
    for (let k = 10; k >= 0; k--) {
      const u = k / 10
      pts.push({ x: u * len, y: Math.sin(u * Math.PI) * len * 0.2 })
    }
    g.beginPath()
    tracePath(g, pts, { closed: true })
    g.fillStyle = P.leafSage
    g.fill()
    g.save()
    g.clip()
    drawHatching(g, { x: 0, y: -len * 0.25, width: len, height: len * 0.5 }, {
      angle: 0.6, lineCount: 18, color: P.leafSageShadow, opacityRange: [0.2, 0.4], seed: 130 + i, curveAmount: 2,
    })
    g.restore()
    strokeHandDrawn(g, pts, { color: P.inkLine, baseWidth: 1.1, widthJitter: 0.3, closed: true, seed: 140 + i, opacity: 0.75 })
    strokeHandDrawn(g, [{ x: 0, y: 0 }, { x: len * 0.5, y: -1 }, { x: len * 0.95, y: 0 }], { color: P.leafSageShadow, baseWidth: 0.7, seed: 150 + i, opacity: 0.8 })
    g.restore()
  })
}

// Entrada da Mandaçaia: pequeno montículo de barro + geoprópolis com raios
// convergentes para um orifício que só deixa passar uma abelha por vez.
function buildEntrance(L, dpr) {
  const { s } = L
  const rOut = 66 * s
  const rHole = 10.5 * s
  const pad = rOut * 1.4
  const { c, g } = makeCanvas(pad * 2, pad * 2, dpr)
  g.translate(pad, pad)
  const rng = seededRandom(9127)

  const sh = g.createRadialGradient(4 * s, 7 * s, rOut * 0.4, 4 * s, 7 * s, rOut * 1.32)
  sh.addColorStop(0, 'rgba(43,36,24,0.38)')
  sh.addColorStop(1, 'rgba(43,36,24,0)')
  g.fillStyle = sh
  g.beginPath()
  g.arc(4 * s, 7 * s, rOut * 1.32, 0, TAU)
  g.fill()

  const mound = polygonPoints(0, 0, rOut, rOut * 0.94, 46, { jitter: 0.07, seed: 71 })
  g.save()
  g.beginPath()
  tracePath(g, mound, { closed: true })
  const mg = g.createRadialGradient(-rOut * 0.3, -rOut * 0.35, rHole, 0, 0, rOut * 1.05)
  mg.addColorStop(0, CLAY_LIGHT)
  mg.addColorStop(0.55, CLAY_MID)
  mg.addColorStop(1, CLAY_DARK)
  g.fillStyle = mg
  g.fill()
  g.clip()

  // raios torcidos convergindo ao orifício
  const n = 34
  const twist = 0.2
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + (rng() - 0.5) * 0.06
    const a1 = ((i + 1) / n) * TAU + (rng() - 0.5) * 0.06
    const ri = rHole * 1.3
    const ro = rOut * (0.8 + rng() * 0.32)
    const edge = (a) => {
      const pts = []
      for (let k = 0; k <= 7; k++) {
        const u = k / 7
        const r = lerp(ri, ro, u)
        const ang = a + twist * Math.pow(u, 1.4)
        pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r })
      }
      return pts
    }
    const e0 = edge(a0)
    const e1 = edge(a1 - 0.02)
    const wedge = [...e0, ...e1.slice().reverse()]
    g.beginPath()
    tracePath(g, wedge, { closed: true, smooth: false })
    // luz de cima-esquerda: raios voltados para a luz ficam mais claros
    const mid = (a0 + a1) / 2 + twist * 0.5
    const lit = 0.5 + 0.5 * Math.cos(mid - (-2.3))
    g.fillStyle = mixColors(i % 2 ? '#8C6B4A' : '#634832', i % 2 ? '#C9AE86' : '#46301F', clamp(0.25 + rng() * 0.3 + (i % 2 ? lit * 0.3 : (1 - lit) * 0.3), 0, 1))
    g.globalAlpha = 0.78
    g.fill()
    g.globalAlpha = 1
    strokeHandDrawn(g, e0, { color: P.inkLine, baseWidth: 0.9 * Math.max(0.8, s), widthJitter: 0.35, seed: 300 + i, opacity: 0.5 })
    // crista clara ao lado do sulco
    const crest = e0.map((p, k) => {
      const ang = Math.atan2(p.y, p.x) + 0.045 * (1 - k / 9)
      const r = Math.hypot(p.x, p.y)
      return { x: Math.cos(ang) * r, y: Math.sin(ang) * r }
    })
    strokeHandDrawn(g, crest.slice(1), { color: P.paperCreamLight, baseWidth: 0.6, widthJitter: 0.2, seed: 500 + i, opacity: 0.28 })
  }
  drawHatching(g, { x: -rOut, y: -rOut, width: rOut * 2, height: rOut * 2 }, {
    angle: 0.8, lineCount: 46, color: P.inkLine, opacityRange: [0.05, 0.14], seed: 77, curveAmount: 3 * s,
  })
  // grânulos de barro (pelotas trazidas nas mandíbulas)
  drawStipple(g, { x: -rOut, y: -rOut, width: rOut * 2, height: rOut * 2 }, {
    color: P.paperCreamLight, count: 190, seed: 78, radius: [0.5 * s, 1.5 * s], opacity: [0.14, 0.34],
  })
  drawStipple(g, { x: -rOut, y: -rOut, width: rOut * 2, height: rOut * 2 }, {
    color: P.inkLine, count: 260, seed: 79, radius: [0.4, 1.1], opacity: [0.1, 0.28],
    densityBias: (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2
      return clamp(1 - Math.abs(d - 0.35) * 2.2, 0.05, 1)
    },
  })
  g.restore()
  strokeHandDrawn(g, mound, { color: P.inkLine, baseWidth: 1.7, widthJitter: 0.55, closed: true, seed: 72, opacity: 0.85 })

  // lábio elevado em volta do orifício
  const lip = polygonPoints(0, 0, rHole * 2.0, rHole * 1.9, 22, { jitter: 0.08, seed: 73 })
  g.beginPath()
  tracePath(g, lip, { closed: true })
  const lg = g.createRadialGradient(-rHole * 0.6, -rHole * 0.8, rHole * 0.4, 0, 0, rHole * 2.1)
  lg.addColorStop(0, CLAY_LIGHT)
  lg.addColorStop(1, CLAY_DARK)
  g.fillStyle = lg
  g.fill()
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU
    strokeHandDrawn(g, [
      { x: Math.cos(a) * rHole * 1.15, y: Math.sin(a) * rHole * 1.15 },
      { x: Math.cos(a + 0.12) * rHole * 1.6, y: Math.sin(a + 0.12) * rHole * 1.6 },
      { x: Math.cos(a + 0.2) * rHole * 1.9, y: Math.sin(a + 0.2) * rHole * 1.9 },
    ], { color: P.inkLine, baseWidth: 0.6, seed: 700 + i, opacity: 0.35 })
  }
  strokeHandDrawn(g, lip, { color: P.inkLine, baseWidth: 1.2, widthJitter: 0.4, closed: true, seed: 74, opacity: 0.7 })

  // orifício
  const hole = polygonPoints(0, 0.5 * s, rHole, rHole * 0.9, 18, { jitter: 0.08, seed: 75 })
  g.beginPath()
  tracePath(g, hole, { closed: true })
  const hg = g.createRadialGradient(0, rHole * 0.25, 0, 0, 0, rHole * 1.1)
  hg.addColorStop(0, '#0C0805')
  hg.addColorStop(0.7, '#1E150C')
  hg.addColorStop(1, '#3A2A1A')
  g.fillStyle = hg
  g.fill()
  strokeHandDrawn(g, hole, { color: P.inkLine, baseWidth: 1.4, widthJitter: 0.4, closed: true, seed: 76, opacity: 0.9 })
  g.beginPath()
  g.arc(0, 0.5 * s, rHole * 0.95, 0.35, Math.PI - 0.35)
  g.strokeStyle = withAlpha(P.paperCreamLight, 0.35)
  g.lineWidth = 1
  g.stroke()

  return { canvas: c, pad, rOut, rHole }
}

function buildOverlayPath(L) {
  const { R, s } = L
  const p = new Path2D()
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180 - Math.PI / 2
    const len = d % 30 === 0 ? 8 * s : d % 15 === 0 ? 5 * s : 2.5 * s
    p.moveTo(Math.cos(a) * R, Math.sin(a) * R)
    p.lineTo(Math.cos(a) * (R + len), Math.sin(a) * (R + len))
  }
  return p
}

function ensureLayout(context) {
  const w = context.width
  const h = context.height
  if (st.L && st.L.w === w && st.L.h === h) return
  const dpr = context.renderer?.dpr || window.devicePixelRatio || 1
  const oldRoutesBusy = st.L ? st.L.routes.map((r) => r.busy) : null
  st.L = computeLayout(w, h)
  if (oldRoutesBusy) st.L.routes.forEach((r, i) => { r.busy = oldRoutesBusy[i] })
  st.dpr = dpr
  st.sprites = new Map()
  st.bg = buildStatic(st.L, dpr)
  st.entrance = buildEntrance(st.L, dpr)
  st.ticks = buildOverlayPath(st.L)
  rebuildMarksLayer()
  const { cx, cy, R, s } = st.L
  st.player.ctrl = rebuildController(st.player.ctrl, cx, cy, R, s)
}

function rebuildController(prev, cx, cy, R, s) {
  const ctrl = createMovement({ bounds: { x: cx - R, y: cy - R, width: R * 2, height: R * 2 }, speed: 250 * s })
  if (prev) ctrl.setPosition(prev.position.x, prev.position.y)
  else ctrl.setPosition(cx, cy + R * 0.35)
  const p = ctrl.position
  const d = Math.hypot(p.x - cx, p.y - cy)
  if (d > R) ctrl.setPosition(cx + ((p.x - cx) / d) * R, cy + ((p.y - cy) / d) * R)
  return ctrl
}

// ============================================================================
// Spawns
// ============================================================================

function edgePoint(angle) {
  const { w, h, cx, cy } = st.L
  const m = 34
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let t = Infinity
  if (dx > 1e-4) t = Math.min(t, (w + m - cx) / dx)
  if (dx < -1e-4) t = Math.min(t, (-m - cx) / dx)
  if (dy > 1e-4) t = Math.min(t, (h + m - cy) / dy)
  if (dy < -1e-4) t = Math.min(t, (-m - cy) / dy)
  return { x: cx + dx * t, y: cy + dy * t }
}

function levelAt(t) {
  const wv = waveAt(t)
  return Math.min(5.6, wv.index + clamp(wv.local / WAVE_LEN, 0, 1) * 0.6 + Math.min(1.8, st.shift * 0.35))
}

function waveAt(t) {
  const i = clamp(Math.floor((t - WAVE_FIRST) / WAVE_STEP), 0, WAVES - 1)
  const local = t - (WAVE_FIRST + i * WAVE_STEP)
  return { index: i, local, inWave: local >= 0 && local <= WAVE_LEN }
}

function spawnForager(lvl, angle = rand(0, TAU)) {
  const { s, cx, cy } = st.L
  const p = edgePoint(angle)
  const f = {
    x: p.x, y: p.y,
    dir: Math.atan2(cy - p.y, cx - p.x) + rand(-0.4, 0.4),
    speed: rand(78, 92) * s,
    state: 'fly', t: rand(0, 5), seed: (Math.random() * 1e6) | 0,
    vx: 0, vy: 0, spin: 0, dazeT: 0, enterT: 0, trail: [], trailT: 0,
  }
  st.foragers.push(f)
  const tailChance = lvl >= 2.2 ? Math.min(0.42, 0.11 * (lvl - 1.6)) : 0
  if (Math.random() < tailChance) {
    const fl = makeFly(p.x - Math.cos(f.dir) * 30 * s, p.y - Math.sin(f.dir) * 30 * s, lvl)
    fl.mode = 'tail'
    fl.host = f
  }
  return f
}

function makeFly(x, y, lvl) {
  const { s } = st.L
  const f = {
    x, y, t: rand(0, 3), seed: (Math.random() * 1e6) | 0,
    mode: 'hover', hoverT: 0.02, wx: x, wy: y, angle: 0,
    speed: (145 + 11 * lvl) * s * rand(0.9, 1.1),
    hoverMul: Math.max(0.45, 1 - 0.07 * lvl),
    dodgeChance: Math.min(0.55, 0.08 + 0.07 * lvl),
    dodgeDelay: -1, host: null,
  }
  st.flies.push(f)
  st.stats.spawned++
  return f
}

function spawnFly(angle, lvl) {
  const p = edgePoint(angle)
  return makeFly(p.x, p.y, lvl)
}

function pickRoute(avoidAngle = null) {
  const free = st.L.routes.filter((r) => r.busy === 0)
  let pool = free.length ? free : st.L.routes
  if (avoidAngle != null) {
    pool = pool.slice().sort((a, b) => Math.abs(angDiff(b.angle, avoidAngle)) - Math.abs(angDiff(a.angle, avoidAngle)))
    return pool[0]
  }
  return pool[(Math.random() * pool.length) | 0]
}

function spawnAntColumn(route, lvl) {
  const { s } = st.L
  const speed = (44 + 4.5 * lvl) * s
  // intervalo entre formigas ~ ciclo de investida: fila vencível, mas sem folga
  const gap = Math.max(0.85, rand(1.05, 1.35) - 0.04 * lvl)
  const total = Math.min(7, 2 + Math.floor(lvl * 0.5) + ((Math.random() * 2) | 0))
  const spawner = createPatternSpawner({
    pattern: 'file', path: route.path, speed, spawnRate: 1 / gap, maxEntities: 12,
  })
  spawner._timeSinceSpawn = 1 / spawner.spawnRate // primeira formiga sai já
  route.busy++
  st.cols.push({ spawner, route, total, spawned: 0, known: new Map() })
}

function spawnIntruderGroup(lvl) {
  const activeCols = st.cols.length
  const dbl = lvl >= 2 && Math.random() < Math.min(0.55, 0.15 * (lvl - 1.2))
  let approach
  if (Math.random() < 0.42 && activeCols < 2) {
    const r = pickRoute()
    spawnAntColumn(r, lvl)
    approach = r.angle
  } else {
    approach = rand(0, TAU)
    spawnFly(approach, lvl)
  }
  if (dbl) {
    const opposite = approach + Math.PI + rand(-0.6, 0.6)
    if (Math.random() < 0.4 && st.cols.length < 2) {
      spawnAntColumn(pickRoute(approach), lvl)
    } else {
      spawnFly(opposite, lvl)
      if (lvl > 5 && Math.random() < 0.35) spawnFly(opposite + rand(-0.5, 0.5), lvl)
    }
  }
  return dbl
}

// ============================================================================
// Estado
// ============================================================================

function resetState(data) {
  st = {
    L: null, bg: null, entrance: null, ticks: null, sprites: new Map(), dpr: 1, marksLayer: null,
    shift: Math.max(0, data?.shiftIndex ?? 0),
    time: 0, clock: 0, hitStop: 0, shake: 0, ended: false, endT: 0, finished: false,
    foragerTimer: 1.0, intruderTimer: WAVE_FIRST + 0.3, lastWave: -1,
    foragers: [], flies: [], cols: [], debris: [], fx: [], marks: [],
    stats: { repelled: 0, breaches: 0, friendly: 0, spawned: 0, entered: 0 },
    entranceShake: 0, breachFlash: 0,
    player: {
      ctrl: null, facing: -Math.PI / 2, phase: 'ready', phaseT: 0, dir: { x: 0, y: -1 },
      from: null, to: null, buffer: null, readyPulse: 0, recoverDur: RECOVER_MISS, moving: 0,
    },
    prevSpace: false, prevPtr: null, ptrActive: 0,
  }
}

function update(context, rawDt) {
  if (!st) return
  const dt = Math.min(rawDt, 0.05)
  ensureLayout(context)
  st.clock += dt

  handleInput(context, dt)
  if (st.hitStop > 0) {
    st.hitStop -= dt
    return
  }
  st.time += dt
  const t = st.time
  const L = st.L

  st.shake = Math.max(0, st.shake - dt * 2.2)
  st.entranceShake = Math.max(0, st.entranceShake - dt)
  st.breachFlash = Math.max(0, st.breachFlash - dt * 1.6)

  if (!st.ended && t >= DURATION) {
    st.ended = true
    st.endT = 0
  }

  // --- diretor de ondas ---
  if (!st.ended && t < DURATION - 2.5) {
    const wv = waveAt(t)
    const lvl = levelAt(t)
    if (wv.inWave && wv.index !== st.lastWave) {
      st.lastWave = wv.index
      st.intruderTimer = Math.min(st.intruderTimer, 0.35)
    }
    st.foragerTimer -= dt
    if (st.foragerTimer <= 0) {
      spawnForager(lvl)
      st.foragerTimer = (wv.inWave ? Math.max(1.5, 3.7 - 0.22 * lvl) : 2.3) * rand(0.7, 1.3)
    }
    if (wv.inWave) {
      st.intruderTimer -= dt
      if (st.intruderTimer <= 0) {
        const dbl = spawnIntruderGroup(lvl)
        st.intruderTimer = Math.max(1.6, 4.1 - 0.3 * lvl) * rand(0.8, 1.2) * (dbl ? 1.5 : 1)
      }
    }
  }

  updatePlayer(context, dt)
  updateAnts(dt)
  updateForagers(dt)
  updateFlies(dt)
  updateDebris(dt)

  for (const f of st.fx) f.t += dt
  st.fx = st.fx.filter((f) => f.t < f.life)

  if (st.ended) {
    st.endT += dt
    if (st.endT >= OUTRO && !st.finished) {
      st.finished = true
      finish(context)
    }
  }
  void L
}

function handleInput(context, dt) {
  const input = context.input
  const pl = st.player
  const L = st.L
  const clicks = input.consumeClicks()
  const space = input.isKeyDown('Space')
  const ptr = input.getPointer()
  if (st.prevPtr && Math.hypot(ptr.x - st.prevPtr.x, ptr.y - st.prevPtr.y) > 0.5) st.ptrActive = 1.5
  st.prevPtr = ptr
  st.ptrActive = Math.max(0, st.ptrActive - dt)

  const kv = keyVector(input)
  if (pl.buffer) {
    pl.buffer.t -= dt
    if (pl.buffer.t <= 0) pl.buffer = null
  }
  if (st.ended) {
    st.prevSpace = space
    return
  }
  if (clicks.length) {
    const c = clicks[clicks.length - 1]
    pl.buffer = { t: BUFFER, x: c.x, y: c.y }
  } else if (space && !st.prevSpace) {
    const pos = pl.ctrl.position
    if (kv.x || kv.y) {
      pl.buffer = { t: BUFFER, x: pos.x + kv.x * 100, y: pos.y + kv.y * 100 }
    } else if (st.ptrActive > 0) {
      pl.buffer = { t: BUFFER, x: ptr.x, y: ptr.y }
    } else {
      pl.buffer = { t: BUFFER, x: pos.x + Math.cos(pl.facing) * 100, y: pos.y + Math.sin(pl.facing) * 100 }
    }
  }
  st.prevSpace = space
  void L
}

function keyVector(input) {
  const k = (c) => (input.isKeyDown(c) ? 1 : 0)
  return {
    x: (k('KeyD') || k('ArrowRight')) - (k('KeyA') || k('ArrowLeft')),
    y: (k('KeyS') || k('ArrowDown')) - (k('KeyW') || k('ArrowUp')),
  }
}

function updatePlayer(context, dt) {
  const pl = st.player
  const { s, cx, cy, R } = st.L
  const input = context.input
  const pos = pl.ctrl.position
  pl.readyPulse = Math.max(0, pl.readyPulse - dt * 3)

  // vetor de movimento
  let mv = keyVector(input)
  if (!mv.x && !mv.y && input.isPointerDown() && !st.ended) {
    const p = input.getPointer()
    const dx = p.x - pos.x
    const dy = p.y - pos.y
    const d = Math.hypot(dx, dy)
    if (d > 5 * s) {
      const k = Math.min(1, d / (40 * s)) / d
      mv = { x: dx * k, y: dy * k }
    }
  }
  if (st.ended) mv = { x: 0, y: 0 }

  if (pl.phase === 'ready' || pl.phase === 'recover') {
    pl.ctrl.setSpeedMultiplier(pl.phase === 'recover' ? 0.5 : 1)
    pl.ctrl.update(dt, mv)
    clampToZone(pl.ctrl, cx, cy, R)
    const mag = Math.hypot(mv.x, mv.y)
    pl.moving = lerp(pl.moving, mag > 0.05 ? 1 : 0, Math.min(1, dt * 8))
    if (mag > 0.05) {
      const target = Math.atan2(mv.y, mv.x)
      pl.facing += angDiff(pl.facing, target) * Math.min(1, dt * 12)
    }
  }

  if (pl.phase === 'recover') {
    pl.phaseT += dt
    if (pl.phaseT >= pl.recoverDur) {
      pl.phase = 'ready'
      pl.phaseT = 0
      pl.readyPulse = 1
    }
  }

  if (pl.phase === 'ready' && pl.buffer && !st.ended) {
    const b = pl.buffer
    pl.buffer = null
    let dx = b.x - pos.x
    let dy = b.y - pos.y
    let d = Math.hypot(dx, dy)
    if (d < 4 * s) {
      dx = Math.cos(pl.facing)
      dy = Math.sin(pl.facing)
      d = 1
    }
    pl.dir = { x: dx / d, y: dy / d }
    pl.facing = Math.atan2(pl.dir.y, pl.dir.x)
    pl.phase = 'windup'
    pl.phaseT = 0
    provokeDodges(pos, pl.dir)
  } else if (pl.phase === 'windup') {
    pl.phaseT += dt
    if (pl.phaseT >= WINDUP) {
      const Ls = 92 * s
      const p = pl.ctrl.position
      let tx = p.x + pl.dir.x * Ls
      let ty = p.y + pl.dir.y * Ls
      const d = Math.hypot(tx - cx, ty - cy)
      const lim = R + 18 * s
      if (d > lim) {
        tx = cx + ((tx - cx) / d) * lim
        ty = cy + ((ty - cy) / d) * lim
      }
      pl.from = { x: p.x, y: p.y }
      pl.to = { x: tx, y: ty }
      pl.phase = 'lunge'
      pl.phaseT = 0
    }
  } else if (pl.phase === 'lunge') {
    const prevU = ease(pl.phaseT / LUNGE, 'easeOutCubic')
    pl.phaseT += dt
    const u = ease(pl.phaseT / LUNGE, 'easeOutCubic')
    let hit = false
    for (let k = 1; k <= 3 && !hit; k++) {
      const uu = lerp(prevU, u, k / 3)
      const x = lerp(pl.from.x, pl.to.x, uu)
      const y = lerp(pl.from.y, pl.to.y, uu)
      pl.ctrl.setPosition(x, y)
      hit = strike(x + pl.dir.x * 18 * s, y + pl.dir.y * 18 * s)
    }
    if (hit) {
      const p = pl.ctrl.position
      pl.ctrl.setPosition(p.x - pl.dir.x * 9 * s, p.y - pl.dir.y * 9 * s)
      pl.phase = 'recover'
      pl.phaseT = 0
      pl.recoverDur = RECOVER_HIT
    } else if (pl.phaseT >= LUNGE) {
      pl.phase = 'recover'
      pl.phaseT = 0
      pl.recoverDur = RECOVER_MISS
      const p = pl.ctrl.position
      st.fx.push({ kind: 'whiff', x: p.x + pl.dir.x * 16 * s, y: p.y + pl.dir.y * 16 * s, a: Math.atan2(pl.dir.y, pl.dir.x), t: 0, life: 0.35 })
    }
  }
}

function clampToZone(ctrl, cx, cy, R) {
  const p = ctrl.position
  const d = Math.hypot(p.x - cx, p.y - cy)
  if (d > R) ctrl.setPosition(cx + ((p.x - cx) / d) * R, cy + ((p.y - cy) / d) * R)
}

// Moscas percebem o preparo: quem está no corredor da investida pode esquivar.
function provokeDodges(pos, dir) {
  const { s } = st.L
  const Ls = 90 * s
  for (const f of st.flies) {
    if (f.mode === 'tail') continue
    const rx = f.x - pos.x
    const ry = f.y - pos.y
    const along = rx * dir.x + ry * dir.y
    if (along < 0 || along > Ls) continue
    const perp = Math.abs(rx * -dir.y + ry * dir.x)
    if (perp > 34 * s) continue
    const chance = f.mode === 'hover' ? f.dodgeChance * 0.5 : f.dodgeChance
    if (Math.random() < chance) {
      f.dodgeDelay = rand(0.09, 0.17)
      const side = rx * -dir.y + ry * dir.x >= 0 ? 1 : -1
      f.dodgeTo = { x: f.x + -dir.y * side * 46 * s, y: f.y + dir.x * side * 46 * s }
    }
  }
}

const ANT_R = 14
const FLY_R = 11
const FORAGER_R = 19
const HEAD_R = 13

// Resolve o primeiro contato da investida. Retorna true se acertou algo.
function strike(hx, hy) {
  const { s } = st.L
  let any = false
  const hits = { foragers: [], flies: [], ants: false }
  for (const f of st.foragers) {
    if (f.state === 'enter') continue
    if (Math.hypot(f.x - hx, f.y - hy) < (HEAD_R + FORAGER_R) * s) hits.foragers.push(f)
  }
  for (const f of st.flies) {
    if (Math.hypot(f.x - hx, f.y - hy) < (HEAD_R + FLY_R) * s) hits.flies.push(f)
  }
  for (const c of st.cols) {
    for (const e of c.spawner.entities) {
      if (Math.hypot(e.x - hx, e.y - hy) < (HEAD_R + ANT_R) * s) hits.ants = true
    }
  }
  if (!hits.foragers.length && !hits.flies.length && !hits.ants) return false

  const pl = st.player
  const ax = pl.dir.x
  const ay = pl.dir.y
  const kick = 260 * s

  for (const f of hits.flies) {
    any = true
    st.flies.splice(st.flies.indexOf(f), 1)
    st.stats.repelled++
    st.debris.push({ kind: 'fly', x: f.x, y: f.y, vx: ax * kick * 1.2 + rand(-40, 40) * s, vy: ay * kick * 1.2 - 80 * s, rot: f.angle, spin: rand(-18, 18), t: 0, life: 0.9, seed: f.seed })
    burst(f.x, f.y, false)
  }
  if (hits.ants) {
    for (const c of st.cols) {
      const caught = c.spawner.checkCapture({ x: hx, y: hy }, (HEAD_R + ANT_R) * s)
      for (const e of caught) {
        const k = c.known.get(e.id)
        c.known.delete(e.id)
        any = true
        st.stats.repelled++
        st.debris.push({ kind: 'ant', x: e.x, y: e.y, vx: ax * kick + rand(-30, 30) * s, vy: ay * kick - 120 * s, rot: k ? k.rot : 0, spin: rand(-14, 14), t: 0, life: 1.1, seed: k ? k.seed : 1 })
        burst(e.x, e.y, false)
      }
    }
  }
  for (const f of hits.foragers) {
    any = true
    st.stats.friendly++
    f.state = 'dazed'
    f.dazeT = 1.7
    f.vx = ax * kick * 0.8
    f.vy = ay * kick * 0.8
    f.spin = rand(-9, 9)
    burst(f.x, f.y, true)
  }
  if (any) {
    const friendly = hits.foragers.length > 0
    st.hitStop = friendly ? 0.13 : 0.07
    st.shake = Math.max(st.shake, friendly ? 0.35 : 0.18)
  }
  return any
}

function burst(x, y, friendly) {
  st.fx.push({ kind: friendly ? 'friendly' : 'hit', x, y, t: 0, life: friendly ? 0.7 : 0.35, a: rand(0, TAU) })
}

function breach(x, y, kind) {
  const { cx, cy } = st.L
  st.stats.breaches++
  st.stats['breach_' + kind] = (st.stats['breach_' + kind] || 0) + 1
  st.marks.push({ a: Math.atan2(y - cy, x - cx), seed: (Math.random() * 1e6) | 0 })
  rebuildMarksLayer()
  st.entranceShake = 0.5
  st.breachFlash = 1
  st.shake = Math.max(st.shake, 0.55)
  st.fx.push({ kind: 'breach', x: cx, y: cy, t: 0, life: 0.6 })
}

function updateAnts(dt) {
  const { cx, cy } = st.L
  for (const c of st.cols) {
    c.spawner.update(dt)
    const alive = new Set()
    for (const e of c.spawner.entities) {
      alive.add(e.id)
      let k = c.known.get(e.id)
      if (!k) {
        k = { x: e.x, y: e.y, rot: Math.atan2(c.route.path[1].y - e.y, c.route.path[1].x - e.x), seed: (Math.random() * 1e6) | 0, t: rand(0, 2) }
        c.known.set(e.id, k)
        c.spawned++
        st.stats.spawned++
        if (c.spawned >= c.total) c.spawner.spawnRate = 0
      }
      const dx = e.x - k.x
      const dy = e.y - k.y
      if (dx * dx + dy * dy > 0.01) {
        k.rot += angDiff(k.rot, Math.atan2(dy, dx)) * Math.min(1, dt * 14)
      }
      k.x = e.x
      k.y = e.y
      k.t += dt
    }
    for (const [id, k] of c.known) {
      if (!alive.has(id)) {
        c.known.delete(id)
        if (Math.hypot(k.x - cx, k.y - cy) < 40 * st.L.s) breach(k.x, k.y, 'ant')
      }
    }
  }
  st.cols = st.cols.filter((c) => {
    const done = c.spawned >= c.total && c.spawner.entities.length === 0
    if (done) c.route.busy = Math.max(0, c.route.busy - 1)
    return !done
  })
}

function updateForagers(dt) {
  const { s, cx, cy } = st.L
  for (const f of st.foragers) {
    f.t += dt
    if (f.state === 'fly') {
      const target = Math.atan2(cy - f.y, cx - f.x)
      f.dir += angDiff(f.dir, target) * Math.min(1, dt * 0.9)
      const d = Math.hypot(cx - f.x, cy - f.y)
      const sp = f.speed * (d < 60 * s ? lerp(0.45, 1, d / (60 * s)) : 1)
      f.x += Math.cos(f.dir) * sp * dt
      f.y += Math.sin(f.dir) * sp * dt
      if (d < 70 * s) f.dir += angDiff(f.dir, target) * Math.min(1, dt * 6)
      if (d < 16 * s) {
        f.state = 'enter'
        f.enterT = 0
      }
      f.trailT -= dt
      if (f.trailT <= 0) {
        f.trailT = 0.09
        f.trail.push({ x: f.x - Math.cos(f.dir) * 14 * s, y: f.y - Math.sin(f.dir) * 14 * s, age: 0 })
      }
    } else if (f.state === 'dazed') {
      f.x += f.vx * dt
      f.y += f.vy * dt
      const damp = Math.exp(-dt * 5)
      f.vx *= damp
      f.vy *= damp
      f.spin *= Math.exp(-dt * 2)
      f.dir += f.spin * dt
      f.dazeT -= dt
      if (f.dazeT <= 0) f.state = 'fly'
    } else if (f.state === 'enter') {
      f.enterT += dt
      f.x = lerp(f.x, cx, Math.min(1, dt * 10))
      f.y = lerp(f.y, cy, Math.min(1, dt * 10))
    }
    for (const p of f.trail) p.age += dt
    f.trail = f.trail.filter((p) => p.age < 0.8)
  }
  st.foragers = st.foragers.filter((f) => {
    if (f.state === 'enter' && f.enterT > 0.45) {
      st.stats.entered++
      return false
    }
    return true
  })
}

function updateFlies(dt) {
  const { s, cx, cy, R, w, h } = st.L
  const removed = []
  for (const f of st.flies) {
    f.t += dt
    if (st.ended) {
      const a = Math.atan2(f.y - cy, f.x - cx)
      f.x += Math.cos(a) * f.speed * dt
      f.y += Math.sin(a) * f.speed * dt
      f.angle = a
      continue
    }
    if (f.dodgeDelay > 0) {
      f.dodgeDelay -= dt
      if (f.dodgeDelay <= 0) {
        f.mode = 'dart'
        f.wx = f.dodgeTo.x
        f.wy = f.dodgeTo.y
        f.dodgeBoost = 1.35
      }
    }
    if (f.mode === 'tail') {
      const hst = f.host
      if (!hst || hst.state === 'dazed' || !st.foragers.includes(hst)) {
        if (hst && hst.state === 'enter') {
          f.mode = 'dart'
          f.wx = cx
          f.wy = cy
        } else {
          f.mode = 'hover'
          f.hoverT = 0.2
        }
      } else if (hst.state === 'enter') {
        f.mode = 'dart'
        f.wx = cx
        f.wy = cy
      } else {
        const back = 25 * s
        const wob = Math.sin(f.t * 8) * 7 * s
        const tx = hst.x - Math.cos(hst.dir) * back - Math.sin(hst.dir) * wob
        const ty = hst.y - Math.sin(hst.dir) * back + Math.cos(hst.dir) * wob
        const k = Math.min(1, dt * 7)
        const nx = lerp(f.x, tx, k)
        const ny = lerp(f.y, ty, k)
        if (Math.hypot(nx - f.x, ny - f.y) > 0.2) f.angle = Math.atan2(ny - f.y, nx - f.x)
        f.x = nx
        f.y = ny
        continue
      }
    }
    if (f.mode === 'hover') {
      f.hoverT -= dt
      f.x += Math.cos(f.t * 23) * 12 * s * dt
      f.y += Math.sin(f.t * 17) * 12 * s * dt
      if (f.hoverT <= 0) pickFlyWaypoint(f)
    } else if (f.mode === 'dart') {
      const dx = f.wx - f.x
      const dy = f.wy - f.y
      const d = Math.hypot(dx, dy)
      const step = f.speed * (f.dodgeBoost || 1) * dt
      f.angle += angDiff(f.angle, Math.atan2(dy, dx)) * Math.min(1, dt * 25)
      if (d <= step) {
        f.x = f.wx
        f.y = f.wy
        f.dodgeBoost = 1
        if (Math.hypot(f.x - cx, f.y - cy) < 8 * s) {
          removed.push(f)
          breach(f.x, f.y, f.host ? 'tail' : 'fly')
          continue
        }
        const inside = Math.hypot(f.x - cx, f.y - cy) < R * 1.15
        f.mode = 'hover'
        f.hoverT = (inside ? rand(0.2, 0.48) : rand(0.03, 0.13)) * f.hoverMul
      } else {
        f.x += (dx / d) * step
        f.y += (dy / d) * step
      }
    }
    f.x = clamp(f.x, -60, w + 60)
    f.y = clamp(f.y, -60, h + 60)
  }
  if (removed.length) st.flies = st.flies.filter((f) => !removed.includes(f))
  if (st.ended) st.flies = st.flies.filter((f) => f.x > -50 && f.x < w + 50 && f.y > -50 && f.y < h + 50)
}

function pickFlyWaypoint(f) {
  const { s, cx, cy, R } = st.L
  const dx = cx - f.x
  const dy = cy - f.y
  const D = Math.hypot(dx, dy) || 1
  f.mode = 'dart'
  if (D < 36 * s) {
    f.wx = cx
    f.wy = cy
    return
  }
  const inside = D < R * 1.15
  const step = Math.min(D - 4 * s, (inside ? rand(38, 78) : rand(110, 190)) * s)
  const lat = (Math.random() * 2 - 1) * (inside ? 58 : 85) * s * Math.min(1, D / R)
  const ux = dx / D
  const uy = dy / D
  f.wx = f.x + ux * step - uy * lat
  f.wy = f.y + uy * step + ux * lat
}

function updateDebris(dt) {
  const { s } = st.L
  for (const d of st.debris) {
    d.t += dt
    d.x += d.vx * dt
    d.y += d.vy * dt
    d.vx *= Math.exp(-dt * 2.5)
    d.vy += 520 * s * dt
    d.rot += d.spin * dt
  }
  st.debris = st.debris.filter((d) => d.t < d.life)
  if (st.ended) {
    for (const c of st.cols) c.spawner.spawnRate = 0
  }
}

function finish(context) {
  const { repelled, breaches, friendly } = st.stats
  const denom = repelled + 2 * breaches
  const base = denom > 0 ? (100 * repelled) / denom : 50
  const score = Math.round(clamp(base - 4 * friendly, 0, 100))
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`
  let summary = `${pl(repelled, 'intruso repelido', 'intrusos repelidos')}, ${pl(breaches, 'brecha', 'brechas')}, ${pl(friendly, 'companheira atingida', 'companheiras atingidas')}`
  if (breaches === 0 && friendly === 0 && repelled > 0) summary += ' — entrada intacta'
  context.finishShift({ score, summary })
}

// ============================================================================
// Render
// ============================================================================

function render(context, ctx) {
  if (!st) return
  ensureLayout(context)
  const L = st.L
  const { w, h, s, cx, cy, R } = L
  const clock = st.clock

  ctx.save()
  if (st.shake > 0) {
    const a = st.shake * st.shake * 7 * s
    ctx.translate(Math.sin(clock * 91) * a, Math.cos(clock * 77) * a)
  }
  ctx.drawImage(st.bg, 0, 0, w, h)

  // entrada (estremece na brecha)
  const E = st.entrance
  let ex = 0
  let ey = 0
  if (st.entranceShake > 0) {
    const a = st.entranceShake * 5 * s
    ex = Math.sin(clock * 120) * a
    ey = Math.cos(clock * 97) * a * 0.6
  }
  ctx.drawImage(E.canvas, cx - E.pad + ex, cy - E.pad + ey, E.pad * 2, E.pad * 2)
  if (st.marksLayer) ctx.drawImage(st.marksLayer, cx - E.pad + ex, cy - E.pad + ey, E.pad * 2, E.pad * 2)

  // escurecimento: residual por brecha + flash
  const dark = Math.min(0.38, st.stats.breaches * 0.05) + st.breachFlash * 0.5
  if (dark > 0.01) {
    const g = ctx.createRadialGradient(cx, cy, E.rHole * 0.5, cx, cy, E.rOut * (1.05 + st.breachFlash * 0.4))
    g.addColorStop(0, `rgba(20,13,7,${dark})`)
    g.addColorStop(1, 'rgba(20,13,7,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, E.rOut * 1.5, 0, TAU)
    ctx.fill()
  }

  drawInstrument(ctx)

  const endFade = st.ended ? clamp(1 - st.endT / 0.9, 0, 1) : 1

  // formigas (rente à casca)
  const antFrames = antSprites()
  for (const c of st.cols) {
    for (const k of c.known.values()) {
      blit(ctx, antFrames, k.t / ANT_PERIOD, k.x, k.y, k.rot, 1, endFade, 1)
    }
  }

  // forrageiras
  for (const f of st.foragers) drawForager(ctx, f)

  // moscas
  const flyFrames = flySprites()
  for (const f of st.flies) {
    const hover = Math.sin(f.t * 9) * 1.2 * 2.2 * s
    blit(ctx, flyFrames, f.t / FLY_PERIOD, f.x, f.y + hover, f.angle, 1, 1, 1)
  }

  // restos arremessados
  for (const d of st.debris) {
    const u = d.t / d.life
    const frames = d.kind === 'ant' ? antFrames : flyFrames
    blit(ctx, frames, d.t * 3, d.x, d.y, d.rot, 1, 1 - ease(u, 'easeInQuad'), 1 + u * 0.25)
  }

  drawPlayer(ctx)
  drawFx(ctx)

  ctx.restore()

  if (st.ended) {
    const u = clamp((st.endT - 0.6) / (OUTRO - 0.6), 0, 1)
    if (u > 0) {
      ctx.fillStyle = withAlpha(P.paperCreamLight, ease(u, 'easeInOutQuad') * 0.85)
      ctx.fillRect(0, 0, w, h)
    }
  }
  void R
}

// Camada de marcas de brecha: refeita só quando há brecha nova (ou resize).
function rebuildMarksLayer() {
  const E = st.entrance
  if (!st.marks.length) {
    st.marksLayer = null
    return
  }
  const { c, g } = makeCanvas(E.pad * 2, E.pad * 2, st.dpr)
  drawBreachMarks(g, E, E.pad, E.pad)
  st.marksLayer = c
}

// --- Sprites animados (poses pré-renderizadas em quadros) ---------------------
const ANT_PERIOD = TAU / 14
const FLY_PERIOD = TAU / 20
const BEE_FLAP = 30
const FORAGER_FLAP = 18

function frames(key, n, box, drawFrame) {
  let f = st.sprites.get(key)
  if (f) return f
  f = []
  for (let i = 0; i < n; i++) {
    const { c, g } = makeCanvas(box, box, st.dpr)
    g.translate(box / 2, box / 2)
    drawFrame(g, i / n)
    f.push(c)
  }
  f.box = box
  st.sprites.set(key, f)
  return f
}

function antSprites() {
  const sc = 1.6 * st.L.s
  return frames('ant', 8, 40 * sc, (g, u) => drawAnt(g, createAntPose(0, 0, u * ANT_PERIOD, { scale: sc, seed: 5 })))
}

function flySprites() {
  const sc = 2.2 * st.L.s
  return frames('fly', 12, 30 * sc, (g, u) => {
    const pose = createPhoridFlyPose(0, 0, u * FLY_PERIOD, { scale: sc, seed: 9 })
    pose.hover = 0
    drawPhoridFly(g, pose)
  })
}

function beeSprites(kind) {
  const s = st.L.s
  if (kind === 'forager') {
    const sc = 1.55 * s
    return frames('forager', 8, 64 * sc, (g, u) =>
      drawBeeBody(g, createCarryingPose(0, 0, (u * TAU) / FORAGER_FLAP, { colorVariant: 'old', scale: sc, seed: 31, amount: 1.5 })))
  }
  const sc = 1.95 * s
  const flapAmount = kind === 'tuck' ? 0.3 : 0.85
  return frames(kind, 8, 64 * sc, (g, u) =>
    drawBeeBody(g, createFlightPose(0, 0, (u * TAU) / BEE_FLAP, { colorVariant: 'adult', scale: sc, seed: 7, flapAmount, flapSpeed: BEE_FLAP })))
}

function blit(ctx, fr, phase, x, y, rot, flip, alpha, scale) {
  if (alpha <= 0.01) return
  const i = ((Math.floor(phase * fr.length) % fr.length) + fr.length) % fr.length
  const b = fr.box * scale
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(x, y)
  if (flip < 0) ctx.scale(-1, 1)
  ctx.rotate(rot)
  ctx.drawImage(fr[i], -b / 2, -b / 2, b, b)
  ctx.restore()
}

function drawBreachMarks(ctx, E, cx, cy) {
  const { s } = st.L
  for (const m of st.marks) {
    const rng = seededRandom(m.seed)
    const pts = []
    let r = E.rHole * 1.2
    let a = m.a
    while (r < E.rOut * 0.95) {
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
      r += (5 + rng() * 6) * s
      a += (rng() - 0.5) * 0.35
    }
    strokeHandDrawn(ctx, pts, { color: '#1A1108', baseWidth: 1.6, widthJitter: 0.6, seed: m.seed, opacity: 0.75 })
    if (pts.length > 3) {
      const b = pts[2]
      strokeHandDrawn(ctx, [b, { x: b.x + Math.cos(m.a + 1.2) * 9 * s, y: b.y + Math.sin(m.a + 1.2) * 9 * s }], { color: '#1A1108', baseWidth: 1, seed: m.seed + 1, opacity: 0.6 })
    }
  }
}

function drawInstrument(ctx) {
  const { s, cx, cy, R } = st.L
  const t = st.time
  const reveal = ease(clamp(st.clock / 1.1, 0, 1), 'easeInOutCubic')
  ctx.save()
  ctx.translate(cx, cy)
  ctx.lineCap = 'round'

  // limite da zona de guarda: arco pontilhado + marcas de escala
  ctx.strokeStyle = withAlpha(P.inkLine, 0.3)
  ctx.lineWidth = 1
  ctx.setLineDash([2 * s, 5 * s])
  ctx.beginPath()
  ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + TAU * reveal)
  ctx.stroke()
  ctx.setLineDash([])
  if (reveal >= 1) {
    ctx.strokeStyle = withAlpha(P.inkLine, 0.32)
    ctx.lineWidth = 0.9
    ctx.stroke(st.ticks)
  }

  // mostrador do turno
  const tr = R + 16 * s
  ctx.strokeStyle = withAlpha(P.inkLine, 0.12)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(0, 0, tr, -Math.PI / 2, -Math.PI / 2 + TAU * reveal)
  ctx.stroke()
  // faixas das ondas (intensidade crescente = traço mais grosso)
  for (let i = 0; i < WAVES; i++) {
    const a0 = -Math.PI / 2 + ((WAVE_FIRST + i * WAVE_STEP) / DURATION) * TAU
    const a1 = -Math.PI / 2 + ((WAVE_FIRST + i * WAVE_STEP + WAVE_LEN) / DURATION) * TAU
    ctx.strokeStyle = withAlpha(P.inkLine, 0.09 + i * 0.02)
    ctx.lineWidth = (2 + i * 0.9) * s
    ctx.beginPath()
    ctx.arc(0, 0, tr, a0, Math.min(a1, -Math.PI / 2 + TAU * reveal))
    ctx.stroke()
    ctx.strokeStyle = withAlpha(P.inkLine, 0.45)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.cos(a0) * (tr - 5 * s), Math.sin(a0) * (tr - 5 * s))
    ctx.lineTo(Math.cos(a0) * (tr + 5 * s), Math.sin(a0) * (tr + 5 * s))
    ctx.stroke()
  }
  const prog = clamp(t / DURATION, 0, 1)
  const aEnd = -Math.PI / 2 + TAU * prog
  ctx.strokeStyle = withAlpha(P.inkLine, 0.62)
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(0, 0, tr, -Math.PI / 2, aEnd)
  ctx.stroke()
  ctx.fillStyle = P.inkLine
  ctx.beginPath()
  ctx.arc(Math.cos(aEnd) * tr, Math.sin(aEnd) * tr, 2.6 * s, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = withAlpha(P.inkLine, 0.5)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.arc(Math.cos(aEnd) * tr, Math.sin(aEnd) * tr, 5.5 * s, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function drawForager(ctx, f) {
  const { s } = st.L
  const t = f.t
  let alpha = 1
  let scale = 1
  if (f.state === 'enter') {
    const u = clamp(f.enterT / 0.45, 0, 1)
    alpha = 1 - ease(u, 'easeInQuad')
    scale *= 1 - u * 0.55
  }
  // rastro de cheiro da colônia: pontinhos dourados que somem
  for (const p of f.trail) {
    const a = (1 - p.age / 0.8) * 0.38 * alpha
    ctx.fillStyle = withAlpha(P.caterpillarGold, a)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.1 * s, 0, TAU)
    ctx.fill()
  }
  // halo suave
  const pulse = 0.8 + 0.2 * Math.sin(t * 2.2)
  const hr = 30 * s
  ctx.save()
  ctx.globalAlpha = pulse * alpha
  ctx.drawImage(haloSprite(), f.x - hr, f.y - hr, hr * 2, hr * 2)
  ctx.restore()

  const bob = f.state === 'fly' ? Math.sin(t * 3.1) * 1.6 * s : 0
  drawOrientedBee(ctx, beeSprites('forager'), (t * FORAGER_FLAP) / TAU + (f.seed % 8) / 8, f.x, f.y + bob, f.dir,
    f.state === 'dazed' ? 3 : 0.55, alpha, scale)
  if (f.state === 'dazed') {
    // estrelinhas de atordoamento em órbita técnica
    ctx.save()
    ctx.strokeStyle = withAlpha(P.inkLine, 0.45)
    ctx.lineWidth = 0.8
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.ellipse(f.x, f.y - 20 * s, 12 * s, 4 * s, 0, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = P.caterpillarGold
    for (let i = 0; i < 3; i++) {
      const a = t * 6 + (i * TAU) / 3
      ctx.beginPath()
      ctx.arc(f.x + Math.cos(a) * 12 * s, f.y - 20 * s + Math.sin(a) * 4 * s, 1.6 * s, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }
}

// A abelha é desenhada em vista lateral: espelha quando voa para a esquerda
// e limita a inclinação para não voar "de cabeça para baixo".
function drawOrientedBee(ctx, fr, phase, x, y, angle, maxTilt, alpha, scale) {
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const flip = c < 0 ? -1 : 1
  const rot = clamp(Math.atan2(sn, c * flip), -maxTilt, maxTilt)
  blit(ctx, fr, phase, x, y, rot, flip, alpha, scale)
}

function haloSprite() {
  let hs = st.sprites.get('halo')
  if (hs) return hs
  const hr = 30 * st.L.s
  const { c, g } = makeCanvas(hr * 2, hr * 2, st.dpr)
  const gr = g.createRadialGradient(hr, hr, 2, hr, hr, hr)
  gr.addColorStop(0, withAlpha(P.sunHalo, 0.42))
  gr.addColorStop(1, withAlpha(P.sunHalo, 0))
  g.fillStyle = gr
  g.fillRect(0, 0, hr * 2, hr * 2)
  st.sprites.set('halo', c)
  return c
}

function drawPlayer(ctx) {
  const pl = st.player
  const { s } = st.L
  const pos = pl.ctrl.position
  let x = pos.x
  let y = pos.y
  let scale = 1
  let kind = 'bee'
  const angle = pl.facing
  let tilt = 0.7

  if (pl.phase === 'windup') {
    const u = ease(pl.phaseT / WINDUP, 'easeOutQuad')
    x -= pl.dir.x * 7 * s * u
    y -= pl.dir.y * 7 * s * u
    scale *= 1 - 0.06 * u
    kind = 'tuck'
    tilt = 1.2
    drawAim(ctx, pos, pl.dir, pl.phaseT / WINDUP)
  } else if (pl.phase === 'lunge') {
    scale *= 1.06
    kind = 'tuck'
    tilt = 1.3
  } else if (pl.phase === 'recover') {
    tilt = 1.0
  }

  // sombra de pouso (leve) para ancorar na casca
  ctx.fillStyle = 'rgba(43,36,24,0.12)'
  ctx.beginPath()
  ctx.ellipse(pos.x + 4 * s, pos.y + 16 * s, 16 * s, 5 * s, 0, 0, TAU)
  ctx.fill()

  const hover = pl.phase === 'ready' ? Math.sin(st.clock * 2.4) * 1.5 * s : 0
  drawOrientedBee(ctx, beeSprites(kind), (st.clock * BEE_FLAP) / TAU, x, y + hover, angle, tilt, 1, scale)

  // recarga: arco fino com marcas de escala em volta da guardiã
  if (pl.phase === 'recover') {
    const u = clamp(pl.phaseT / pl.recoverDur, 0, 1)
    const r = 34 * s
    ctx.save()
    ctx.strokeStyle = withAlpha(P.inkLine, 0.18)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, r, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = withAlpha(P.inkLine, 0.6)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * u)
    ctx.stroke()
    ctx.lineWidth = 0.8
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * TAU
      ctx.strokeStyle = withAlpha(P.inkLine, i / 8 <= u ? 0.55 : 0.2)
      ctx.beginPath()
      ctx.moveTo(pos.x + Math.cos(a) * (r - 3 * s), pos.y + Math.sin(a) * (r - 3 * s))
      ctx.lineTo(pos.x + Math.cos(a) * (r + 3 * s), pos.y + Math.sin(a) * (r + 3 * s))
      ctx.stroke()
    }
    ctx.restore()
  } else if (pl.readyPulse > 0) {
    const u = 1 - pl.readyPulse
    ctx.strokeStyle = withAlpha(P.inkLine, pl.readyPulse * 0.5)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, (34 + u * 8) * s, 0, TAU)
    ctx.stroke()
  }
}

// Único acento accentPink da cena: o vetor da investida durante o preparo.
function drawAim(ctx, pos, dir, u) {
  const { s } = st.L
  const k = ease(clamp(u, 0, 1), 'easeInOutQuad')
  const len = 92 * s
  const x0 = pos.x + dir.x * 18 * s
  const y0 = pos.y + dir.y * 18 * s
  const x1 = pos.x + dir.x * (18 * s + (len - 18 * s) * k)
  const y1 = pos.y + dir.y * (18 * s + (len - 18 * s) * k)
  ctx.save()
  ctx.strokeStyle = withAlpha(P.accentPink, 0.85)
  ctx.lineWidth = 1.3
  ctx.setLineDash([5 * s, 3 * s])
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.setLineDash([])
  const a = Math.atan2(dir.y, dir.x)
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, len, a - 0.14 * k, a + 0.14 * k)
  ctx.stroke()
  ctx.restore()
}

function drawFx(ctx) {
  const { s, cx, cy } = st.L
  const E = st.entrance
  for (const f of st.fx) {
    const u = f.t / f.life
    if (f.kind === 'hit' || f.kind === 'friendly') {
      const n = f.kind === 'hit' ? 8 : 6
      const r0 = (6 + u * 16) * s
      const r1 = r0 + (8 - u * 6) * s
      ctx.save()
      ctx.strokeStyle = withAlpha(P.inkLine, (1 - u) * 0.85)
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      for (let i = 0; i < n; i++) {
        const a = f.a + (i / n) * TAU
        ctx.beginPath()
        ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0)
        ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1)
        ctx.stroke()
      }
      if (f.kind === 'friendly') {
        // grãos de pólen derramados
        ctx.fillStyle = withAlpha(P.caterpillarGold, 1 - u)
        for (let i = 0; i < 7; i++) {
          const a = f.a * 3 + i * 0.9
          const d = (4 + u * 26 * (0.5 + (i % 3) * 0.25)) * s
          ctx.beginPath()
          ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d + u * u * 22 * s, 1.8 * s, 0, TAU)
          ctx.fill()
        }
      }
      ctx.restore()
    } else if (f.kind === 'whiff') {
      ctx.save()
      ctx.strokeStyle = withAlpha(P.inkLine, (1 - u) * 0.4)
      ctx.lineWidth = 1
      for (let i = -1; i <= 1; i++) {
        const a = f.a + i * 0.5
        const d = (8 + u * 12) * s
        ctx.beginPath()
        ctx.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d)
        ctx.lineTo(f.x + Math.cos(a) * (d + 5 * s), f.y + Math.sin(a) * (d + 5 * s))
        ctx.stroke()
      }
      ctx.restore()
    } else if (f.kind === 'breach') {
      const r = lerp(E.rOut * 1.5, E.rHole, ease(u, 'easeInCubic'))
      ctx.save()
      ctx.strokeStyle = `rgba(26,17,8,${(1 - u) * 0.8})`
      ctx.lineWidth = (3 - u * 2) * s
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
  }
}

export default {
  id: 'guard',
  enter(context, data) {
    resetState(data)
    ensureLayout(context)
    context.input?.consumeClicks?.()
  },
  update,
  render,
  exit() {
    st = null
  },
}
