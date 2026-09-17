// Tarefa: Alimentar larvas (a abelha como nutriz).
//
// Gênero: triagem espacial sob pressão. Um disco de favo de cria com várias
// larvas cuja fome sobe em velocidades diferentes (legível pelo comportamento
// da larva: contorção, tom, poça de alimento secando). A nutriz voa até uma
// célula; a larva "abre" numa TimingWindow orgânica — ação no centro alimenta
// bem, na borda alimenta parcialmente, fora dela desperdiça a porção. O estoque
// de alimento larval é limitado: reabastecer exige pairar parada junto aos
// potes de pólen/néctar, enquanto as outras fomes sobem.
//
// Controles (context.controls — celular e PC):
//   mover: arrastar o dedo / segurar o mouse (a abelha segue) ou WASD/setas;
//   tocar/clicar numa célula (ou nos potes) leva a abelha até lá;
//   Ação (botão, Espaço/Enter; clique na célula acoplada no PC) alimenta;
//   Especial (botão, E/Shift) = "Chamado das nutrizes": por ~6s outras nutrizes
//   chegam, todas as fomes caem bastante e ficam congeladas.
//
// Dificuldade: data.difficulty (0–1) é a fonte da verdade entre turnos;
// dentro do turno a fome acelera por inShiftRamp.

import { create as createMovement } from '../../engine/MovementController.js'
import { create as createGauge } from '../../engine/Gauge.js'
import { create as createTimingWindow } from '../../engine/TimingWindow.js'
import { create as createMeter } from '../../engine/SpecialMeter.js'
import { ease, lerp } from '../../engine/tween.js'
import {
  createFlightPose,
  createIdlePose,
  createRegurgitatePose,
  drawBeeBody,
} from '../../art/bee.js'
import { drawCell } from '../../art/hive.js'
import {
  seededRandom,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  drawPaperGrain,
  polygonPoints,
  tracePath,
  withAlpha,
  mixColors as mix,
  shade,
  INK_LINE,
} from '../../art/textureUtils.js'
import { styleGuide } from '../../data/styleGuide.js'
import { inShiftRamp } from '../../data/config.js'
import { getLayout } from '../../ui/layout.js'

const P = styleGuide.palettes.naturalist
const TAU = Math.PI * 2
const CRITICAL_COLOR = '#C8612E' // ferrugem quente (NÃO é o accentPink)
const FOOD_GOLD = '#E9C96B'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const damp = (rate, dt) => 1 - Math.exp(-rate * dt)
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

// ---------------------------------------------------------------------------
// Dificuldade (d = data.difficulty, 0–1)
// ---------------------------------------------------------------------------

const SPECIAL = { chargeTime: 22, duration: 6, drop: 0.55, perfectBonus: 0.06, goodBonus: 0.025 }

function buildDifficulty(difficulty = 0.1) {
  const d = clamp(Number.isFinite(difficulty) ? difficulty : 0.1, 0, 1)
  const L = (a, b) => a + (b - a) * d
  const startLarvae = Math.round(L(2.8, 5))
  return {
    d,
    duration: 60,
    startLarvae,
    totalLarvae: Math.max(startLarvae, Math.round(L(3.6, 7.7))),
    maxStock: Math.round(L(6.3, 4)),
    // segundos médios para uma larva ir de 0 a 100 de fome
    meanFillTime: L(62, 30),
    rateSpread: L(0.12, 0.5),
    rampInShift: L(0.15, 0.45), // multiplicador extra de fome no fim do turno (× inShiftRamp)
    windowBase: L(0.85, 0.34),
    windowRamp: L(0.05, 0.1),
    windowJitter: L(0.12, 0.42),
    periodRange: [L(0.3, 0.35), L(0.7, 1.3)],
    strainLimit: L(10, 5.2), // tempo em fome crítica até enfraquecer
    refuelPer: L(0.17, 0.26),
    perfectRelief: 66,
    goodRelief: L(46, 36),
  }
}

// ---------------------------------------------------------------------------
// Layout (recalculado quando o tamanho lógico muda). O mundo vive em
// layout.playfield; retrato é o formato principal.
// ---------------------------------------------------------------------------

function computeLayout(lay, seed, slotCount) {
  const w = lay.width
  const h = lay.height
  const pf = lay.playfield
  const u = clamp(Math.min(pf.w, pf.h) / 560, 0.6, 1.4)
  const portrait = pf.h > pf.w * 1.05
  const zoneR = clamp(Math.min(pf.w, pf.h) * 0.17, 46, 85)
  let comb
  let pot
  if (portrait) {
    // favo em cima (mais alto que largo), potes embaixo à esquerda — longe dos
    // botões (canto inferior direito) e alcançáveis arrastando com o polegar.
    const stripH = zoneR * 2 + 22
    const areaH = pf.h - stripH
    comb = { cx: pf.x + pf.w / 2, cy: pf.y + areaH / 2 + 6, rx: pf.w * 0.45, ry: Math.min(areaH * 0.46, pf.w * 0.75) }
    pot = { x: pf.x + zoneR + 18, y: pf.y + pf.h - zoneR - 8 }
  } else {
    comb = { cx: pf.x + pf.w * 0.6, cy: pf.y + pf.h * 0.5, rx: Math.min(pf.w * 0.36, pf.h * 0.56), ry: pf.h * 0.42 }
    pot = { x: pf.x + zoneR + 16, y: pf.y + pf.h - zoneR - 16 }
  }
  const R = clamp(Math.min(comb.rx, comb.ry) / 6, 24, 40)
  const dx = Math.sqrt(3) * R * 1.06
  const dy = 1.5 * R * 1.06
  const rng = seededRandom(seed)

  const cells = []
  const rows = Math.ceil(comb.ry / dy) + 1
  const cols = Math.ceil(comb.rx / dx) + 1
  for (let r = -rows; r <= rows; r++) {
    for (let c = -cols; c <= cols; c++) {
      const x = comb.cx + c * dx + (Math.abs(r) % 2 ? dx / 2 : 0)
      const y = comb.cy + r * dy
      const rn = Math.hypot((x - comb.cx) / comb.rx, (y - comb.cy) / comb.ry)
      if (rn > 0.97) continue
      cells.push({
        x: x + (rng() - 0.5) * R * 0.1,
        y: y + (rng() - 0.5) * R * 0.1,
        size: R * (0.95 + rng() * 0.08),
        rotation: Math.PI / 6 + (rng() - 0.5) * 0.1,
        seed: 100 + cells.length * 7,
        rn,
        slot: -1,
        decor: rng() < 0.62 ? 'capped' : 'empty',
      })
    }
  }

  // Slots de larva: amostragem por ponto mais distante, só no miolo do disco.
  const interior = cells.filter((c) => c.rn < 0.8)
  const slots = []
  if (interior.length) {
    let first = interior[0]
    let best = Infinity
    const ox = (rng() - 0.5) * comb.rx * 0.5
    const oy = (rng() - 0.5) * comb.ry * 0.5
    for (const c of interior) {
      const d = dist(c.x, c.y, comb.cx + ox, comb.cy + oy)
      if (d < best) { best = d; first = c }
    }
    slots.push(first)
    first.slot = 0
    while (slots.length < slotCount && slots.length < interior.length) {
      let pick = null
      let pickScore = -1
      for (const c of interior) {
        if (c.slot >= 0) continue
        let md = Infinity
        for (const s of slots) md = Math.min(md, dist(c.x, c.y, s.x, s.y))
        const score = md * (0.85 + rng() * 0.3) * (1 - c.rn * 0.25)
        if (score > pickScore) { pickScore = score; pick = c }
      }
      if (!pick) break
      pick.slot = slots.length
      slots.push(pick)
    }
  }

  return {
    w, h, u, portrait, comb, R, cells, slots, pf, lay,
    pot: { ...pot, zoneR, k: zoneR / 80 },
    beeScale: R / 20,
    fs: clamp(lay.uiScale || 1, 0.95, 1.3), // escala de fonte/overlays
    speed: clamp(Math.hypot(pf.w, pf.h) * 0.42, 240, 460),
  }
}

// ---------------------------------------------------------------------------
// Camada estática pré-renderizada (papel, favo, involucro, potes)
// ---------------------------------------------------------------------------

