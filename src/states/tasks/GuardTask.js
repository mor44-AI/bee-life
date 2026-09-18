// Tarefa: Defesa da entrada - a operária como guardiã.
//
// Gênero: reconhecimento visual + reflexo de ataque.
// A guardiã fica presa à zona da entrada (anel técnico em volta do gargalo de
// barro/geoprópolis). Chegam, misturados: formigas em fila pelo tronco/galho
// (PatternSpawner 'file'), moscas-forídeas nervosas (voo em arrancadas e
// pausas, às vezes "pegando carona" atrás de uma forrageira - comportamento
// real dos forídeos) e forrageiras legítimas voltando com bolotas de pólen,
// voo reto/calmo e um leve halo dourado de cheiro da colônia.
//
// Controles (context.controls - o mesmo código serve celular e PC):
//   Celular (retrato é o design principal): arrastar o dedo move a guardiã dentro
//   do anel; TOCAR num intruso investe na direção dele (a mira gruda no intruso
//   mais próximo do toque e acompanha-o durante o preparo); botão Ação investe no
//   intruso mais próximo à frente (assistência de mira) ou na direção do movimento.
//   PC: WASD/setas ou segurar o mouse movem; clique investe rumo ao ponto;
//   Espaço investe na direção das teclas/do olhar. Especial: botão, E ou Shift.
//   Sem texto de tutorial.
//
// Dificuldade: data.difficulty (0-1) é a fonte da verdade (tuningFor); dentro do
// turno as ondas apertam com inShiftRamp. ~0.1 = treino (poucos intrusos lentos,
// sem ameaças duplas, moscas sem esquiva, recarga curta).
//
// Especial "Alarme de feromônio": abelhas sem ferrão liberam feromônio de alarme
// (voláteis das glândulas mandibulares) que recruta outras defensoras para a
// entrada. O medidor carrega com cada intruso repelido + carga passiva lenta.
// Ao ativar: pulso de anéis técnicos sai da entrada e guardiãs recrutadas saem
// por ~4s repelindo todo intruso na tela (NUNCA forrageiras); intrusos ficam
// lentos e brechas não contam durante o efeito.

import createMovement from '../../engine/MovementController.js'
import createPatternSpawner from '../../engine/PatternSpawner.js'
import { create as createMeter } from '../../engine/SpecialMeter.js'
import { config, difficultyFor, inShiftRamp } from '../../data/config.js'
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
import { t } from '../../i18n/index.js'

const P = styleGuide.palettes.naturalist
const TAU = Math.PI * 2

// --- Ritmo do turno ---------------------------------------------------------
const DURATION = config.shiftDuration
const WAVES = 4
const WAVE_FIRST = 1.5 * config.durationScale
const WAVE_STEP = 14.5 * config.durationScale
const WAVE_LEN = 11 * config.durationScale
const OUTRO = 1.8

// --- Investida --------------------------------------------------------------
const LUNGE = 0.12
const BUFFER = 0.18

// --- Alarme de feromônio ------------------------------------------------------
const ALARM_TIME = 4
const ALARM_HELPERS = 5
const ALARM_SLOW = 0.3 // intrusos desorientados pelo feromônio
const CHARGE_PER_REPEL = 0.05

// --- Pontuação arcade (context.score - ScoreSystem) ---------------------------
// Formiga = normal, mosca forídea = great; repelir de novo em até CHAIN_WINDOW s
// (ou vários de uma investida) = cadeia (+bônus). Alarme = base menor ('special').
// Um turno médio tem só ~15-25 intrusos (ondas curtas), então as bases ficam
// ~1,8× o sugerido em config.scoring.base para render ~targetShiftActionPoints
// (calibrado por bot: dificuldade 0,57 ágil ≈ 1.800 / mediano ≈ 1.050-1.350; 0,7 ≈ 2.400).
const SB = config.scoring.base
const SCORE = {
  ant: Math.round(SB.normal * 1.8),
  fly: Math.round(SB.great * 1.8),
  chainBonus: SB.small * 2,
  alarm: Math.round(SB.small * 2.5),
}
const CHAIN_WINDOW = 1.1

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
// Dificuldade: tudo sai de difficulty (0-1) + rampa dentro do turno
// ============================================================================

export function tuningFor(difficulty, ramp) {
  const d = clamp(difficulty, 0, 1)
  const k = clamp(d * (0.68 + 0.2 * ramp) + 0.1 * ramp, 0, 1)
  const over = (a) => clamp((k - a) / (1 - a), 0, 1)
  return {
    k,
    antSpeed: lerp(28, 56, k),
    antGap: lerp(1.8, 0.95, k),
    antsPerCol: Math.round(lerp(2, 5.4, k)),
    maxCols: k < 0.4 ? 1 : 2,
    antShare: lerp(0.32, 0.45, k),
    flySpeed: lerp(90, 178, k),
    flyHover: lerp(1.4, 0.55, k),
    flyErratic: lerp(0.45, 1, k),
    flyDodge: lerp(0, 0.45, over(0.22)),
    dbl: lerp(0, 0.45, over(0.3)),
    triple: lerp(0, 0.35, over(0.72)),
    intruderGap: lerp(4.6, 1.9, k),
    foragerGap: lerp(3.4, 2.1, k),
    tail: lerp(0, 0.38, over(0.35)),
    windup: lerp(0.15, 0.24, k),
    recoverMiss: lerp(0.4, 0.8, k),
    recoverHit: lerp(0.26, 0.55, k),
  }
}

