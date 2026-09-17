// Abertura procedural de 26 segundos, em estilo de caderno naturalista.
import { drawCell } from '../art/hive.js'
import { drawBeeBody, createIdlePose, createFlightPose, createCarryingPose, createRegurgitatePose } from '../art/bee.js'
import { drawAnt, createAntPose } from '../art/creatures.js'
import { strokeHandDrawn, drawHatching } from '../art/textureUtils.js'
import { UI, font, drawDottedCircle, drawScaleArc, drawGuideLine } from '../ui/IndicatorBar.js'
import { createPaperBackdrop, createLayerCache, screenLayout, safeRect, anyKeyPressed, drawButton, pointInRect, fadeScreen, wrapText } from '../ui/HUD.js'

export const INTRO_DURATION = 26
const SKIP_KEYS = ['Enter', 'Space', 'Escape', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const scenes = [
  { at: 0, end: 7, title: 'Uma vida começa', caption: 'Ovo, larva, pupa. Uma nova operária emerge.' },
  { at: 7, end: 10.5, title: 'Cuidar da casa', caption: 'As jovens operárias mantêm o ninho limpo.' },
  { at: 10.5, end: 14, title: 'Nutrir a próxima geração', caption: 'O alimento abastece as células de cria.' },
  { at: 14, end: 17.5, title: 'Sustentar a rainha', caption: 'De boca em boca, a colônia compartilha alimento.' },
  { at: 17.5, end: 21, title: 'Guardar a entrada', caption: 'Cada guardiã protege a vida dentro do ninho.' },
  { at: 21, end: 24, title: 'O ciclo continua', caption: 'A rainha deposita um ovo na célula abastecida.' },
  { at: 24, end: 26, title: 'Vida de Abelha', caption: 'Mandaçaia · Melipona quadrifasciata' },
]
const backdrop = createPaperBackdrop({ seed: 7 })
const clamp = v => Math.max(0, Math.min(1, v))
const smooth = v => { const p = clamp(v); return p * p * (3 - 2 * p) }
let t = 0
let done = false
function soundButton(context) {
  const S = safeRect(screenLayout(context))
  return { x: S.x + S.w / 2 - 145, y: S.y + S.h - 41, w: 140, h: 33 }
}
const cells = Object.fromEntries(['egg', 'larva', 'capped', 'empty', 'honey'].map(state => [state,
  createLayerCache((ctx, w, h) => drawCell(ctx, { x: w / 2, y: h / 2, size: w / 2.5, seed: 17 }, state)),
]))
function cell(ctx, x, y, size, state = 'empty') {
  cells[state].draw(ctx, x - size * 1.25, y - size * 1.25, size * 2.5, size * 2.5)
}
function bee(ctx, x, y, time, options = {}) {
  drawBeeBody(ctx, createIdlePose(x, y, { t: time, scale: 2.3, seed: 4, ...options }))
}
function drop(ctx, x, y, size = 5, color = UI.gold) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, size * 0.65, size, 0.2, 0, Math.PI * 2)
  ctx.fill()
}
function queen(ctx, x, y, time) {
  ctx.save()
  ctx.translate(x, y)
  // Abdomen enlarged and segmented, preserving the naturalist bee rig.
  const pulse = 1 + Math.sin(time * 2) * 0.018
  ctx.save()
  ctx.scale(pulse, pulse)
  ctx.beginPath()
  ctx.ellipse(-40, 0, 65, 32, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#B89961'
  ctx.fill()
  ctx.strokeStyle = UI.ink
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.clip()
  drawHatching(ctx, { x: -110, y: -34, width: 142, height: 68 }, { seed: 23, lineCount: 36, angle: 0.3, opacityRange: [0.12, 0.25], color: UI.ink })
  for (let k = 0; k < 6; k++) {
    ctx.beginPath()
    ctx.ellipse(-83 + k * 22, 0, 10, 35, 0, -Math.PI / 2, Math.PI / 2)
    ctx.strokeStyle = '#715731'
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.rect(-12, -75, 105, 150)
  ctx.clip()
  bee(ctx, 3, 0, time, { scale: 3, colorVariant: 'old' })
  ctx.restore()
  ctx.restore()
}
function development(ctx, time) {
  const stage = time < 1.5 ? 'egg' : time < 3 ? 'larva' : time < 4.7 ? 'capped' : 'empty'
  cell(ctx, 0, 8, 76, stage)
  if (time >= 3 && time < 4.7) {
    // Pale pupa visible through an illustrated cutaway in the wax cap.
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(0, 8, 51, 61, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#E5D8B8'
    ctx.fill()
    ctx.clip()
    bee(ctx, 0, 6, 0, { scale: 2.5, rotation: -Math.PI / 2, colorVariant: 'young' })
    ctx.fillStyle = 'rgba(244,238,221,0.6)'
    ctx.fillRect(-60, -60, 120, 140)
    ctx.restore()
  }
  if (time >= 4.7) {
    const p = smooth((time - 4.7) / 1.7)
    drawBeeBody(ctx, createFlightPose(0, 8 - p * 82, time, { scale: 2.6, rotation: -Math.PI / 2, colorVariant: 'young' }))
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4
      drop(ctx, Math.cos(a) * (40 + p * 50), 8 + Math.sin(a) * (40 + p * 50), 3 * (1 - p), '#A48342')
    }
  }
  const active = time < 1.5 ? 0 : time < 3 ? 1 : time < 4.7 ? 2 : 3
  ctx.font = font(16)
  ctx.textAlign = 'center'
  ;['ovo', 'larva', 'pupa', 'operária'].forEach((label, i) => {
    ctx.fillStyle = i === active ? UI.ink : '#81745B'
    ctx.fillText(label, -165 + i * 110, 141)
    if (i === active) drop(ctx, -165 + i * 110, 117, 3, UI.pink)
  })
}
function cleaning(ctx, time) {
  cell(ctx, -135, 48, 37)
  cell(ctx, -115, -46, 37, 'capped')
  const p = smooth(time / 2.8)
  const x = -92 + p * 255
  drawBeeBody(ctx, createCarryingPose(x, -8 - Math.sin(p * Math.PI) * 33, time, { scale: 2.5, cargo: 'wax' }))
  drop(ctx, x + 37, 12 - Math.sin(p * Math.PI) * 33, 9, '#6E5219')
  strokeHandDrawn(ctx, [{ x: 208, y: -80 }, { x: 187, y: -44 }, { x: 186, y: 42 }, { x: 211, y: 80 }], { baseWidth: 6, seed: 4, color: '#8C7447' })
  drawGuideLine(ctx, -30, 80, 170, 80, { progress: p, alpha: 0.4 })
}
function nursing(ctx, time) {
  ;[-120, 0, 120].forEach((x, i) => cell(ctx, x, 63, 38, time > 1 + i * 0.8 ? 'honey' : 'empty'))
  const x = -120 + 240 * smooth(time / 3.1)
  drawBeeBody(ctx, createRegurgitatePose(x, -24, time, { scale: 2.5, rotation: Math.PI / 2, colorVariant: 'young' }))
  drop(ctx, x, 20 + (time * 45 % 30), 5)
}
function feedingQueen(ctx, time) {
  queen(ctx, -67, 12, time)
  drawBeeBody(ctx, createRegurgitatePose(80, 12, time, { scale: 2.3, rotation: Math.PI }))
  drawBeeBody(ctx, createCarryingPose(180, -55 + Math.sin(time) * 5, time, { scale: 1.8, rotation: Math.PI, cargo: 'nectar' }))
  drop(ctx, 39 + Math.sin(time * 4) * 5, 12, 5)
  cell(ctx, 180, 72, 28, 'honey')
}
function guarding(ctx, time) {
  ctx.fillStyle = '#A68A55'
  ctx.beginPath()
  ctx.ellipse(-123, 0, 83, 111, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4B3B25'
  ctx.beginPath()
  ctx.ellipse(-115, 0, 45, 75, 0, 0, Math.PI * 2)
  ctx.fill()
  const intercept = smooth(time / 1.6)
  bee(ctx, -65 + intercept * 90, 0, time, { scale: 2.8, colorVariant: 'old' })
  const retreat = smooth((time - 1.6) / 1.3)
  drawAnt(ctx, createAntPose(185 - intercept * 90 + retreat * 115, 10 + retreat * 40, time, { scale: 2.7, rotation: retreat > 0.15 ? 0 : Math.PI }))
}
function laying(ctx, time) {
  const p = smooth((time - 0.8) / 1.4)
  cell(ctx, -80, 24, 48, p > 0.75 ? 'egg' : 'honey')
  cell(ctx, -169, 83, 31, 'capped')
  cell(ctx, 3, 93, 31, 'larva')
  queen(ctx, 19 + smooth((time - 1.9) / 0.8) * 80, -16, time)
  if (p > 0 && p < 0.8) drop(ctx, -84, -12 + p * 46, 9, '#F0EAD8')
  bee(ctx, 162, 70, time, { scale: 1.8, rotation: Math.PI })
}
const painters = [development, cleaning, nursing, feedingQueen, guarding, laying,
  (ctx, time) => {
    cell(ctx, -90, 35, 42, 'egg')
    cell(ctx, 0, 58, 42, 'larva')
    cell(ctx, 90, 35, 42, 'capped')
    drawBeeBody(ctx, createFlightPose(0, -58 + Math.sin(time) * 8, time, { scale: 3.2, rotation: -0.15 }))
  },
]
export default {
  enter(context) {
    t = 0
    done = false
    context.input.consumeClicks()
    context.audio?.startIntro?.()
  },
  update(context, dt) {
    t += dt
    let clickedSkip = false
    for (const click of context.input.consumeClicks()) {
      if (pointInRect(click, soundButton(context))) {
        context.audio?.setMuted?.(false)
        context.audio?.unlock?.()
      } else clickedSkip = true
    }
    const skip = clickedSkip || anyKeyPressed(context.input, SKIP_KEYS)
    if (!done && (skip || t >= INTRO_DURATION)) {
      done = true
      context.goTo('menu')
    }
  },
  render(context, ctx) {
    const { width: w, height: h } = context
    backdrop.draw(ctx, 0, 0, w, h)
    const L = screenLayout(context)
    const S = safeRect(L)
    const i = Math.max(0, scenes.findLastIndex(scene => t >= scene.at))
    const scene = scenes[i]
    const local = t - scene.at
    const cx = S.x + S.w / 2
    const cy = S.y + S.h * 0.46
    const scale = Math.max(0.2, Math.min((S.w - 30) / 560, (S.h - 150) / 380, 1.8))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    drawGuideLine(ctx, -263, 0, 263, 0, { alpha: 0.16 })
    drawDottedCircle(ctx, 0, 0, 155, { alpha: 0.24, progress: smooth(local / 0.7) })
    drawScaleArc(ctx, 0, 0, 169, Math.PI * 1.05, Math.PI * 1.95, { ticks: 32, majorEvery: 4, alpha: 0.42, progress: smooth(local / 0.8) })
    painters[i](ctx, local)
    ctx.restore()
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'center'
    ctx.font = font(Math.min(i === 6 ? 46 : 34, S.w * 0.073))
    ctx.fillText(scene.title, cx, S.y + Math.max(31, S.h * 0.1))
    ctx.font = font(Math.max(13, Math.min(17, S.w * 0.037)), { style: 'italic' })
    const lines = wrapText(ctx, scene.caption, S.w - 42)
    const captionY = Math.min(S.y + S.h - 84, cy + 185 * scale + 28)
    lines.forEach((line, k) => ctx.fillText(line, cx, captionY + k * 22))
    const timelineY = S.y + S.h - 52
    drawGuideLine(ctx, cx - S.w * 0.28, timelineY, cx + S.w * 0.28, timelineY, { alpha: 0.35 })
    drop(ctx, cx - S.w * 0.28 + S.w * 0.56 * clamp(t / INTRO_DURATION), timelineY, 3, UI.pink)
    ctx.restore()
    // Paper dissolves also work with art rigs that set their own alpha.
    const fade = Math.max(1 - smooth(local / 0.35), smooth((t - scene.end + 0.3) / 0.3))
    fadeScreen(ctx, w, h, fade, UI.paper)
    drawButton(ctx, soundButton(context), context.audio?.context?.state === 'running' && !context.audio?.muted ? 'Som ativo' : 'Ativar som', { fontSize: 14 })
    drawButton(ctx, { ...soundButton(context), x: cx + 5 }, 'Pular · Enter', { fontSize: 14 })
  },
  exit(context) {
    context.audio?.stopIntro?.()
  },
}