function renderStaticLayer(L, dpr) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(L.w * dpr))
  canvas.height = Math.max(1, Math.round(L.h * dpr))
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const { w, h, comb, u } = L

  drawPaperGrain(ctx, w, h, { seed: 31, noiseCount: Math.round((w * h) / 900) })

  // Vinheta quente suave (luz de fim de tarde vindo do alto à esquerda).
  const glow = ctx.createRadialGradient(w * 0.3, h * 0.15, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8)
  glow.addColorStop(0, withAlpha(P.sunHalo, 0.28))
  glow.addColorStop(0.55, withAlpha(P.sunHalo, 0))
  glow.addColorStop(1, withAlpha('#6E5219', 0.18))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Involucro de cerume: lâminas concêntricas irregulares em volta do disco.
  for (let i = 3; i >= 1; i--) {
    const pts = polygonPoints(comb.cx, comb.cy, comb.rx * (1.03 + i * 0.045), comb.ry * (1.04 + i * 0.05), 40, {
      jitter: 0.025, seed: 400 + i, rotation: i * 0.3,
    })
    ctx.save()
    ctx.beginPath()
    tracePath(ctx, pts, { closed: true, smooth: true })
    ctx.fillStyle = withAlpha(mix('#8A6A3E', P.paperCreamDark, 0.35 + i * 0.12), 0.35)
    ctx.fill()
    ctx.clip()
    drawHatching(ctx, { x: comb.cx - comb.rx * 1.4, y: comb.cy - comb.ry * 1.4, width: comb.rx * 2.8, height: comb.ry * 2.8 }, {
      angle: 0.5 + i * 0.4, lineCount: 34, color: '#5A4128', opacityRange: [0.05, 0.12], seed: 410 + i, curveAmount: 10,
    })
    ctx.restore()
    strokeHandDrawn(ctx, pts, { closed: true, baseWidth: 0.9, widthJitter: 0.35, seed: 420 + i, opacity: 0.35 })
  }

  // Fundo de cerume escuro do disco de cria.
  const discPts = polygonPoints(comb.cx, comb.cy, comb.rx * 1.02, comb.ry * 1.03, 44, { jitter: 0.018, seed: 440 })
  ctx.save()
  ctx.beginPath()
  tracePath(ctx, discPts, { closed: true, smooth: true })
  const discGrad = ctx.createRadialGradient(comb.cx - comb.rx * 0.2, comb.cy - comb.ry * 0.25, 10, comb.cx, comb.cy, Math.max(comb.rx, comb.ry))
  discGrad.addColorStop(0, '#5E4428')
  discGrad.addColorStop(1, '#33251A')
  ctx.fillStyle = discGrad
  ctx.fill()
  ctx.restore()
  strokeHandDrawn(ctx, discPts, { closed: true, baseWidth: 1.8, widthJitter: 0.5, seed: 441, opacity: 0.85 })

  for (const c of L.cells) drawCell(ctx, c, c.slot >= 0 ? 'empty' : c.decor)

  // Sombra estipulada na metade de baixo do disco.
  ctx.save()
  ctx.beginPath()
  tracePath(ctx, discPts, { closed: true, smooth: true })
  ctx.clip()
  drawStipple(ctx, { x: comb.cx - comb.rx, y: comb.cy - comb.ry, width: comb.rx * 2, height: comb.ry * 2 }, {
    color: '#1A1208', count: Math.round(comb.rx * comb.ry / 90), seed: 450, radius: [0.5, 1.4], opacity: [0.06, 0.16],
    densityBias: (_u, v) => v * v,
  })
  ctx.restore()

  drawPots(ctx, L)

  // Marca de escala fina ao longo do eixo do disco (motivo de instrumento).
  ctx.save()
  ctx.strokeStyle = withAlpha(INK_LINE, 0.28)
  ctx.lineWidth = 0.8
  const y0 = comb.cy + comb.ry * 1.2
  const potTop = L.pot.y - L.pot.zoneR - 6
  if (y0 < L.pf.y + L.pf.h - 8 && (y0 < potTop || comb.cx - comb.rx * 0.9 > L.pot.x + L.pot.zoneR)) {
    ctx.beginPath()
    ctx.moveTo(comb.cx - comb.rx * 0.9, y0)
    ctx.lineTo(comb.cx + comb.rx * 0.9, y0)
    for (let i = 0; i <= 20; i++) {
      const x = comb.cx - comb.rx * 0.9 + (comb.rx * 1.8 * i) / 20
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y0 - (i % 5 === 0 ? 7 : 3.5) * u)
    }
    ctx.stroke()
  }
  ctx.restore()

  return canvas
}

function drawPot(ctx, x, y, rx, ry, kind, seed) {
  const body = polygonPoints(x, y, rx, ry, 30, { jitter: 0.03, seed })
  // sombra no chão
  ctx.save()
  ctx.fillStyle = withAlpha('#2B2418', 0.16)
  ctx.beginPath()
  ctx.ellipse(x + rx * 0.12, y + ry * 0.92, rx * 0.95, ry * 0.25, 0, 0, TAU)
  ctx.fill()

  ctx.beginPath()
  tracePath(ctx, body, { closed: true, smooth: true })
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.35, 2, x, y, Math.max(rx, ry) * 1.1)
  g.addColorStop(0, '#A87A45')
  g.addColorStop(1, '#5E3B1C')
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  drawHatching(ctx, { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 }, {
    angle: 1.2, lineCount: 16, color: '#2B1A0C', opacityRange: [0.1, 0.22], seed: seed + 1, curveAmount: rx * 0.25,
  })
  drawStipple(ctx, { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 }, {
    color: '#1A1208', count: 70, seed: seed + 2, opacity: [0.08, 0.22], densityBias: (u, v) => (u + v) / 2,
  })
  ctx.restore()
  strokeHandDrawn(ctx, body, { closed: true, baseWidth: 1.6, widthJitter: 0.45, seed: seed + 3 })

  // boca do pote com o conteúdo à mostra
  const mx = x - rx * 0.05
  const my = y - ry * 0.62
  const mrx = rx * 0.48
  const mry = ry * 0.2
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(mx, my, mrx, mry, -0.05, 0, TAU)
  ctx.fillStyle = '#3B2616'
  ctx.fill()
  ctx.clip()
  if (kind === 'pollen') {
    ctx.fillStyle = '#B98A2A'
    ctx.fillRect(mx - mrx, my - mry * 0.4, mrx * 2, mry * 2)
    drawStipple(ctx, { x: mx - mrx, y: my - mry, width: mrx * 2, height: mry * 2 }, {
      color: P.caterpillarGold, count: 40, seed: seed + 4, radius: [0.5, 1.3], opacity: [0.5, 0.9],
    })
  } else {
    const hg = ctx.createLinearGradient(mx, my - mry, mx, my + mry)
    hg.addColorStop(0, '#F5C542')
    hg.addColorStop(1, '#B8741C')
    ctx.fillStyle = hg
    ctx.fillRect(mx - mrx, my - mry * 0.5, mrx * 2, mry * 2)
    ctx.fillStyle = withAlpha(P.sunHalo, 0.7)
    ctx.beginPath()
    ctx.ellipse(mx - mrx * 0.3, my, mrx * 0.25, mry * 0.25, 0, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = INK_LINE
  ctx.globalAlpha = 0.75
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.ellipse(mx, my, mrx, mry, -0.05, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function drawPots(ctx, L) {
  const { pot } = L
  const k = pot.k
  // três potes de cerume, de trás para frente
  drawPot(ctx, pot.x + 30 * k, pot.y - 22 * k, 24 * k, 30 * k, 'nectar', 510)
  drawPot(ctx, pot.x - 28 * k, pot.y - 6 * k, 27 * k, 33 * k, 'pollen', 520)
  drawPot(ctx, pot.x + 12 * k, pot.y + 26 * k, 22 * k, 26 * k, 'pollen', 530)
}

// ---------------------------------------------------------------------------
// Larva (dinâmica)
// ---------------------------------------------------------------------------

function drawLarva(ctx, cell, larva, t, opening) {
  const { x, y } = cell
  const R = cell.size
  const hRatio = larva.hunger.value / 100
  const sat = 1 - hRatio
  const vit = larva.vitality / 3
  const lost = larva.state === 'lost'

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, R * 0.8, 0, TAU)
  ctx.clip()

  // Brilho de alerta por baixo quando crítica.
  if (!lost && larva.hunger.state === 'critical') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 7 + larva.seed)
    const g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R * 0.8)
    g.addColorStop(0, withAlpha(CRITICAL_COLOR, 0.15 + pulse * 0.25))
    g.addColorStop(1, withAlpha(CRITICAL_COLOR, 0))
    ctx.fillStyle = g
    ctx.fillRect(x - R, y - R, R * 2, R * 2)
  }

  // Poça de alimento larval: seca conforme a fome sobe.
  const pool = lost ? 0.1 : clamp(0.12 + sat * 0.88 + larva.plump * 0.2, 0, 1.1)
  ctx.fillStyle = withAlpha(FOOD_GOLD, 0.35 + pool * 0.35)
  ctx.beginPath()
  ctx.ellipse(x, y + R * 0.2, R * 0.66 * pool, R * 0.34 * pool, 0, 0, TAU)
  ctx.fill()
  if (pool > 0.4) {
    ctx.fillStyle = withAlpha(P.sunHalo, 0.35 * pool)
    ctx.beginPath()
    ctx.ellipse(x - R * 0.2 * pool, y + R * 0.1, R * 0.18 * pool, R * 0.06 * pool, -0.2, 0, TAU)
    ctx.fill()
  }

  // Espinha em "C" com contorção proporcional à fome.
  const hatchS = larva.hatchAnim < 1 ? ease(larva.hatchAnim, 'easeOutBack') : 1
  const agitation = lost ? 0 : 0.04 + 0.42 * hRatio * hRatio
  const freq = lost ? 0 : 1.2 + 7.5 * Math.pow(hRatio, 1.5)
  const phase = t * freq + larva.seed
  const twitch = larva.twitch * Math.sin(t * 38) * 0.35
  const baseRot = larva.seed * 1.7 + Math.sin(phase * 0.5) * agitation * 0.8 + twitch
  const segs = 12
  const plumpS = 1 + larva.plump * 0.18
  const size = hatchS * (lost ? 0.62 : 0.78 + 0.22 * vit) * plumpS
  const rMid = R * 0.3 * size
  const startA = 0.15 - (opening * 0.35)
  const endA = Math.PI * 1.55 - agitation * 0.3 * Math.sin(phase) - opening * 0.25
  const spine = []
  for (let i = 0; i <= segs; i++) {
    const f = i / segs
    const a = baseRot + startA + (endA - startA) * f
    const wave = Math.sin(phase * 1.3 + i * 0.8) * agitation * 0.22
    // cabeça (f -> 1) levanta em direção ao centro quando a larva abre
    const headPull = opening * Math.pow(f, 3) * 0.55
    const rr = rMid * (1 + wave - headPull)
    spine.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, a })
  }
  const thick = R * 0.17 * size * (lost ? 0.7 : 0.8 + 0.28 * sat)
  const outer = []
  const inner = []
  spine.forEach((p, i) => {
    const f = i / segs
    const taper = Math.sin(0.12 + f * (Math.PI - 0.12))
    const half = thick * (0.25 + 0.75 * taper)
    const nx = Math.cos(p.a)
    const ny = Math.sin(p.a)
    outer.push({ x: p.x + nx * half, y: p.y + ny * half })
    inner.push({ x: p.x - nx * half, y: p.y - ny * half })
  })
  const outline = outer.concat(inner.slice().reverse())

  let bodyColor = mix('#F6F0DE', '#D6BF93', clamp(hRatio * 1.15, 0, 1))
  bodyColor = mix(bodyColor, '#978B73', (1 - vit) * 0.75)
  if (lost) bodyColor = '#6E6250'
  if (larva.weakFlash > 0) bodyColor = mix(bodyColor, '#5A5040', larva.weakFlash * 0.6)
  if (larva.feedFlash > 0) bodyColor = mix(bodyColor, '#FFF8E6', larva.feedFlash * 0.7)

  ctx.beginPath()
  tracePath(ctx, outline, { closed: true, smooth: true })
  ctx.fillStyle = bodyColor
  ctx.fill()
  ctx.strokeStyle = withAlpha(shade(bodyColor, -0.45), 0.75)
  ctx.lineWidth = 0.9
  ctx.stroke()

  // Vincos dos segmentos.
  ctx.strokeStyle = withAlpha(shade(bodyColor, -0.35), 0.45)
  ctx.lineWidth = 0.6
  ctx.beginPath()
  for (let i = 2; i < segs - 1; i += 2) {
    ctx.moveTo(outer[i].x * 0.8 + inner[i].x * 0.2, outer[i].y * 0.8 + inner[i].y * 0.2)
    ctx.lineTo(outer[i].x * 0.25 + inner[i].x * 0.75, outer[i].y * 0.25 + inner[i].y * 0.75)
  }
  ctx.stroke()

  // Brilho úmido de larva bem alimentada.
  if (!lost && sat > 0.35) {
    ctx.strokeStyle = withAlpha('#FFFFFF', 0.45 * (sat - 0.35) / 0.65)
    ctx.lineWidth = 1.1
    ctx.beginPath()
    const a0 = Math.floor(segs * 0.25)
    const a1 = Math.floor(segs * 0.7)
    ctx.moveTo(outer[a0].x * 0.6 + spine[a0].x * 0.4, outer[a0].y * 0.6 + spine[a0].y * 0.4)
    for (let i = a0 + 1; i <= a1; i++) ctx.lineTo(outer[i].x * 0.6 + spine[i].x * 0.4, outer[i].y * 0.6 + spine[i].y * 0.4)
    ctx.stroke()
  }

  // Cabeça + boca.
  const head = spine[segs]
  ctx.fillStyle = lost ? '#4A4032' : mix('#C9A877', '#9A7A4A', hRatio)
  ctx.beginPath()
  ctx.arc(head.x, head.y, thick * 0.42, 0, TAU)
  ctx.fill()
  if (opening > 0.05 && !lost) {
    ctx.fillStyle = withAlpha('#3B2616', 0.85)
    ctx.beginPath()
    ctx.ellipse(head.x, head.y, thick * 0.26 * opening, thick * 0.16 * opening + 0.5, head.a, 0, TAU)
    ctx.fill()
  }
  ctx.restore()

  if (lost) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, R * 0.82, 0, TAU)
    ctx.fillStyle = withAlpha('#1A1208', 0.35)
    ctx.fill()
    ctx.clip()
    drawHatching(ctx, { x: x - R, y: y - R, width: R * 2, height: R * 2 }, {
      angle: -0.7, lineCount: 9, color: '#1A1208', opacityRange: [0.25, 0.4], seed: larva.seed * 13, curveAmount: 1.5,
    })
    ctx.restore()
  }
}