// ============================================================================
// Layout + camadas estáticas
// ============================================================================

function computeLayout(w, h, UL) {
  const pf = UL?.playfield || { x: 0, y: 0, w, h }
  const portrait = !UL || UL.orientation === 'portrait'
  const s = clamp(Math.min(pf.w / 440, pf.h / 600), 0.8, 1.5)
  // criaturas um pouco maiores no retrato: alvos tocáveis e reconhecíveis em 375×812
  const cs = s * (portrait ? 1.22 : 1.05)
  const cx = pf.x + pf.w / 2
  const cy = pf.y + pf.h * 0.54
  const R = Math.min(pf.w * 0.33, pf.h * 0.28, 200 * s)
  const tw = Math.min(clamp(pf.w * 0.5, 2.3 * R + 60 * s, pf.w * 0.86), w * 0.92)
  const L = { w, h, s, cs, cx, cy, R, tw, pf, portrait, orient: UL?.orientation || 'portrait', key: `${w}x${h}:${pf.x},${pf.y},${pf.w},${pf.h}` }
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
  const mk = (name, path) => {
    const a = path[path.length - 2]
    return { name, path, angle: Math.atan2(a.y - cy, a.x - cx), busy: 0 }
  }
  return [mk('top', top), mk('bottom', bottom), mk('branch', branch)]
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
  const UL = context.layout
  const pf = UL?.playfield || { x: 0, y: 0, w, h }
  const key = `${w}x${h}:${pf.x},${pf.y},${pf.w},${pf.h}`
  refreshButtons(context)
  if (st.L && st.L.key === key) return
  const dpr = context.renderer?.dpr || (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const oldS = st.L ? st.L.s : null
  st.L = computeLayout(w, h, UL)
  // rotas cujo caminho passa sob os botões virtuais ficam fora (sobram >= 2)
  const clear = st.L.routes.filter((r) => pathClear(r.path, 30 * st.L.s))
  if (clear.length >= 2) st.L.routes = clear
  // colunas em andamento seguem para as rotas novas (senão iriam até a entrada antiga)
  if (oldS != null) reprojectColumns(st.L.s / oldS)
  st.dpr = dpr
  st.sprites = new Map()
  st.bg = buildStatic(st.L, dpr)
  st.entrance = buildEntrance(st.L, dpr)
  st.ticks = buildOverlayPath(st.L)
  rebuildMarksLayer()
  const { cx, cy, R, s } = st.L
  st.player.ctrl = rebuildController(st.player.ctrl, cx, cy, R, s)
}

function refreshButtons(context) {
  const c = context.controls
  st.buttons = c && c.getButtons && context.layout ? c.getButtons(context.layout) : []
}

function nearButtons(x, y, pad) {
  for (const b of st.buttons) if (Math.hypot(x - b.x, y - b.y) < b.r + pad) return true
  return false
}

function pathClear(path, pad) {
  if (!st.buttons.length) return true
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10))
    for (let k = 0; k <= n; k++) {
      if (nearButtons(lerp(a.x, b.x, k / n), lerp(a.y, b.y, k / n), pad)) return false
    }
  }
  return true
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

function edgePointRaw(angle) {
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

// Ponto de chegada na borda cuja rota reta até a entrada não passa sob os botões.
function edgePoint(angle) {
  const { cx, cy, s } = st.L
  for (let i = 0; i < 14; i++) {
    const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.35
    const p = edgePointRaw(a)
    if (pathClear([p, { x: cx, y: cy }], 40 * s)) return { ...p, angle: a }
  }
  return { ...edgePointRaw(angle), angle }
}

function waveAt(t) {
  const i = clamp(Math.floor((t - WAVE_FIRST) / WAVE_STEP), 0, WAVES - 1)
  const local = t - (WAVE_FIRST + i * WAVE_STEP)
  return { index: i, local, inWave: local >= 0 && local <= WAVE_LEN }
}

function spawnForager(T, angle = rand(0, TAU)) {
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
  if (Math.random() < T.tail) {
    const fl = makeFly(p.x - Math.cos(f.dir) * 30 * s, p.y - Math.sin(f.dir) * 30 * s, T)
    fl.mode = 'tail'
    fl.host = f
  }
  return f
}

function makeFly(x, y, T) {
  const { s } = st.L
  const f = {
    kind: 'fly', x, y, t: rand(0, 3), seed: (Math.random() * 1e6) | 0,
    mode: 'hover', hoverT: 0.02, wx: x, wy: y, angle: 0,
    speed: T.flySpeed * s * rand(0.9, 1.1),
    hoverMul: T.flyHover,
    erratic: T.flyErratic,
    dodgeChance: T.flyDodge,
    dodgeDelay: -1, host: null, dead: false,
  }
  st.flies.push(f)
  st.stats.spawned++
  return f
}

function spawnFly(angle, T) {
  const p = edgePoint(angle)
  makeFly(p.x, p.y, T)
  return p.angle
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

function spawnAntColumn(route, T) {
  const { s } = st.L
  const col = {
    route,
    total: T.antsPerCol + (Math.random() < 0.5 ? 1 : 0),
    spawned: 0,
    timer: 0, // primeira formiga sai já
    gap: T.antGap * rand(0.92, 1.12),
    spawner: null,
  }
  col.speed = T.antSpeed * s
  col.spawner = makeColumnSpawner(route.path, col.speed)
  route.busy++
  st.cols.push(col)
}

function makeColumnSpawner(path, speed) {
  return createPatternSpawner({
    pattern: 'file', path, speed, spawnRate: 0, maxEntities: 12,
    onExit: (e) => {
      e.dead = true
      breach(e.x, e.y, 'ant')
    },
  })
}

function pathLengths(path) {
  const acc = [0]
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  return acc
}

// Resize/rotação: cada coluna passa para a rota de mesmo nome (ou a de ângulo mais
// próximo) do layout novo e suas formigas são reprojetadas na mesma fração do caminho.
function reprojectColumns(speedScale) {
  const routes = st.L.routes
  for (const r of routes) r.busy = 0
  for (const c of st.cols) {
    const oldPath = c.route.path
    const route = routes.find((r) => r.name === c.route.name) ||
      routes.slice().sort((a, b) => Math.abs(angDiff(a.angle, c.route.angle)) - Math.abs(angDiff(b.angle, c.route.angle)))[0]
    const oldAcc = pathLengths(oldPath)
    const oldTotal = oldAcc[oldAcc.length - 1] || 1
    const acc = pathLengths(route.path)
    const total = acc[acc.length - 1]
    const oldSpawner = c.spawner
    c.speed *= speedScale
    c.spawner = makeColumnSpawner(route.path, c.speed)
    c.route = route
    route.busy++
    for (const e of oldSpawner.entities) {
      const i = Math.min(e._pathIndex, oldPath.length - 2)
      const a = oldPath[i]
      const frac = clamp((oldAcc[i] + Math.hypot(e.x - a.x, e.y - a.y)) / oldTotal, 0, 1)
      const d = frac * total
      let j = 0
      while (j < acc.length - 2 && acc[j + 1] < d) j++
      const seg = Math.max(1e-6, acc[j + 1] - acc[j])
      const k = clamp((d - acc[j]) / seg, 0, 1)
      const p0 = route.path[j]
      const p1 = route.path[j + 1]
      e.x = lerp(p0.x, p1.x, k)
      e.y = lerp(p0.y, p1.y, k)
      e.px = e.x
      e.py = e.y
      e._pathIndex = j
      e._done = false
      e.rot = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      c.spawner.entities.push(e)
    }
  }
}

function spawnIntruderGroup(T) {
  let approach
  if (Math.random() < T.antShare && st.cols.length < T.maxCols) {
    const r = pickRoute()
    spawnAntColumn(r, T)
    approach = r.angle
  } else {
    approach = spawnFly(rand(0, TAU), T)
  }
  const dbl = Math.random() < T.dbl
  if (dbl) {
    const opposite = approach + Math.PI + rand(-0.6, 0.6)
    if (Math.random() < 0.4 && st.cols.length < T.maxCols) {
      spawnAntColumn(pickRoute(approach), T)
    } else {
      spawnFly(opposite, T)
      if (Math.random() < T.triple) spawnFly(opposite + rand(-0.5, 0.5), T)
    }
  }
  return dbl
}

function forEachIntruder(fn) {
  for (const f of st.flies) fn(f)
  for (const c of st.cols) for (const e of c.spawner.entities) fn(e)
}

// ============================================================================
// Estado
// ============================================================================

function resetState(data) {
  const difficulty = clamp(Number.isFinite(data?.difficulty) ? data.difficulty : config.difficulty.training, 0, 1)
  st = {
    L: null, bg: null, entrance: null, ticks: null, sprites: new Map(), dpr: 1, marksLayer: null, buttons: [],
    shift: Math.max(0, data?.shiftIndex ?? 0),
    difficulty,
    tune: tuningFor(difficulty, 0),
    time: 0, clock: 0, hitStop: 0, shake: 0, ended: false, endT: 0, finished: false,
    foragerTimer: 1.0, intruderTimer: WAVE_FIRST + 0.3, lastWave: -1,
    foragers: [], flies: [], cols: [], debris: [], fx: [], marks: [],
    stats: { repelled: 0, breaches: 0, friendly: 0, spawned: 0, entered: 0, alarms: 0, byAlarm: 0 },
    entranceShake: 0, breachFlash: 0,
    meter: createMeter({ chargeTime: lerp(34, 46, difficulty), duration: ALARM_TIME }),
    alarm: null, helpers: [],
    score: null, free: !!data?.free, lastRepelT: -10,
    drag: null,
    player: {
      ctrl: null, facing: -Math.PI / 2, phase: 'ready', phaseT: 0, dir: { x: 0, y: -1 },
      from: null, to: null, buffer: null, readyPulse: 0, recoverDur: 0.5, moving: 0, aim: null, windup: 0.2,
    },
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

  st.shake = Math.max(0, st.shake - dt * 2.2)
  st.entranceShake = Math.max(0, st.entranceShake - dt)
  st.breachFlash = Math.max(0, st.breachFlash - dt * 1.6)

  if (!st.ended && t >= DURATION) {
    st.ended = true
    st.endT = 0
  }

  st.meter.update(dt)
  const T = (st.tune = tuningFor(st.difficulty, inShiftRamp(t, DURATION)))

  // --- diretor de ondas ---
  if (!st.ended && t < DURATION - 2.5) {
    const wv = waveAt(t)
    if (wv.inWave && wv.index !== st.lastWave) {
      st.lastWave = wv.index
      st.intruderTimer = Math.min(st.intruderTimer, 0.35)
    }
    st.foragerTimer -= dt
    if (st.foragerTimer <= 0) {
      spawnForager(T)
      st.foragerTimer = (wv.inWave ? T.foragerGap : 2.4) * rand(0.7, 1.3)
    }
    if (wv.inWave) {
      st.intruderTimer -= dt
      if (st.intruderTimer <= 0) {
        const dbl = spawnIntruderGroup(T)
        st.intruderTimer = T.intruderGap * rand(0.8, 1.2) * (dbl ? 1.5 : 1)
      }
    }
  }

  const slow = st.meter.isActive ? ALARM_SLOW : 1
  updatePlayer(context, dt)
  updateAnts(dt, slow)
  updateForagers(dt)
  updateFlies(dt * slow)
  updateAlarm(dt)
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
}

function handleInput(context, dt) {
  const ctl = context.controls
  const pl = st.player
  if (pl.buffer) {
    pl.buffer.t -= dt
    if (pl.buffer.t <= 0) pl.buffer = null
  }
  if (st.ended || !ctl) return
  if (ctl.specialPressed) triggerAlarm()

  const { s } = st.L
  const pos = pl.ctrl.position
  if (ctl.pointerTap) {
    const tp = ctl.pointerTap
    const target = pickTapTarget(tp.x, tp.y)
    pl.buffer = { t: BUFFER, x: target ? target.x : tp.x, y: target ? target.y : tp.y, target }
  } else if (ctl.actionPressed) {
    const kv = ctl.move && ctl.move.vx != null && (ctl.move.vx || ctl.move.vy) ? ctl.move : null
    if (kv) {
      pl.buffer = { t: BUFFER, x: pos.x + kv.vx * 100 * s, y: pos.y + kv.vy * 100 * s, target: null }
    } else {
      const target = pickAheadTarget(pos, pl.facing, ctl.isTouch)
      pl.buffer = target
        ? { t: BUFFER, x: target.x, y: target.y, target }
        : { t: BUFFER, x: pos.x + Math.cos(pl.facing) * 100 * s, y: pos.y + Math.sin(pl.facing) * 100 * s, target: null }
    }
  }
}

// Toque/clique: a mira gruda no intruso mais próximo do ponto tocado. Se uma
// forrageira está claramente mais perto do toque, respeita o toque cru.
function pickTapTarget(x, y) {
  const snap = Math.max(46, 36 * st.L.cs)
  let best = null
  let bd = snap
  forEachIntruder((o) => {
    const d = Math.hypot(o.x - x, o.y - y)
    if (d < bd) {
      bd = d
      best = o
    }
  })
  if (!best) return null
  for (const f of st.foragers) {
    if (f.state !== 'enter' && Math.hypot(f.x - x, f.y - y) < bd * 0.6) return null
  }
  return best
}

// Botão Ação: intruso mais próximo à frente (cone largo no toque, estreito no PC).
function pickAheadTarget(pos, facing, touch) {
  const { s } = st.L
  const cone = touch ? 1.35 : 0.3
  const range = (touch ? 200 : 150) * s
  let best = null
  let bestScore = Infinity
  forEachIntruder((o) => {
    const d = Math.hypot(o.x - pos.x, o.y - pos.y)
    if (d > range) return
    const da = Math.abs(angDiff(facing, Math.atan2(o.y - pos.y, o.x - pos.x)))
    if (da > cone && d > 30 * s) return
    const score = d * (1 + da * 0.8)
    if (score < bestScore) {
      bestScore = score
      best = o
    }
  })
  return best
}

function updatePlayer(context, dt) {
  const pl = st.player
  const { s, cx, cy, R } = st.L
  const ctl = context.controls
  const pos = pl.ctrl.position
  const T = st.tune
  pl.readyPulse = Math.max(0, pl.readyPulse - dt * 3)

  // vetor de movimento
  let mv = { x: 0, y: 0 }
  const m = ctl?.move
  if (m && m.vx != null) {
    mv = { x: m.vx, y: m.vy }
    st.drag = null
  } else if (m && m.targetX != null) {
    // arrastar move; um toque curto é investida - só segue depois de segurar/arrastar
    if (!st.drag) st.drag = { t: 0, x: m.pointerX, y: m.pointerY, go: false }
    st.drag.t += dt
    if (!st.drag.go && (st.drag.t > 0.2 || Math.hypot(m.pointerX - st.drag.x, m.pointerY - st.drag.y) > 14)) st.drag.go = true
    if (st.drag.go) {
      const dx = m.targetX - pos.x
      const dy = m.targetY - pos.y
      const d = Math.hypot(dx, dy)
      if (d > 4 * s) {
        const k = Math.min(1, d / (36 * s)) / d
        mv = { x: dx * k, y: dy * k }
      }
    }
  } else {
    st.drag = null
  }
  if (st.ended) mv = { x: 0, y: 0 }

  if (pl.phase === 'ready' || pl.phase === 'recover') {
    pl.ctrl.setSpeedMultiplier(pl.phase === 'recover' ? 0.6 : 1)
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

  const aimAt = (x, y) => {
    let dx = x - pos.x
    let dy = y - pos.y
    let d = Math.hypot(dx, dy)
    if (d < 4 * s) {
      dx = Math.cos(pl.facing)
      dy = Math.sin(pl.facing)
      d = 1
    }
    pl.dir = { x: dx / d, y: dy / d }
    pl.facing = Math.atan2(pl.dir.y, pl.dir.x)
  }

  if (pl.phase === 'ready' && pl.buffer && !st.ended) {
    const b = pl.buffer
    pl.buffer = null
    pl.aim = b.target && !b.target.dead ? b.target : null
    aimAt(pl.aim ? pl.aim.x : b.x, pl.aim ? pl.aim.y : b.y)
    pl.phase = 'windup'
    pl.phaseT = 0
    pl.windup = T.windup
    provokeDodges(pos, pl.dir)
  } else if (pl.phase === 'windup') {
    pl.phaseT += dt
    // assistência: a mira acompanha o alvo escolhido durante o preparo
    if (pl.aim && !pl.aim.dead) aimAt(pl.aim.x, pl.aim.y)
    if (pl.phaseT >= pl.windup) {
      const p = pl.ctrl.position
      let Ls = 96 * s
      if (pl.aim && !pl.aim.dead) Ls = clamp(Math.hypot(pl.aim.x - p.x, pl.aim.y - p.y) + 12 * s, 64 * s, 124 * s)
      let tx = p.x + pl.dir.x * Ls
      let ty = p.y + pl.dir.y * Ls
      const d = Math.hypot(tx - cx, ty - cy)
      const lim = R + 26 * s
      if (d > lim) {
        tx = cx + ((tx - cx) / d) * lim
        ty = cy + ((ty - cy) / d) * lim
      }
      pl.from = { x: p.x, y: p.y }
      pl.to = { x: tx, y: ty }
      pl.phase = 'lunge'
      pl.phaseT = 0
      pl.aim = null
    }
  } else if (pl.phase === 'lunge') {
    const prevU = ease(pl.phaseT / LUNGE, 'easeOutCubic')
    pl.phaseT += dt
    const u = ease(Math.min(1, pl.phaseT / LUNGE), 'easeOutCubic')
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
      pl.recoverDur = T.recoverHit
    } else if (pl.phaseT >= LUNGE) {
      pl.phase = 'recover'
      pl.phaseT = 0
      pl.recoverDur = T.recoverMiss
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
    if (f.mode === 'tail' || f.dodgeChance <= 0) continue
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
const FLY_R = 12
const FORAGER_R = 19
const HEAD_R = 13

// Resolve o primeiro contato da investida. Retorna true se acertou algo.
function strike(hx, hy) {
  const { s, cs } = st.L
  const hitsForagers = []
  const hitsIntruders = []
  for (const f of st.foragers) {
    if (f.state === 'enter') continue
    if (Math.hypot(f.x - hx, f.y - hy) < HEAD_R * s + FORAGER_R * cs * 0.9) hitsForagers.push(f)
  }
  for (const f of st.flies) {
    if (Math.hypot(f.x - hx, f.y - hy) < HEAD_R * s + FLY_R * cs) hitsIntruders.push(f)
  }
  for (const c of st.cols) {
    for (const e of c.spawner.entities) {
      if (Math.hypot(e.x - hx, e.y - hy) < HEAD_R * s + ANT_R * cs) hitsIntruders.push(e)
    }
  }
  if (!hitsForagers.length && !hitsIntruders.length) return false

  const pl = st.player
  const ax = pl.dir.x
  const ay = pl.dir.y
  const kick = 260 * s
  for (const o of hitsIntruders) repel(o, ax, ay)
  for (const f of hitsForagers) {
    st.stats.friendly++
    f.state = 'dazed'
    f.dazeT = 1.7
    f.vx = ax * kick * 0.8
    f.vy = ay * kick * 0.8
    f.spin = rand(-9, 9)
    burst(f.x, f.y, true)
  }
  if (hitsForagers.length) st.score?.miss()
  const friendly = hitsForagers.length > 0
  st.hitStop = friendly ? 0.13 : 0.07
  st.shake = Math.max(st.shake, friendly ? 0.35 : 0.18)
  return true
}

// Remove um intruso (mosca ou formiga) arremessando-o para longe.
function repel(o, ax, ay, byAlarm = false) {
  if (o.dead) return
  o.dead = true
  const { s } = st.L
  const kick = 260 * s
  if (o.kind === 'fly') {
    const i = st.flies.indexOf(o)
    if (i >= 0) st.flies.splice(i, 1)
    st.debris.push({ kind: 'fly', x: o.x, y: o.y, vx: ax * kick * 1.2 + rand(-40, 40) * s, vy: ay * kick * 1.2 - 80 * s, rot: o.angle, spin: rand(-18, 18), t: 0, life: 0.9, seed: o.seed })
  } else {
    for (const c of st.cols) {
      const i = c.spawner.entities.indexOf(o)
      if (i >= 0) c.spawner.entities.splice(i, 1)
    }
    st.debris.push({ kind: 'ant', x: o.x, y: o.y, vx: ax * kick + rand(-30, 30) * s, vy: ay * kick - 120 * s, rot: o.rot || 0, spin: rand(-14, 14), t: 0, life: 1.1, seed: o.seed || 1 })
  }
  st.stats.repelled++
  if (byAlarm) st.stats.byAlarm++
  else st.meter.add(CHARGE_PER_REPEL)
  burst(o.x, o.y, false)
  awardRepel(o, byAlarm)
}

// Pontos no ponto do intruso repelido (popup + combo do ScoreSystem).
function awardRepel(o, byAlarm) {
  if (!st.score) return
  const at = { x: o.x, y: o.y - 14 * (st.L?.s || 1) }
  if (byAlarm) {
    st.score.award(SCORE.alarm, { ...at, reason: 'score.reason.special' })
    return
  }
  const base = o.kind === 'fly' ? SCORE.fly : SCORE.ant
  const chain = st.time - st.lastRepelT <= CHAIN_WINDOW
  st.lastRepelT = st.time
  if (chain) st.score.award(base + SCORE.chainBonus, { ...at, reason: 'score.reason.chain' })
  else st.score.award(base, { ...at, reason: o.kind === 'fly' ? 'score.reason.great' : undefined })
}

function burst(x, y, friendly) {
  st.fx.push({ kind: friendly ? 'friendly' : 'hit', x, y, t: 0, life: friendly ? 0.7 : 0.35, a: rand(0, TAU) })
}

function breach(x, y, kind) {
  const { cx, cy } = st.L
  if (st.ended) return
  if (st.meter.isActive) {
    // guardiãs recrutadas barram na entrada: não conta como brecha
    st.stats.repelled++
    st.stats.byAlarm++
    burst(cx, cy, false)
    st.score?.award(SCORE.alarm, { x: cx, y: cy - 20 * (st.L?.s || 1), reason: 'score.reason.special' })
    return
  }
  st.score?.miss()
  st.stats.breaches++
  st.stats['breach_' + kind] = (st.stats['breach_' + kind] || 0) + 1
  st.marks.push({ a: Math.atan2(y - cy, x - cx), seed: (Math.random() * 1e6) | 0 })
  rebuildMarksLayer()
  st.entranceShake = 0.5
  st.breachFlash = 1
  st.shake = Math.max(st.shake, 0.55)
  st.fx.push({ kind: 'breach', x: cx, y: cy, t: 0, life: 0.6 })
}

function updateAnts(dt, slow) {
  for (const c of st.cols) {
    c.timer -= dt
    if (!st.ended && c.spawned < c.total && c.timer <= 0) {
      const p = c.route.path
      c.spawner.spawn({
        kind: 'ant', rot: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x),
        seed: (Math.random() * 1e6) | 0, t: rand(0, 2), px: p[0].x, py: p[0].y, dead: false,
      })
      c.spawned++
      st.stats.spawned++
      c.timer = c.gap
    }
    c.spawner.update(dt * slow)
    for (const e of c.spawner.entities) {
      const dx = e.x - e.px
      const dy = e.y - e.py
      if (dx * dx + dy * dy > 0.01) e.rot += angDiff(e.rot, Math.atan2(dy, dx)) * Math.min(1, dt * 14)
      e.px = e.x
      e.py = e.y
      e.t += dt * slow
    }
  }
  st.cols = st.cols.filter((c) => {
    const done = (c.spawned >= c.total || st.ended) && c.spawner.entities.length === 0
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
          f.dead = true
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
  const lat = (Math.random() * 2 - 1) * (inside ? 58 : 85) * s * Math.min(1, D / R) * (f.erratic ?? 1)
  const ux = dx / D
  const uy = dy / D
  f.wx = f.x + ux * step - uy * lat
  f.wy = f.y + uy * step + ux * lat
}

// ============================================================================
// Alarme de feromônio
// ============================================================================

function triggerAlarm() {
  if (st.ended || !st.meter.activate()) return
  const { cx, cy, s } = st.L
  st.stats.alarms++
  st.alarm = { t: 0 }
  st.shake = Math.max(st.shake, 0.22)
  st.entranceShake = 0.35
  for (let i = 0; i < ALARM_HELPERS; i++) {
    const a = -Math.PI / 2 + (i / ALARM_HELPERS) * TAU + rand(-0.2, 0.2)
    st.helpers.push({
      x: cx, y: cy, dir: a, orbit: a, t: rand(0, 1), delay: 0.15 + i * 0.09,
      target: null, state: 'out', speed: 440 * s * rand(0.94, 1.06), alpha: 0, seed: i,
    })
  }
}

function claimTarget(hp) {
  const { w, h } = st.L
  const claimed = new Set(st.helpers.map((o) => (o !== hp ? o.target : null)))
  let best = null
  let bd = Infinity
  let fallback = null
  let fd = Infinity
  forEachIntruder((o) => {
    if (o.dead || o.x < -40 || o.x > w + 40 || o.y < -40 || o.y > h + 40) return
    const d = Math.hypot(o.x - hp.x, o.y - hp.y)
    if (!claimed.has(o) && d < bd) {
      bd = d
      best = o
    }
    if (d < fd) {
      fd = d
      fallback = o
    }
  })
  return best || fallback
}

function updateAlarm(dt) {
  const { s, cs, cx, cy, R } = st.L
  if (st.alarm) {
    st.alarm.t += dt
    if (!st.meter.isActive && st.alarm.t > 1.4) st.alarm = null
  }
  const active = st.meter.isActive
  for (const hp of st.helpers) {
    hp.t += dt
    if (hp.delay > 0) {
      hp.delay -= dt
      continue
    }
    hp.alpha = Math.min(1, hp.alpha + dt * 5)
    if (!active && hp.state !== 'home') {
      hp.state = 'home'
      hp.target = null
    }
    let tx
    let ty
    if (hp.state === 'home') {
      tx = cx
      ty = cy
      if (Math.hypot(hp.x - cx, hp.y - cy) < 14 * s) hp.gone = true
    } else {
      if (!hp.target || hp.target.dead) hp.target = claimTarget(hp)
      if (hp.target) {
        tx = hp.target.x
        ty = hp.target.y
      } else {
        hp.orbit += dt * 1.8
        tx = cx + Math.cos(hp.orbit) * R * 1.1
        ty = cy + Math.sin(hp.orbit) * R * 1.1
      }
    }
    const desired = Math.atan2(ty - hp.y, tx - hp.x)
    hp.dir += angDiff(hp.dir, desired) * Math.min(1, dt * 11)
    const d = Math.hypot(tx - hp.x, ty - hp.y)
    const step = Math.min(d, hp.speed * dt * (hp.state === 'home' ? 0.7 : 1))
    hp.x += Math.cos(hp.dir) * step
    hp.y += Math.sin(hp.dir) * step
    if (hp.target && !hp.target.dead && Math.hypot(hp.target.x - hp.x, hp.target.y - hp.y) < 16 * s + 12 * cs) {
      repel(hp.target, Math.cos(hp.dir), Math.sin(hp.dir), true)
      hp.target = null
      st.shake = Math.max(st.shake, 0.1)
    }
  }
  st.helpers = st.helpers.filter((hp) => !hp.gone)
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
}

export function scoreFor({ repelled, breaches, friendly }) {
  const denom = repelled + 1.5 * breaches
  const base = denom > 0 ? (100 * repelled) / denom : 50
  return Math.round(clamp(base - 3 * friendly, 0, 100))
}

function finish(context) {
  const { repelled, breaches, friendly, byAlarm } = st.stats
  const score = scoreFor(st.stats)
  let summary = [
    t('guard.summary.repelled', { n: repelled }),
    t('guard.summary.breaches', { n: breaches }),
    t('guard.summary.friendly', { n: friendly }),
  ].join(', ')
  if (byAlarm > 0) summary += t('guard.summary.byAlarm', { n: byAlarm })
  if (breaches === 0 && friendly === 0 && repelled > 0) summary += t('guard.summary.intact')
  context.finishShift({ score, summary })
}

// ============================================================================
// Render
// ============================================================================

function render(context, ctx) {
  if (!st) return
  ensureLayout(context)
  const L = st.L
  const { w, h, s } = L
  const { cx, cy } = L
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
  drawAlarmPulse(ctx)

  const endFade = st.ended ? clamp(1 - st.endT / 0.9, 0, 1) : 1

  // formigas (rente à casca)
  const antFrames = antSprites()
  for (const c of st.cols) {
    for (const e of c.spawner.entities) blit(ctx, antFrames, e.t / ANT_PERIOD, e.x, e.y, e.rot, 1, endFade, 1)
  }

  // forrageiras
  for (const f of st.foragers) drawForager(ctx, f)

  // moscas
  const flyFrames = flySprites()
  for (const f of st.flies) {
    const hover = Math.sin(f.t * 9) * 2.6 * s
    blit(ctx, flyFrames, f.t / FLY_PERIOD, f.x, f.y + hover, f.angle, 1, 1, 1)
  }

  // restos arremessados
  for (const d of st.debris) {
    const u = d.t / d.life
    const frames = d.kind === 'ant' ? antFrames : flyFrames
    blit(ctx, frames, d.t * 3, d.x, d.y, d.rot, 1, 1 - ease(u, 'easeInQuad'), 1 + u * 0.25)
  }

  drawHelpers(ctx)
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
  if (st.free) drawFreeBadge(ctx, context.layout)
  context.controls?.render?.(ctx, context.layout)
}

// Selo discreto "Turno livre" no canto direito da faixa do HUD.
function drawFreeBadge(ctx, UL) {
  const bar = UL?.hudBar
  if (!bar) return
  const k = clamp(bar.h / 50, 0.9, 1.4)
  const label = t('guard.freeShift')
  ctx.save()
  ctx.globalAlpha = ease(clamp(st.clock / 1.1, 0, 1), 'easeInOutCubic')
  ctx.font = `italic 600 ${Math.round(11 * k)}px Georgia, serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const bw = ctx.measureText(label).width + 16 * k
  const bh = 20 * k
  const bx = bar.x + bar.w - 10 - bw
  const cy = bar.y + bar.h / 2
  ctx.fillStyle = withAlpha(P.paperCreamLight, 0.85)
  ctx.strokeStyle = withAlpha(INK_LINE, 0.55)
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(bx, cy - bh / 2, bw, bh, bh / 2)
  else ctx.rect(bx, cy - bh / 2, bw, bh)
  ctx.fill()
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = withAlpha(INK_LINE, 0.8)
  ctx.fillText(label, bx + bw - 8 * k, cy + 0.5)
  ctx.restore()
}

// Pulso do feromônio: anéis técnicos concêntricos (com marcas de escala) saindo
// da entrada + leve névoa dourada enquanto o alarme dura.
function drawAlarmPulse(ctx) {
  if (!st.alarm) return
  const { s, cx, cy, w, h } = st.L
  const t = st.alarm.t
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 20
  const active = st.meter.isActive
  const fade = active ? 1 : clamp(1 - (t - ALARM_TIME) / 1.2, 0, 1)
  ctx.save()
  // névoa de feromônio
  const haze = (active ? 0.22 + 0.06 * Math.sin(t * 5) : 0.22) * fade * clamp(t / 0.3, 0, 1)
  if (haze > 0.01) {
    const g = ctx.createRadialGradient(cx, cy, 10 * s, cx, cy, maxR * 0.6)
    g.addColorStop(0, withAlpha(P.sunHalo, haze * 1.6))
    g.addColorStop(1, withAlpha(P.sunHalo, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  ctx.lineCap = 'round'
  // três anéis na ativação, depois um anel a cada 0,8s enquanto ativo
  const rings = []
  for (let i = 0; i < 3; i++) rings.push(t - i * 0.18)
  if (active) for (let k = 1; k * 0.8 < t; k++) rings.push(t - k * 0.8 - 0.4)
  for (const rt of rings) {
    if (rt < 0 || rt > 1.3) continue
    const u = rt / 1.3
    const r = lerp(20 * s, maxR, ease(u, 'easeOutCubic'))
    const a = (1 - u) * 0.7 * Math.max(fade, 0.4)
    ctx.strokeStyle = withAlpha(P.inkLine, a)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = withAlpha(P.caterpillarGold, a * 0.9)
    ctx.lineWidth = 3 * s
    ctx.setLineDash([2 * s, 9 * s])
    ctx.beginPath()
    ctx.arc(cx, cy, r - 5 * s, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = withAlpha(P.inkLine, a * 0.8)
    ctx.lineWidth = 0.9
    ctx.beginPath()
    const n = 48
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + u * 0.4
      const len = (i % 4 === 0 ? 9 : 4) * s
      ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r)
      ctx.lineTo(cx + Math.cos(ang) * (r + len), cy + Math.sin(ang) * (r + len))
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawHelpers(ctx) {
  if (!st.helpers.length) return
  const fr = beeSprites('helper')
  for (const hp of st.helpers) {
    if (hp.delay > 0) continue
    // rastro curto de feromônio
    ctx.fillStyle = withAlpha(P.caterpillarGold, 0.35 * hp.alpha)
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath()
      ctx.arc(hp.x - Math.cos(hp.dir) * 9 * i * st.L.s, hp.y - Math.sin(hp.dir) * 9 * i * st.L.s, (2.2 - i * 0.5) * st.L.s, 0, TAU)
      ctx.fill()
    }
    blit(ctx, fr, (hp.t * BEE_FLAP) / TAU, hp.x, hp.y, hp.dir, 1, hp.alpha, 1)
  }
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
  const sc = 1.6 * st.L.cs
  return frames('ant', 8, 40 * sc, (g, u) => drawAnt(g, createAntPose(0, 0, u * ANT_PERIOD, { scale: sc, seed: 5 })))
}

function flySprites() {
  const sc = 2.5 * st.L.cs
  return frames('fly', 12, 30 * sc, (g, u) => {
    const pose = createPhoridFlyPose(0, 0, u * FLY_PERIOD, { scale: sc, seed: 9 })
    pose.hover = 0
    drawPhoridFly(g, pose)
  })
}

function beeSprites(kind) {
  const s = st.L.s
  if (kind === 'forager') {
    const sc = 1.55 * st.L.cs
    return frames('forager', 8, 64 * sc, (g, u) =>
      drawBeeBody(g, createCarryingPose(0, 0, (u * TAU) / FORAGER_FLAP, { colorVariant: 'old', scale: sc, seed: 31, amount: 1.5 })))
  }
  if (kind === 'helper') {
    const sc = 1.6 * s
    return frames('helper', 8, 64 * sc, (g, u) =>
      drawBeeBody(g, createFlightPose(0, 0, (u * TAU) / BEE_FLAP, { colorVariant: 'old', scale: sc, seed: 13, flapAmount: 0.9, flapSpeed: BEE_FLAP })))
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
  drawOrientedBee(ctx, beeSprites('forager'), (t * FORAGER_FLAP) / TAU + (f.seed % 8) / 8, f.x, f.y + bob, f.dir, alpha, scale)
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

// bee.js desenha em vista de cima (+x = cabeça): basta girar para a direção.
function drawOrientedBee(ctx, fr, phase, x, y, angle, alpha, scale) {
  blit(ctx, fr, phase, x, y, angle, 1, alpha, scale)
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

  if (pl.phase === 'windup') {
    const u = ease(clamp(pl.phaseT / pl.windup, 0, 1), 'easeOutQuad')
    x -= pl.dir.x * 7 * s * u
    y -= pl.dir.y * 7 * s * u
    scale *= 1 - 0.06 * u
    kind = 'tuck'
    drawAim(ctx, pos, pl.dir, pl.phaseT / pl.windup)
  } else if (pl.phase === 'lunge') {
    scale *= 1.06
    kind = 'tuck'
  }

  // sombra de pouso (leve) para ancorar na casca
  ctx.fillStyle = 'rgba(43,36,24,0.12)'
  ctx.beginPath()
  ctx.ellipse(pos.x + 5 * s, pos.y + 8 * s, 19 * s, 11 * s, 0, 0, TAU)
  ctx.fill()

  const hover = pl.phase === 'ready' ? Math.sin(st.clock * 2.4) * 1.5 * s : 0
  drawOrientedBee(ctx, beeSprites(kind), (st.clock * BEE_FLAP) / TAU, x, y + hover, angle, 1, scale)

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

// Vetor da investida durante o preparo (tinta; accentPink fica só no botão Especial pronto).
function drawAim(ctx, pos, dir, u) {
  const { s } = st.L
  const k = ease(clamp(u, 0, 1), 'easeInOutQuad')
  const len = 92 * s
  const x0 = pos.x + dir.x * 18 * s
  const y0 = pos.y + dir.y * 18 * s
  const x1 = pos.x + dir.x * (18 * s + (len - 18 * s) * k)
  const y1 = pos.y + dir.y * (18 * s + (len - 18 * s) * k)
  ctx.save()
  ctx.strokeStyle = withAlpha(P.inkLine, 0.75)
  ctx.lineWidth = 1.4
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
    st.score = context.score ?? null
    context.controls?.configure?.({
      showAction: true,
      showSpecial: true,
      showDirections: false,
      meter: st.meter,
      actionLabel: t('guard.actionButton'),
      specialLabel: t('guard.specialButton'),
    })
    ensureLayout(context)
  },
  update,
  render,
  exit() {
    st = null
  },
}