function drawEgg(ctx, cell, larva, t) {
  const R = cell.size
  const wob = larva.hatchSoon * Math.sin(t * 14 + larva.seed) * 0.12
  ctx.save()
  ctx.translate(cell.x, cell.y + R * 0.05)
  ctx.rotate(0.2 + wob)
  ctx.fillStyle = withAlpha(P.caterpillarCream, 0.95)
  ctx.beginPath()
  ctx.ellipse(0, 0, R * 0.13, R * 0.3, 0, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = withAlpha(INK_LINE, 0.4)
  ctx.lineWidth = 0.7
  ctx.stroke()
  ctx.restore()
}

// Mostrador fino de fome em volta da célula (arco de transferidor).
function drawHungerDial(ctx, cell, larva, t, reveal) {
  const R = cell.size
  const r = R * 1.02
  const a0 = Math.PI * 0.72
  const span = Math.PI * 1.56
  ctx.save()
  ctx.lineCap = 'round'
  if (larva.state === 'egg') {
    ctx.setLineDash([1.5, 4])
    ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.35)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cell.x, cell.y, r, a0, a0 + span * reveal)
    ctx.stroke()
    ctx.restore()
    return
  }
  if (larva.state === 'lost') { ctx.restore(); return }

  const ratio = larva.hunger.value / 100
  const state = larva.hunger.state
  ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.3)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cell.x, cell.y, r, a0, a0 + span * reveal)
  ctx.stroke()

  // marcas de escala nos limiares
  ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.55)
  ctx.beginPath()
  for (const th of [0, 0.5, 0.8, 1]) {
    const a = a0 + span * th
    ctx.moveTo(cell.x + Math.cos(a) * (r - 3), cell.y + Math.sin(a) * (r - 3))
    ctx.lineTo(cell.x + Math.cos(a) * (r + 3), cell.y + Math.sin(a) * (r + 3))
  }
  ctx.stroke()

  let color = P.leafSageHighlight
  let width = 2
  if (state === 'restless') { color = P.sunGold; width = 2.4 }
  if (state === 'critical') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 8 + larva.seed)
    color = mix(CRITICAL_COLOR, P.sunHalo, pulse * 0.35)
    width = 2.8 + pulse
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(cell.x, cell.y, r, a0, a0 + span * ratio * reveal)
  ctx.stroke()

  // tensão acumulada em fome crítica: marcas externas que "acendem"
  if (larva.strain > 0.05) {
    const f = larva.strain / larva.strainLimit
    const n = 8
    ctx.lineWidth = 1.4
    for (let i = 0; i < n; i++) {
      const a = a0 + span + 0.12 + i * 0.1
      const lit = i / n < f
      ctx.strokeStyle = lit ? withAlpha(CRITICAL_COLOR, 0.95) : withAlpha(P.caterpillarCream, 0.25)
      ctx.beginPath()
      ctx.moveTo(cell.x + Math.cos(a) * (r - 2), cell.y + Math.sin(a) * (r - 2))
      ctx.lineTo(cell.x + Math.cos(a) * (r + 5), cell.y + Math.sin(a) * (r + 5))
      ctx.stroke()
    }
  }
  // marcas de vitalidade perdida (entalhes escuros no início do arco)
  for (let i = 0; i < 3 - larva.vitality; i++) {
    const a = a0 - 0.14 - i * 0.14
    ctx.strokeStyle = withAlpha('#1A1208', 0.85)
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(cell.x + Math.cos(a) * (r - 4), cell.y + Math.sin(a) * (r - 4))
    ctx.lineTo(cell.x + Math.cos(a) * (r + 4), cell.y + Math.sin(a) * (r + 4))
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Estado da tarefa
// ---------------------------------------------------------------------------

let S = null

function makeLarva(i, D, initial) {
  const f = 1 + (Math.random() * 2 - 1) * D.rateSpread
  const larva = {
    index: i,
    state: initial ? 'larva' : 'egg',
    hunger: createGauge({ rate: 0, max: 100, min: 0, thresholds: { restless: 0.5, critical: 0.8 } }),
    baseRate: 100 / (D.meanFillTime * f),
    vitality: 3,
    strain: 0,
    strainLimit: D.strainLimit,
    plump: 0,
    twitch: 0,
    weakFlash: 0,
    feedFlash: 0,
    hatchAnim: initial ? 1 : 0,
    hatchSoon: 0,
    hatchAt: 0,
    everWeakened: false,
    callDrop: null, // { from, to, t } queda animada do especial
    seed: 1 + i * 2.37 + Math.random() * 3,
  }
  if (initial) larva.hunger.value = 12 + Math.random() * (30 + 20 * D.d)
  return larva
}

function layoutFor(context) {
  const lay = context.layout
  if (lay && lay.width === context.width && lay.height === context.height) return lay
  return getLayout(context.width, context.height)
}

function rebuildLayout(context, lay) {
  const old = S.layout
  S.layout = computeLayout(lay, S.layoutSeed, S.larvae.length)
  const L = S.layout
  const dpr = (typeof context.renderer?.dpr === 'number' && context.renderer.dpr) || (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  S.staticLayer = renderStaticLayer(L, dpr)
  S.staticDpr = dpr
  S.layRef = lay
  const pf = L.pf
  const pos = S.mover ? S.mover.position : null
  const margin = 10
  S.mover = createMovement({
    bounds: { x: pf.x + margin, y: pf.y + margin, width: pf.w - margin * 2, height: pf.h - margin * 2 },
    speed: L.speed,
  })
  if (pos && old) {
    const fx = (pos.x - old.pf.x) / Math.max(1, old.pf.w)
    const fy = (pos.y - old.pf.y) / Math.max(1, old.pf.h)
    S.mover.setPosition(pf.x + fx * pf.w, pf.y + fy * pf.h)
  } else {
    S.mover.setPosition(L.pot.x + L.pot.zoneR * 1.3, L.pot.y - L.pot.zoneR * 1.2)
  }
  S.dock = null
  S.auto = null
}

function ensureLayout(context) {
  const lay = layoutFor(context)
  const dpr = (typeof context.renderer?.dpr === 'number' && context.renderer.dpr) || (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const L = S.layout
  if (!L || L.w !== lay.width || L.h !== lay.height || S.staticDpr !== dpr ||
      L.pf.x !== lay.playfield.x || L.pf.y !== lay.playfield.y || L.pf.w !== lay.playfield.w || L.pf.h !== lay.playfield.h) {
    rebuildLayout(context, lay)
  }
}

function addFloater(x, y, text, color) {
  S.floaters.push({ x, y, text, color, life: 0, max: 1.1 })
}

function burst(x, y, kind, R) {
  if (kind === 'perfect') {
    S.rings.push({ x, y, r: R * 0.6, grow: R * 2.2, life: 0, max: 0.55, color: P.sunHalo, width: 2.5, rays: 14 })
    S.rings.push({ x, y, r: R * 0.9, grow: R * 1.3, life: 0, max: 0.7, color: P.sunGold, width: 1, rays: 0 })
  } else if (kind === 'good') {
    S.rings.push({ x, y, r: R * 0.6, grow: R * 1.1, life: 0, max: 0.45, color: P.leafSageHighlight, width: 1.6, rays: 0 })
  } else if (kind === 'miss') {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU
      const sp = R * (1.5 + Math.random() * 2.5)
      S.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - R, g: R * 6,
        r: 1.5 + Math.random() * 2.6, life: 0, max: 0.6 + Math.random() * 0.4, color: FOOD_GOLD, splat: true,
      })
    }
  } else if (kind === 'weak') {
    for (let i = 0; i < 16; i++) {
      S.particles.push({
        x: x + (Math.random() - 0.5) * R, y: y + (Math.random() - 0.5) * R,
        vx: (Math.random() - 0.5) * R * 0.6, vy: R * (0.2 + Math.random() * 0.6), g: 0,
        r: 0.8 + Math.random() * 1.4, life: 0, max: 1 + Math.random() * 0.6, color: '#3A3024',
      })
    }
    S.rings.push({ x, y, r: R * 1.4, grow: -R * 0.7, life: 0, max: 0.6, color: CRITICAL_COLOR, width: 2, rays: 0 })
  }
}

function hatch(larva) {
  larva.state = 'larva'
  larva.hatchAnim = 0
  larva.hunger.value = 25 + Math.random() * (10 + 10 * S.D.d)
  S.stats.hungerGenerated += larva.hunger.value
  const cell = S.layout.slots[larva.index]
  if (cell) S.rings.push({ x: cell.x, y: cell.y, r: cell.size * 0.4, grow: cell.size * 0.9, life: 0, max: 0.6, color: P.caterpillarCream, width: 1.2, rays: 0 })
  if (S.meter.isActive) spawnNurse(larva, 0)
}

function makeWindow(larva) {
  const D = S.D
  const ratio = larva.hunger.value / 100
  const size = Math.max(0.22, (D.windowBase - D.windowRamp * S.ramp) * (1 - 0.18 * ratio))
  S.windowSize = size
  return createTimingWindow({ periodRange: D.periodRange, windowSize: size, jitter: D.windowJitter })
}

// ---------------------------------------------------------------------------
// Especial: Chamado das nutrizes
// ---------------------------------------------------------------------------

function spawnNurse(larva, delay) {
  const L = S.layout
  const c = L.slots[larva.index]
  if (!c) return
  const pf = L.pf
  // entra pela borda do campo mais próxima da célula
  const edges = [
    { d: c.x - pf.x, x: pf.x - 30, y: c.y + (Math.random() - 0.5) * 80 },
    { d: pf.x + pf.w - c.x, x: pf.x + pf.w + 30, y: c.y + (Math.random() - 0.5) * 80 },
    { d: c.y - pf.y, x: c.x + (Math.random() - 0.5) * 80, y: pf.y - 30 },
  ]
  edges.sort((a, b) => a.d - b.d)
  const e = edges[0]
  S.nurses.push({ larva, fromX: e.x, fromY: e.y, t: -delay, leave: -1, seed: 3 + Math.random() * 10, face: Math.sign(c.x - e.x) || 1 })
}

function activateSpecial() {
  if (S.phase !== 'play' || !S.meter.activate()) return
  let i = 0
  for (const larva of S.larvae) {
    if (larva.state !== 'larva') continue
    const delay = i++ * 0.07
    spawnNurse(larva, delay)
    larva.callDrop = { from: larva.hunger.value, to: larva.hunger.value * (1 - SPECIAL.drop), t: -delay - 0.45 }
    larva.strain = Math.min(larva.strain, 0)
  }
  S.stats.specials += 1
  S.callFlash = 1
  const L = S.layout
  addFloater(L.comb.cx, L.comb.cy - L.comb.ry * 0.9, 'chamado das nutrizes', P.sunHalo)
}

function nursePosition(n, t) {
  const c = S.layout.slots[n.larva.index]
  const R = c.size
  const hx = c.x + n.face * R * 0.15 + Math.sin(t * 1.7 + n.seed) * R * 0.12
  const hy = c.y - R * 0.55 + Math.sin(t * 3.1 + n.seed) * R * 0.08
  if (n.leave >= 0) {
    const k = ease(clamp(n.leave / 0.7, 0, 1), 'easeInCubic')
    return { x: lerp(hx, n.fromX, k), y: lerp(hy, n.fromY, k), a: 1 - k * 0.6, flying: true }
  }
  const k = clamp(n.t / 0.6, 0, 1)
  const e = ease(k, 'easeOutCubic')
  return { x: lerp(n.fromX, hx, e), y: lerp(n.fromY, hy, e) - Math.sin(k * Math.PI) * R * 0.8, a: Math.min(1, k * 2.5), flying: k < 1 }
}

let silhouetteCanvas = null
function drawNurseSilhouette(ctx, x, y, scale, face, t, seed, alpha, flying) {
  const size = Math.ceil(70 * scale)
  if (!silhouetteCanvas) silhouetteCanvas = document.createElement('canvas')
  const sc = silhouetteCanvas
  if (sc.width !== size * 2 || sc.height !== size * 2) { sc.width = size * 2; sc.height = size * 2 }
  const s = sc.getContext('2d')
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.globalCompositeOperation = 'source-over'
  s.clearRect(0, 0, sc.width, sc.height)
  s.setTransform(2, 0, 0, 2, 0, 0) // meia supersamplagem
  s.translate(size / 2, size / 2)
  s.scale(face, 1)
  const pose = flying
    ? createFlightPose(0, 0, t + seed, { scale, seed: 11 })
    : createRegurgitatePose(0, 0, t + seed, { scale, seed: 11, rotation: 0.15 })
  drawBeeBody(s, pose)
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.globalCompositeOperation = 'source-atop'
  ctx.save()
  // halo claro (legível sobre o cerume escuro) + silhueta de tinta por cima
  s.fillStyle = P.sunHalo
  s.fillRect(0, 0, sc.width, sc.height)
  ctx.globalAlpha = alpha * 0.8
  const grow = 1.14
  ctx.drawImage(sc, x - (size * grow) / 2, y - (size * grow) / 2, size * grow, size * grow)
  s.fillStyle = '#3A2A18'
  s.fillRect(0, 0, sc.width, sc.height)
  ctx.globalAlpha = alpha
  ctx.drawImage(sc, x - size / 2, y - size / 2, size, size)
  ctx.restore()
}

function drawSpecialLayer(ctx, L, t) {
  const m = S.meter
  // nutrizes (silhuetas) sobre as células
  for (const n of S.nurses) {
    if (n.t < 0) continue
    const p = nursePosition(n, t)
    drawNurseSilhouette(ctx, p.x, p.y, L.beeScale * 0.85, n.face, t, n.seed, 0.85 * p.a, p.flying)
  }
  if (!m.isActive) return
  // anel pontilhado de cuidado em cada célula atendida
  ctx.save()
  ctx.setLineDash([1.5, 3.5])
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(P.sunHalo, 0.6)
  for (const larva of S.larvae) {
    if (larva.state !== 'larva') continue
    const c = L.slots[larva.index]
    ctx.beginPath()
    ctx.arc(c.x, c.y, c.size * 1.18, 0, TAU)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // arco técnico fino em volta do disco marcando a duração restante
  const { comb } = L
  const rx = comb.rx * 1.1
  const ry = comb.ry * 1.07
  const frac = 1 - m.activeProgress
  const a0 = -Math.PI / 2
  ctx.strokeStyle = withAlpha(INK_LINE, 0.25)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(comb.cx, comb.cy, rx, ry, 0, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = withAlpha(P.sunGold, 0.95)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.ellipse(comb.cx, comb.cy, rx, ry, 0, a0, a0 + TAU * frac)
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.strokeStyle = withAlpha(INK_LINE, 0.55)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  const ticks = Math.round(SPECIAL.duration)
  for (let i = 0; i < ticks; i++) {
    const a = a0 + (TAU * i) / ticks
    const cx = comb.cx + Math.cos(a) * rx
    const cy = comb.cy + Math.sin(a) * ry
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    ctx.moveTo(cx - nx * 4, cy - ny * 4)
    ctx.lineTo(cx + nx * 5, cy + ny * 5)
  }
  ctx.stroke()
  // agulha na ponta
  const na = a0 + TAU * frac
  ctx.fillStyle = P.sunGold
  ctx.beginPath()
  ctx.arc(comb.cx + Math.cos(na) * rx, comb.cy + Math.sin(na) * ry, 3, 0, TAU)
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Ação / fim
// ---------------------------------------------------------------------------

function handleAction() {
  const dock = S.dock
  const bee = S.mover.position
  if (!dock) {
    S.beeJolt = 1
    return
  }
  const larva = dock.larva
  const cell = S.layout.slots[larva.index]
  if (larva.state !== 'larva') return
  if (!dock.tw) {
    // larva saciada: vira de lado, nada acontece
    larva.twitch = 0.6
    return
  }
  if (dock.lockTimer > 0 || dock.lockedWindow) return
  if (S.stock <= 0) {
    S.emptyFlash = 1
    S.shake = Math.max(S.shake, 3)
    addFloater(bee.x, bee.y - 30 * S.layout.beeScale, 'sem alimento — potes', P.caterpillarCream)
    dock.lockTimer = 0.35
    return
  }
  const tw = dock.tw
  const result = tw.judge()
  S.stock -= 1
  S.stats.portionsUsed += 1
  if (tw.isOpen) dock.lockedWindow = true
  else dock.lockTimer = 0.45

  const R = cell.size
  if (result === 'miss') {
    S.stats.miss += 1
    burst(cell.x, cell.y, 'miss', R)
    S.shake = Math.max(S.shake, 6)
    S.wasteFlash = 1
    larva.twitch = 1
    addFloater(cell.x, cell.y - R * 1.2, 'desperdício', '#E9D9B0')
    return
  }
  const amount = result === 'perfect' ? S.D.perfectRelief : S.D.goodRelief
  const before = larva.hunger.value
  larva.hunger.subtract(amount)
  larva.callDrop = null
  S.stats.hungerRelieved += before - larva.hunger.value
  larva.plump = result === 'perfect' ? 1 : 0.55
  larva.feedFlash = 1
  larva.strain = Math.max(0, larva.strain - (result === 'perfect' ? larva.strainLimit : larva.strainLimit * 0.5))
  if (result === 'perfect') {
    S.stats.perfect += 1
    S.meter.add(SPECIAL.perfectBonus)
    S.shake = Math.max(S.shake, 2.5)
    burst(cell.x, cell.y, 'perfect', R)
    addFloater(cell.x, cell.y - R * 1.25, 'perfeito', P.sunHalo)
  } else {
    S.stats.good += 1
    S.meter.add(SPECIAL.goodBonus)
    burst(cell.x, cell.y, 'good', R)
    addFloater(cell.x, cell.y - R * 1.2, 'bom', P.leafSageHighlight)
  }
}

function computeScore(st) {
  // Calibrado por simulação headless (bots de habilidade variada):
  // jogador mediano ≈ 60–75 em dificuldade 0.1 e ≈ 45–55 em 0.7.
  const feeds = st.perfect + st.good
  const attempts = feeds + st.miss
  // cuidado: fome média das larvas ao longo do turno (6 = impecável, 42+ = negligência)
  const avgHunger = st.larvaTime > 0 ? st.hungerTime / st.larvaTime : 50
  const care = clamp(1 - (avgHunger - 6) / 36, 0, 1)
  // precisão: alimentações perfeitas valem muito mais que as de borda
  const precision = attempts > 0 ? (st.perfect + st.good * 0.15) / attempts : 0
  // cobertura: fração da fome gerada que foi aliviada (0.5 → 0, 0.95 → 1)
  const coverage = st.hungerGenerated > 0 ? clamp((st.hungerRelieved / st.hungerGenerated - 0.5) / 0.45, 0, 1) : 0
  let score = 100 * (0.35 * care + 0.4 * precision + 0.25 * coverage)
  score -= Math.min(30, st.weakenEvents * 3 + st.lost * 8)
  return Math.round(clamp(score, 0, 100))
}

function finish(context) {
  if (S.finished) return
  S.finished = true
  const st = S.stats
  const feeds = st.perfect + st.good
  const score = computeScore(st)
  const weakened = S.larvae.filter((l) => l.everWeakened && l.state !== 'lost').length
  let summary = `${feeds} ${feeds === 1 ? 'alimentação' : 'alimentações'} (${st.perfect} ${st.perfect === 1 ? 'perfeita' : 'perfeitas'})`
  if (weakened === 0 && st.lost === 0) summary += ', nenhuma larva enfraquecida'
  else {
    if (weakened > 0) summary += `, ${weakened} ${weakened === 1 ? 'larva enfraquecida' : 'larvas enfraquecidas'}`
    if (st.lost > 0) summary += `, ${st.lost} ${st.lost === 1 ? 'larva perdida' : 'larvas perdidas'}`
  }
  context.finishShift({ score, summary })
}

// Posição de acoplamento junto a uma célula (lado de onde a abelha vem).
function dockAnchor(cell, fromX) {
  const side = Math.sign(cell.x - fromX) || 1
  return { x: cell.x - side * cell.size * 1.02, y: cell.y - cell.size * 0.12 }
}

// Célula de larva/ovo sob um toque (tolerância generosa para o dedo).
function larvaAt(x, y) {
  const L = S.layout
  let best = null
  let bd = Infinity
  for (const larva of S.larvae) {
    if (larva.state !== 'larva') continue
    const c = L.slots[larva.index]
    if (!c) continue
    const d = dist(x, y, c.x, c.y)
    if (d < c.size * 1.3 && d < bd) { bd = d; best = larva }
  }
  return best
}

// ---------------------------------------------------------------------------
// Estado exportado
// ---------------------------------------------------------------------------

export default {
  id: 'feedLarvae',

  enter(context, data = {}) {
    const D = buildDifficulty(data?.difficulty ?? 0.1)
    const larvae = []
    for (let i = 0; i < D.totalLarvae; i++) larvae.push(makeLarva(i, D, i < D.startLarvae))
    const hatchCount = D.totalLarvae - D.startLarvae
    for (let i = 0; i < hatchCount; i++) {
      larvae[D.startLarvae + i].hatchAt = 0.14 + (0.5 * (i + 0.5)) / hatchCount + (Math.random() - 0.5) * 0.05
    }
    const meter = createMeter({ chargeTime: SPECIAL.chargeTime, duration: SPECIAL.duration })
    S = {
      D,
      meter,
      shiftIndex: data?.shiftIndex ?? 0,
      layoutSeed: 900 + ((data?.shiftIndex ?? 0) * 131) + Math.floor(Math.random() * 7),
      layout: null,
      staticLayer: null,
      staticDpr: 0,
      mover: null,
      larvae,
      time: 0,
      playTime: 0,
      remaining: D.duration,
      progress: 0,
      ramp: 0,
      phase: 'play',
      endTimer: 0,
      finished: false,
      stock: D.maxStock,
      refuelT: 0,
      refuelling: false,
      vel: { x: 0, y: 0 },
      inputMag: 0,
      facing: 1,
      dock: null,
      auto: null, // { kind: 'larva', larva } | { kind: 'pots' } — piloto do toque numa célula
      beeJolt: 0,
      emptyFlash: 0,
      wasteFlash: 0,
      stockFlash: 0,
      callFlash: 0,
      shake: 0,
      windowSize: D.windowBase,
      nurses: [],
      particles: [],
      rings: [],
      floaters: [],
      stats: {
        perfect: 0, good: 0, miss: 0, portionsUsed: 0, specials: 0,
        hungerGenerated: 0, hungerRelieved: 0,
        weakenEvents: 0, lost: 0, larvaTime: 0, criticalTime: 0, hungerTime: 0,
      },
    }
    for (const l of larvae) if (l.state === 'larva') S.stats.hungerGenerated += l.hunger.value
    context.controls?.configure({ showDirections: false, showAction: true, showSpecial: true, meter, actionLabel: 'ALIMENTAR', specialLabel: 'NUTRIZES' })
    ensureLayout(context)
  },

  update(context, rawDt) {
    if (!S) return
    const dt = Math.min(rawDt || 0, 0.05)
    ensureLayout(context)
    const L = S.layout
    const controls = context.controls
    S.time += dt

    // efeitos
    S.shake = Math.max(0, S.shake - dt * 30)
    S.beeJolt = Math.max(0, S.beeJolt - dt * 4)
    S.emptyFlash = Math.max(0, S.emptyFlash - dt * 2)
    S.wasteFlash = Math.max(0, S.wasteFlash - dt * 2.5)
    S.stockFlash = Math.max(0, S.stockFlash - dt * 4)
    S.callFlash = Math.max(0, S.callFlash - dt * 1.5)
    for (const p of S.particles) {
      p.life += dt
      p.vy += (p.g || 0) * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 1 - damp(3, dt)
      if (p.target) {
        const k = ease(clamp(p.life / p.max, 0, 1), 'easeInOutQuad')
        p.x = lerp(p.sx, S.mover.position.x, k)
        p.y = lerp(p.sy, S.mover.position.y, k) - Math.sin(k * Math.PI) * 40 * L.u
      }
    }
    S.particles = S.particles.filter((p) => p.life < p.max)
    for (const r of S.rings) r.life += dt
    S.rings = S.rings.filter((r) => r.life < r.max)
    for (const f of S.floaters) f.life += dt
    S.floaters = S.floaters.filter((f) => f.life < f.max)

    // especial (medidor + nutrizes)
    S.meter.update(dt)
    if (S.meter.justEnded) for (const n of S.nurses) if (n.leave < 0) n.leave = 0
    for (const n of S.nurses) {
      n.t += dt
      if (n.leave >= 0) n.leave += dt
      if (n.larva.state === 'lost' && n.leave < 0) n.leave = 0
    }
    S.nurses = S.nurses.filter((n) => n.leave < 0.7)

    if (S.phase === 'ending') {
      S.endTimer += dt
      if (S.endTimer > 1.7) finish(context)
      return
    }

    S.remaining -= dt
    S.playTime += dt
    S.progress = clamp(1 - S.remaining / S.D.duration, 0, 1)
    S.ramp = inShiftRamp(S.playTime, S.D.duration)
    const warmup = S.time < 1.1

    if (controls?.specialPressed) activateSpecial()

    // --- toque/clique no campo ------------------------------------------
    let clickFeed = false
    const tap = controls?.pointerTap
    if (tap) {
      const hit = larvaAt(tap.x, tap.y)
      if (hit && S.dock && S.dock.larva === hit) {
        // no PC, clicar na célula em que a abelha já está alimenta
        if (tap.pointerType === 'mouse') clickFeed = true
      } else if (hit) {
        S.auto = { kind: 'larva', larva: hit }
      } else if (dist(tap.x, tap.y, L.pot.x, L.pot.y) < L.pot.zoneR * 1.1) {
        S.auto = { kind: 'pots' }
      }
    }

    // --- movimento -------------------------------------------------------
    const pos = S.mover.position
    const move = controls?.move
    let ix = 0
    let iy = 0
    let pointerHold = false
    if (move && move.vx != null) {
      ix = move.vx
      iy = move.vy
      S.auto = null
    } else if (move) {
      pointerHold = true
      if (!tap) S.auto = null
      const tx = move.targetX
      const ty = move.targetY
      const dockCell = S.dock ? L.slots[S.dock.larva.index] : null
      const onDock = dockCell && dist(tx, ty, dockCell.x, dockCell.y) < dockCell.size * 1.3
      const inPots = dist(tx, ty, L.pot.x, L.pot.y) < L.pot.zoneR * 0.8 && dist(pos.x, pos.y, L.pot.x, L.pot.y) < L.pot.zoneR * 0.9
      if (!onDock && !inPots) {
        const dx = tx - pos.x
        const dy = ty - pos.y
        const d = Math.hypot(dx, dy)
        if (d > 5) {
          const m = Math.min(1, d / 40)
          ix = (dx / d) * m
          iy = (dy / d) * m
        }
      }
    }
    if (S.auto && !move) {
      let tx
      let ty
      let arrive
      if (S.auto.kind === 'larva') {
        const larva = S.auto.larva
        const c = L.slots[larva.index]
        if (larva.state !== 'larva' || !c) S.auto = null
        else {
          const a = dockAnchor(c, pos.x)
          tx = a.x
          ty = a.y
          arrive = S.dock && S.dock.larva === larva && dist(pos.x, pos.y, a.x, a.y) < c.size * 0.7
        }
      } else {
        tx = L.pot.x
        ty = L.pot.y - L.pot.zoneR * 0.35
        arrive = dist(pos.x, pos.y, tx, ty) < L.pot.zoneR * 0.45
      }
      if (S.auto) {
        if (arrive) S.auto = null
        else {
          const dx = tx - pos.x
          const dy = ty - pos.y
          const d = Math.hypot(dx, dy) || 1
          const m = Math.min(1, d / 30)
          ix = (dx / d) * m
          iy = (dy / d) * m
        }
      }
    }
    const im = Math.hypot(ix, iy)
    if (im > 1) { ix /= im; iy /= im }
    const k = damp(9, dt)
    S.vel.x += (ix - S.vel.x) * k
    S.vel.y += (iy - S.vel.y) * k
    S.inputMag = Math.hypot(S.vel.x, S.vel.y)
    S.mover.update(dt, S.vel)
    if (Math.abs(S.vel.x) > 0.15 && !(S.dock && S.inputMag < 0.3)) S.facing = Math.sign(S.vel.x)

    // --- acoplar a uma célula -------------------------------------------
    const bee = S.mover.position
    let nearest = null
    let nd = Infinity
    for (const larva of S.larvae) {
      if (larva.state !== 'larva') continue
      const c = L.slots[larva.index]
      if (!c) continue
      const d = dist(bee.x, bee.y, c.x, c.y)
      const limit = S.dock && S.dock.larva === larva ? c.size * 1.75 : c.size * 1.45
      if (d < limit && d < nd) { nd = d; nearest = larva }
    }
    // no piloto automático, não acopla em células do caminho
    if (S.auto && S.auto.kind === 'larva' && nearest && nearest !== S.auto.larva) nearest = null
    if (S.auto && S.auto.kind === 'pots') nearest = null
    if (nearest && (!S.dock || S.dock.larva !== nearest)) {
      const c = L.slots[nearest.index]
      S.dock = { larva: nearest, tw: null, lockTimer: 0, lockedWindow: false, wasOpen: false, facing: Math.sign(c.x - bee.x) || S.facing }
      S.facing = S.dock.facing
    } else if (!nearest) {
      S.dock = null
    }

    if (S.dock) {
      const dock = S.dock
      const c = L.slots[dock.larva.index]
      if (S.inputMag < 0.3) {
        S.facing = dock.facing
        const ax = c.x - dock.facing * c.size * 1.02
        const ay = c.y - c.size * 0.12
        const kk = damp(9, dt)
        S.mover.setPosition(bee.x + (ax - bee.x) * kk, bee.y + (ay - bee.y) * kk)
      }
      dock.lockTimer = Math.max(0, dock.lockTimer - dt)
      if (dock.larva.hunger.value > 18) {
        if (!dock.tw) dock.tw = makeWindow(dock.larva)
        dock.tw.update(dt)
        if (dock.wasOpen && !dock.tw.isOpen) dock.lockedWindow = false
        dock.wasOpen = dock.tw.isOpen
      } else {
        dock.tw = null
        dock.lockedWindow = false
      }
    }

    // --- reabastecer ------------------------------------------------------
    const inZone = dist(bee.x, bee.y, L.pot.x, L.pot.y) < L.pot.zoneR
    S.refuelling = false
    if (inZone && S.inputMag < 0.22 && S.stock < S.D.maxStock) {
      S.refuelling = true
      S.refuelT += dt
      if (pointerHold || S.inputMag < 0.05) {
        const kk = damp(2.5, dt)
        S.mover.setPosition(bee.x + (L.pot.x - bee.x) * kk * 0.5, bee.y + (L.pot.y - L.pot.zoneR * 0.35 - bee.y) * kk * 0.5)
      }
      const settle = 0.3
      const per = S.D.refuelPer
      if (S.refuelT >= settle + per) {
        S.refuelT -= per
        S.stock += 1
        S.stockFlash = 1
        S.particles.push({
          x: L.pot.x, y: L.pot.y - 20 * L.u, sx: L.pot.x + (Math.random() - 0.5) * 30 * L.u, sy: L.pot.y - 25 * L.u,
          vx: 0, vy: 0, g: 0, r: 3, life: 0, max: 0.35, color: P.sunGold, target: true,
        })
      }
    } else {
      S.refuelT = 0
    }

    // --- larvas -----------------------------------------------------------
    const frozen = S.meter.isActive
    const rampMul = 1 + S.D.rampInShift * S.ramp
    for (const larva of S.larvae) {
      larva.plump = Math.max(0, larva.plump - dt * 1.4)
      larva.twitch = Math.max(0, larva.twitch - dt * 3)
      larva.weakFlash = Math.max(0, larva.weakFlash - dt * 1.2)
      larva.feedFlash = Math.max(0, larva.feedFlash - dt * 2.5)
      if (larva.state === 'egg') {
        larva.hatchSoon = clamp(1 - (larva.hatchAt - S.progress) / 0.04, 0, 1)
        if (S.progress >= larva.hatchAt) hatch(larva)
        continue
      }
      if (larva.state === 'lost') continue
      larva.hatchAnim = Math.min(1, larva.hatchAnim + dt * 1.8)
      // queda animada do chamado das nutrizes (conta como fome aliviada)
      if (larva.callDrop) {
        const cd = larva.callDrop
        cd.t += dt
        if (cd.t >= 0) {
          const target = lerp(cd.from, cd.to, ease(clamp(cd.t / 0.9, 0, 1), 'easeInOutQuad'))
          if (target < larva.hunger.value) {
            S.stats.hungerRelieved += larva.hunger.value - target
            larva.hunger.value = target
          }
          if (cd.t >= 0.9) larva.callDrop = null
        }
      }
      const rate = warmup || frozen ? 0 : larva.baseRate * rampMul * (larva.vitality < 3 ? 1.08 : 1)
      larva.hunger.setRate(rate)
      const before = larva.hunger.value
      larva.hunger.update(dt)
      S.stats.hungerGenerated += larva.hunger.value - before
      S.stats.larvaTime += dt
      S.stats.hungerTime += larva.hunger.value * dt
      const state = larva.hunger.state
      if (!frozen && state !== 'calm' && Math.random() < dt * (larva.hunger.value / 100) * 1.6) larva.twitch = 0.5 + Math.random() * 0.5
      if (state === 'critical' && !frozen) {
        S.stats.criticalTime += dt
        larva.strain += dt
        if (larva.strain >= larva.strainLimit) {
          larva.strain = -2.5 // fôlego curto antes de poder enfraquecer de novo
          larva.vitality -= 1
          larva.everWeakened = true
          larva.weakFlash = 1
          S.stats.weakenEvents += 1
          const c = L.slots[larva.index]
          S.shake = Math.max(S.shake, 7)
          if (c) {
            burst(c.x, c.y, 'weak', c.size)
            addFloater(c.x, c.y - c.size * 1.3, larva.vitality <= 0 ? 'larva perdida' : 'enfraqueceu', '#E9D9B0')
          }
          if (larva.vitality <= 0) {
            larva.state = 'lost'
            S.stats.lost += 1
            if (S.dock && S.dock.larva === larva) S.dock = null
            if (S.auto && S.auto.larva === larva) S.auto = null
          }
        }
      } else {
        larva.strain = Math.max(Math.min(larva.strain, 0), larva.strain - dt * (frozen ? 2 : 0.6))
      }
    }

    // --- ação ----------------------------------------------------------------
    if (controls?.actionPressed || clickFeed) handleAction()

    if (S.remaining <= 0) {
      S.remaining = 0
      S.phase = 'ending'
      S.endTimer = 0
      S.dock = null
      S.auto = null
    }
  },

  render(context, ctx) {
    if (!S) return
    ensureLayout(context)
    const L = S.layout
    const { w, h } = L
    const t = S.time
    const reveal = ease(clamp(t / 1.2, 0, 1), 'easeInOutCubic')

    ctx.save()
    if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake)
    ctx.drawImage(S.staticLayer, 0, 0, w, h)

    // zona dos potes: guia pontilhada girando devagar + progresso de reabastecimento
    const pot = L.pot
    const needFood = S.stock === 0 && S.phase === 'play'
    ctx.save()
    ctx.strokeStyle = withAlpha(needFood ? '#8F6E20' : INK_LINE, (needFood ? 0.55 + 0.35 * Math.sin(t * 5) : 0.35) * reveal)
    ctx.lineWidth = needFood ? 1.6 : 1
    ctx.setLineDash([2, 6])
    ctx.lineDashOffset = -t * 6
    ctx.beginPath()
    ctx.arc(pot.x, pot.y, pot.zoneR, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
    if (S.refuelling) {
      const f = clamp(S.refuelT / (0.3 + S.D.refuelPer), 0, 1)
      ctx.strokeStyle = withAlpha('#8F6E20', 0.9)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(pot.x, pot.y, pot.zoneR + 5, -Math.PI / 2, -Math.PI / 2 + TAU * (S.stock / S.D.maxStock) + (TAU / S.D.maxStock) * f)
      ctx.stroke()
      ctx.strokeStyle = withAlpha(INK_LINE, 0.6)
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < S.D.maxStock; i++) {
        const a = -Math.PI / 2 + (TAU * i) / S.D.maxStock
        ctx.moveTo(pot.x + Math.cos(a) * (pot.zoneR + 1), pot.y + Math.sin(a) * (pot.zoneR + 1))
        ctx.lineTo(pot.x + Math.cos(a) * (pot.zoneR + 10), pot.y + Math.sin(a) * (pot.zoneR + 10))
      }
      ctx.stroke()
    }
    ctx.restore()

    // destino do piloto automático (toque numa célula/potes)
    if (S.auto) {
      let ax
      let ay
      let ar
      if (S.auto.kind === 'larva') {
        const c = L.slots[S.auto.larva.index]
        ax = c.x; ay = c.y; ar = c.size * 1.22
      } else {
        ax = pot.x; ay = pot.y; ar = pot.zoneR * 0.6
      }
      ctx.save()
      ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.7)
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.lineDashOffset = t * 12
      ctx.beginPath()
      ctx.arc(ax, ay, ar, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }

    // larvas, ovos e mostradores
    const dock = S.dock
    const frozen = S.meter.isActive
    for (const larva of S.larvae) {
      const cell = L.slots[larva.index]
      if (!cell) continue
      if (larva.state === 'egg') {
        drawEgg(ctx, cell, larva, t)
      } else {
        let opening = 0
        if (dock && dock.larva === larva && dock.tw) {
          const ttc = dock.tw.timeToCenter
          const half = S.windowSize / 2
          opening = clamp(1 - Math.abs(ttc) / (half + 0.35), 0, 1)
          opening = ease(opening, 'easeInOutQuad')
        }
        if (larva.hatchAnim < 1 && larva.state === 'larva') {
          ctx.save()
          ctx.globalAlpha = 1 - larva.hatchAnim
          drawEgg(ctx, cell, larva, t)
          ctx.restore()
        }
        drawLarva(ctx, cell, larva, frozen ? t * 0.35 : t, opening)
      }
      drawHungerDial(ctx, cell, larva, t, reveal)
    }

    // anel de aproximação da janela de alimentação
    if (dock && dock.tw && S.phase === 'play') {
      const c = L.slots[dock.larva.index]
      const R = c.size
      const tw = dock.tw
      const ttc = tw.timeToCenter
      const target = R * 0.62
      const lead = 0.62 + S.windowSize / 2
      const hasFood = S.stock > 0
      const locked = dock.lockedWindow || dock.lockTimer > 0
      ctx.save()
      const glow = tw.isOpen ? 1 - clamp(Math.abs(ttc) / (S.windowSize / 2 + 0.001), 0, 1) : 0
      ctx.lineWidth = 1.4 + glow * 2.4
      if (hasFood && !locked) {
        ctx.strokeStyle = tw.isOpen ? withAlpha(P.sunHalo, 0.7 + glow * 0.3) : withAlpha(P.caterpillarCream, 0.75)
      } else {
        ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.35)
        ctx.setLineDash([2, 3])
      }
      ctx.beginPath()
      ctx.arc(c.x, c.y, target, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      if (ttc < lead && ttc > -S.windowSize) {
        const kR = (R * 1.35) / lead
        const rr = Math.max(2, target + ttc * kR)
        const a = clamp(1 - ttc / lead, 0, 1) * (locked ? 0.3 : 1)
        ctx.strokeStyle = withAlpha(P.sunGold, 0.95 * a)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(c.x, c.y, rr, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = withAlpha(P.caterpillarCream, 0.85 * a)
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < 12; i++) {
          const ang = i * (TAU / 12) + t * 0.6
          ctx.moveTo(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr)
          ctx.lineTo(c.x + Math.cos(ang) * (rr + 4), c.y + Math.sin(ang) * (rr + 4))
        }
        ctx.stroke()
      }
      ctx.restore()
    }

    // abelha
    const bee = S.mover.position
    const bs = L.beeScale
    const docked = dock && S.inputMag < 0.3
    const still = S.refuelling
    const bob = docked || still ? Math.sin(t * 3) * 0.8 : Math.sin(t * 5.5) * 2.2
    const jolt = S.beeJolt * Math.sin(t * 40) * 3
    ctx.save()
    ctx.fillStyle = withAlpha('#1A1208', 0.14)
    ctx.beginPath()
    ctx.ellipse(bee.x, bee.y + 22 * bs, 14 * bs, 4 * bs, 0, 0, TAU)
    ctx.fill()
    ctx.restore()
    let pose
    if (docked) pose = createRegurgitatePose(0, 0, t, { scale: bs, seed: 7, rotation: 0.1 })
    else if (still) pose = { ...createIdlePose(0, 0, { t, scale: bs, seed: 7 }), wingAngle: 0.35 * Math.sin(t * 22), grounded: false }
    else pose = createFlightPose(0, 0, t, { scale: bs, seed: 7, rotation: clamp(S.vel.y * 0.35, -0.4, 0.4) })
    ctx.save()
    ctx.translate(bee.x + jolt, bee.y + bob)
    ctx.scale(S.facing, 1)
    drawBeeBody(ctx, pose)
    ctx.restore()

    // estoque junto à abelha: pequeno arco de pontos
    {
      const n = S.D.maxStock
      const rr = 24 * bs
      ctx.save()
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.3
        const px = bee.x + Math.cos(a) * rr
        const py = bee.y + bob + Math.sin(a) * rr - 4 * bs
        const filled = i < S.stock
        ctx.beginPath()
        ctx.arc(px, py, filled ? 2.6 : 1.9, 0, TAU)
        if (filled) {
          ctx.fillStyle = withAlpha(mix(P.sunGold, '#FFFFFF', S.stockFlash * 0.5), 0.95)
          ctx.fill()
          ctx.strokeStyle = withAlpha(INK_LINE, 0.7)
          ctx.lineWidth = 0.7
          ctx.stroke()
        } else {
          ctx.strokeStyle = withAlpha(S.emptyFlash > 0 ? CRITICAL_COLOR : INK_LINE, 0.4 + S.emptyFlash * 0.6)
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // especial: nutrizes + arco de duração
    drawSpecialLayer(ctx, L, t)

    // partículas e anéis
    for (const p of S.particles) {
      const a = 1 - p.life / p.max
      ctx.fillStyle = withAlpha(p.color, clamp(a, 0, 1) * 0.9)
      ctx.beginPath()
      if (p.splat) ctx.ellipse(p.x, p.y, p.r * 1.3, p.r, Math.atan2(p.vy, p.vx), 0, TAU)
      else ctx.arc(p.x, p.y, p.r, 0, TAU)
      ctx.fill()
    }
    for (const r of S.rings) {
      const f = r.life / r.max
      const e = ease(f, 'easeOutCubic')
      const rad = Math.max(1, r.r + r.grow * e)
      ctx.save()
      ctx.strokeStyle = withAlpha(r.color, (1 - f) * 0.9)
      ctx.lineWidth = r.width * (1 - f * 0.5)
      ctx.beginPath()
      ctx.arc(r.x, r.y, rad, 0, TAU)
      ctx.stroke()
      if (r.rays) {
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < r.rays; i++) {
          const ang = (i / r.rays) * TAU + 0.2
          const r0 = rad * 1.05
          const r1 = rad * (1.2 + (i % 2) * 0.15)
          ctx.moveTo(r.x + Math.cos(ang) * r0, r.y + Math.sin(ang) * r0)
          ctx.lineTo(r.x + Math.cos(ang) * r1, r.y + Math.sin(ang) * r1)
        }
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.save()
    ctx.textAlign = 'center'
    ctx.font = `italic 600 ${Math.round(16 * L.fs)}px Georgia, serif`
    ctx.lineJoin = 'round'
    for (const f of S.floaters) {
      const k = f.life / f.max
      const y = f.y - ease(k, 'easeOutCubic') * 22 * L.fs
      // mantém o texto dentro do campo
      const half = ctx.measureText(f.text).width / 2 + 6
      const x = clamp(f.x, L.pf.x + half, L.pf.x + L.pf.w - half)
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4)
      ctx.lineWidth = 3.5
      ctx.strokeStyle = withAlpha('#2B2418', 0.8)
      ctx.strokeText(f.text, x, y)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, x, y)
    }
    ctx.restore()

    // flash de desperdício na borda / luz quente do chamado
    if (S.wasteFlash > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.75)
      g.addColorStop(0, withAlpha('#5A3A1A', 0))
      g.addColorStop(1, withAlpha('#5A3A1A', 0.25 * S.wasteFlash))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    if (S.callFlash > 0) {
      const { comb } = L
      const g = ctx.createRadialGradient(comb.cx, comb.cy, 10, comb.cx, comb.cy, Math.max(comb.rx, comb.ry) * 1.3)
      g.addColorStop(0, withAlpha(P.sunHalo, 0.28 * S.callFlash))
      g.addColorStop(1, withAlpha(P.sunHalo, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()

    drawHUD(ctx, L, reveal)

    if (S.phase === 'ending') {
      const f = clamp(S.endTimer / 0.8, 0, 1)
      ctx.save()
      ctx.fillStyle = withAlpha(P.paperCreamLight, 0.6 * f)
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = f
      ctx.strokeStyle = INK_LINE
      ctx.lineWidth = 1
      const cx = L.pf.x + L.pf.w / 2
      const cy = L.pf.y + L.pf.h / 2
      const half = Math.min(L.pf.w * 0.35, 220) * ease(f, 'easeInOutCubic')
      ctx.beginPath()
      ctx.moveTo(cx - half, cy + 14)
      ctx.lineTo(cx + half, cy + 14)
      for (let i = -4; i <= 4; i++) {
        const x = cx + (half * i) / 4
        ctx.moveTo(x, cy + 14)
        ctx.lineTo(x, cy + (i % 2 === 0 ? 22 : 18))
      }
      ctx.stroke()
      ctx.fillStyle = INK_LINE
      ctx.textAlign = 'center'
      ctx.font = `italic ${Math.round(24 * L.fs)}px Georgia, serif`
      ctx.fillText('turno encerrado', cx, cy)
      ctx.restore()
    }

    context.controls?.render(ctx, context.layout)
  },

  exit() {
    S = null
  },
}

// ---------------------------------------------------------------------------
// HUD técnico (na hudBar): mostrador do turno + estoque de alimento larval
// ---------------------------------------------------------------------------

function drawHUD(ctx, L, reveal) {
  const hud = L.lay.hudBar
  const k = clamp(hud.h / 50, 0.9, 1.4)
  const r = Math.min(hud.h * 0.38, 26)
  const cx = hud.x + 10 + r + 4
  const cy = hud.y + hud.h / 2
  const frac = S.remaining / S.D.duration
  const urgent = S.remaining < 10 && S.phase === 'play'

  ctx.save()
  // faixa de papel translúcido para leitura
  ctx.fillStyle = withAlpha(P.paperCreamLight, 0.72)
  ctx.fillRect(hud.x, hud.y, hud.w, hud.h)
  ctx.strokeStyle = withAlpha(INK_LINE, 0.35)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(hud.x, hud.y + hud.h - 0.5)
  ctx.lineTo(hud.x + hud.w * reveal, hud.y + hud.h - 0.5)
  ctx.stroke()

  ctx.strokeStyle = withAlpha(INK_LINE, 0.55)
  ctx.beginPath()
  const ticks = 60
  for (let i = 0; i < ticks * reveal; i++) {
    const a = -Math.PI / 2 + (i / ticks) * TAU
    const len = i % 5 === 0 ? 5 * k : 2.5 * k
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    ctx.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len))
  }
  ctx.stroke()

  // arco do tempo restante
  ctx.strokeStyle = urgent ? mix(INK_LINE, CRITICAL_COLOR, 0.5 + 0.5 * Math.sin(S.time * 8)) : '#8F6E20'
  ctx.lineWidth = 2.4 * k
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r - 8 * k, -Math.PI / 2, -Math.PI / 2 + TAU * frac * reveal)
  ctx.stroke()
  const na = -Math.PI / 2 + TAU * frac
  ctx.strokeStyle = INK_LINE
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(na) * (r - 3 * k), cy + Math.sin(na) * (r - 3 * k))
  ctx.stroke()
  ctx.fillStyle = INK_LINE
  ctx.beginPath()
  ctx.arc(cx, cy, 2 * k, 0, TAU)
  ctx.fill()

  const secs = Math.ceil(S.remaining)
  ctx.font = `600 ${Math.round(15 * k)}px Georgia, serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const tx = cx + r + 10 * k
  ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, tx, cy)

  // estoque: pastilhas de alimento larval sobre uma régua fina
  const n = S.D.maxStock
  const gap = 16 * k
  const sx = tx + 52 * k
  const sy = cy - 3 * k
  ctx.font = `italic ${Math.round(10 * k)}px Georgia, serif`
  ctx.fillStyle = withAlpha(INK_LINE, 0.7)
  ctx.fillText('alimento', sx - 4 * k, cy + 14 * k)
  ctx.strokeStyle = withAlpha(INK_LINE, 0.55)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(sx - 4 * k, sy + 10 * k)
  ctx.lineTo(sx + gap * (n - 1) + 12 * k, sy + 10 * k)
  ctx.stroke()
  for (let i = 0; i < n; i++) {
    const x = sx + i * gap + 4 * k
    const filled = i < S.stock
    const pop = filled && i === S.stock - 1 ? S.stockFlash * 0.35 : 0
    ctx.beginPath()
    ctx.ellipse(x, sy, 5 * k * (1 + pop), 6.5 * k * (1 + pop), 0.2, 0, TAU)
    if (filled) {
      const g = ctx.createRadialGradient(x - 2 * k, sy - 2 * k, 0.5, x, sy, 7 * k)
      g.addColorStop(0, P.sunHalo)
      g.addColorStop(1, '#B8861F')
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = INK_LINE
      ctx.lineWidth = 1
      ctx.stroke()
    } else {
      ctx.setLineDash([1.5, 2])
      ctx.strokeStyle = withAlpha(S.emptyFlash > 0 ? CRITICAL_COLOR : INK_LINE, 0.45 + S.emptyFlash * 0.5)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}
