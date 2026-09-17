// HUD — painel de "caderno de campo" com os 6 indicadores da colônia (mostradores
// técnicos de IndicatorBar), o dia atual/maxDays (mostrador circular de dias)
// e o rank atual da operária. Também exporta pequenos utilitários de UI
// compartilhados pelos estados de interface (src/states/*State.js).
//
// API pública:
//   drawHUD(ctx, context, layout = {}) -> { x, y, width, height, bottom }
//     layout: { x = 12, y = 12, width = context.width - 24, night = context.time.isNight }
//     Lê context.colony / context.time / context.tasks / context.elapsed.
//     Mantém um IndicatorBar por indicador (por context, via WeakMap) — valores
//     animam suavemente sozinhos quando ColonyState muda.
//   getHUDHeight(width) -> number   (altura que drawHUD vai ocupar)
//   RANK_NAMES, rankName(id), COLONY_INDICATORS [{ key, label }]
//   Utilitários: createLayerCache(paint), createPaperBackdrop(opts),
//     createKeyWatcher(input, codes), wrapText(ctx, text, maxWidth),
//     drawPaperCard(ctx, x, y, w, h, opts), drawButton(ctx, rect, label, opts),
//     pointInRect(p, rect), fadeScreen(ctx, w, h, alpha)

import IndicatorBar, { UI, font, drawDial, drawScaleArc, drawDottedCircle, setLetterSpacing } from './IndicatorBar.js'
import { drawPaperGrain, strokeHandDrawn, seedFromString } from '../art/textureUtils.js'
import { drawBackground } from '../art/environment.js'

export const RANK_NAMES = {
  larva: 'Larva',
  cleaning: 'Faxineira',
  feedLarvae: 'Nutriz',
  feedQueen: 'Atendente da Rainha',
  guard: 'Guardiã',
}

export function rankName(id) {
  return RANK_NAMES[id] ?? String(id ?? '')
}

export const COLONY_INDICATORS = [
  { key: 'population', label: 'População' },
  { key: 'nectar', label: 'Néctar' },
  { key: 'pollen', label: 'Pólen' },
  { key: 'propolis', label: 'Própolis' },
  { key: 'wax', label: 'Cera' },
  { key: 'health', label: 'Saúde' },
]

const NIGHT_TINT = '#2E3B52'

// ---------------------------------------------------------------------------
// Utilitários compartilhados
// ---------------------------------------------------------------------------

/**
 * Cache de camada estática em canvas offscreen (em pixels físicos). paint(c, w, h, key)
 * desenha em coordenadas lógicas. Refeito só quando tamanho/DPR/chave mudam.
 */
export function createLayerCache(paint) {
  let canvas = null
  let cacheKey = ''
  return {
    get(width, height, key = '') {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
      const w = Math.max(1, Math.round(width))
      const h = Math.max(1, Math.round(height))
      const k = `${w}x${h}@${dpr}|${key}`
      if (k !== cacheKey || !canvas) {
        canvas = canvas || document.createElement('canvas')
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        const c = canvas.getContext('2d')
        c.setTransform(dpr, 0, 0, dpr, 0, 0)
        c.clearRect(0, 0, w, h)
        paint(c, w, h, key)
        cacheKey = k
      }
      return canvas
    },
    draw(ctx, x, y, width, height, key = '') {
      ctx.drawImage(this.get(width, height, key), x, y, Math.round(width), Math.round(height))
    },
    invalidate() {
      cacheKey = ''
    },
  }
}

/**
 * Página de caderno de campo: papel naturalista + vinheta quente, em cache.
 * { foliage: true } usa environment.drawBackground (com folhagem distante);
 * o padrão é só o papel, para telas de UI. A chave do draw() é o timeOfDay.
 */
export function createPaperBackdrop({ seed = 42, vignette = 0.22, foliage = false } = {}) {
  return createLayerCache((c, w, h, key) => {
    if (foliage) {
      drawBackground(c, key || 'day', { width: w, height: h, seed })
    } else {
      drawPaperGrain(c, w, h, { seed, noiseCount: Math.round((w * h) / 700) })
      if (key === 'night') {
        c.fillStyle = NIGHT_TINT
        c.globalAlpha = 0.22
        c.fillRect(0, 0, w, h)
        c.globalAlpha = 1
      }
    }
    if (vignette > 0) {
      const g = c.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62)
      g.addColorStop(0, 'rgba(59, 44, 28, 0)')
      g.addColorStop(1, `rgba(59, 44, 28, ${vignette})`)
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
    }
  })
}

/**
 * Detecção de borda de tecla (InputManager só expõe isKeyDown).
 * watcher.prime() no enter (ignora teclas já seguradas do estado anterior);
 * watcher.poll() 1x por update -> Set de códigos recém-pressionados.
 */
export function createKeyWatcher(input, codes) {
  const prev = new Map()
  return {
    prime() {
      codes.forEach((c) => prev.set(c, input.isKeyDown(c)))
    },
    poll() {
      const pressed = new Set()
      codes.forEach((c) => {
        const down = input.isKeyDown(c)
        if (down && !prev.get(c)) pressed.add(c)
        prev.set(c, down)
      })
      return pressed
    },
  }
}

export function pointInRect(p, r) {
  return !!p && !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

export function fadeScreen(ctx, w, h, alpha, color = '#1A1410') {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

const cardCache = new Map()
function cardCanvas(w, h, seed, night) {
  const key = `${w}x${h}:${seed}:${night ? 1 : 0}`
  let entry = cardCache.get(key)
  if (!entry) {
    if (cardCache.size > 32) cardCache.clear()
    entry = createLayerCache((c, cw, ch) => {
      const pad = 4
      c.save()
      c.beginPath()
      c.moveTo(pad + 1, pad)
      c.lineTo(cw - pad, pad + 0.8)
      c.lineTo(cw - pad - 0.6, ch - pad)
      c.lineTo(pad, ch - pad - 0.7)
      c.closePath()
      c.clip()
      drawPaperGrain(c, cw, ch, {
        seed,
        bandWidth: 46,
        noiseCount: Math.round((cw * ch) / 900),
      })
      if (night) {
        c.globalAlpha = 0.12
        c.fillStyle = NIGHT_TINT
        c.fillRect(0, 0, cw, ch)
      }
      c.restore()
      const corners = [
        { x: pad + 1, y: pad },
        { x: cw - pad, y: pad + 0.8 },
        { x: cw - pad - 0.6, y: ch - pad },
        { x: pad, y: ch - pad - 0.7 },
      ]
      strokeHandDrawn(c, corners, { baseWidth: 1.4, widthJitter: 0.35, closed: true, seed, opacity: 0.85 })
      // Filete interno fino, como etiqueta de espécime.
      c.save()
      c.strokeStyle = UI.ink
      c.globalAlpha = 0.25
      c.lineWidth = 0.7
      c.strokeRect(pad + 4.5, pad + 4.5, cw - pad * 2 - 9, ch - pad * 2 - 9)
      c.restore()
    })
    cardCache.set(key, entry)
  }
  return entry.get(w, h)
}

/** Cartão de papel com contorno de mão e filete interno. opts: { seed, alpha, shadow, night } */
export function drawPaperCard(ctx, x, y, w, h, opts = {}) {
  const { seed = 11, alpha = 1, shadow = true, night = false } = opts
  const cw = Math.max(16, Math.round(w))
  const ch = Math.max(16, Math.round(h))
  ctx.save()
  ctx.globalAlpha *= alpha
  if (shadow) {
    ctx.save()
    ctx.fillStyle = '#140E08'
    ctx.globalAlpha *= 0.12
    ctx.fillRect(x + 7, y + 9, cw - 8, ch - 8)
    ctx.fillRect(x + 4, y + 6, cw - 6, ch - 6)
    ctx.restore()
  }
  ctx.drawImage(cardCanvas(cw, ch, seed, night), x, y, cw, ch)
  ctx.restore()
}

/**
 * Botão-etiqueta. opts: { hover, focused, disabled, time, caption, accent = true, size = 18 }
 * O realce de foco usa o acento rosa (o estado decide se é o acento da cena).
 */
export function drawButton(ctx, rect, label, opts = {}) {
  const { hover = false, focused = false, disabled = false, time = 0, caption = '', accent = true, size = 18, seed } = opts
  const active = (hover || focused) && !disabled
  ctx.save()
  ctx.globalAlpha *= disabled ? 0.55 : 1
  const lift = active ? -1.5 : 0
  drawPaperCard(ctx, rect.x, rect.y + lift, rect.w, rect.h, {
    seed: seed ?? seedFromString(label),
    shadow: !disabled,
  })
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2 + lift
  ctx.fillStyle = UI.ink
  ctx.globalAlpha *= disabled ? 0.6 : 1
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(size)
  ctx.fillText(label, cx, caption ? cy - size * 0.35 : cy)
  if (caption) {
    ctx.font = font(size * 0.62, { style: 'italic' })
    ctx.globalAlpha *= 0.7
    ctx.fillText(caption, cx, cy + size * 0.6)
  }
  ctx.restore()

  if (active) {
    const tw = (() => {
      ctx.save()
      ctx.font = font(size)
      const m = ctx.measureText(label).width
      ctx.restore()
      return m
    })()
    const pulse = 0.5 + 0.5 * Math.sin(time * 3)
    ctx.save()
    // Marcadores tipo "mira": pequenos ticks nas laterais do rótulo.
    const ly = cy - (caption ? size * 0.35 : 0) + lift
    const lx0 = cx - tw / 2 - 14 - pulse * 2
    const lx1 = cx + tw / 2 + 14 + pulse * 2
    ctx.strokeStyle = accent ? UI.pink : UI.ink
    ctx.lineWidth = 1.3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lx0 - 7, ly)
    ctx.lineTo(lx0, ly)
    ctx.moveTo(lx0 + 1, ly)
    ctx.lineTo(lx0 - 3, ly - 3.5)
    ctx.moveTo(lx0 + 1, ly)
    ctx.lineTo(lx0 - 3, ly + 3.5)
    ctx.moveTo(lx1 + 7, ly)
    ctx.lineTo(lx1, ly)
    ctx.stroke()
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const hudState = new WeakMap()

function getHudState(context) {
  let s = hudState.get(context)
  if (!s) {
    s = {
      bars: COLONY_INDICATORS.map(({ key, label }) => {
        const bar = new IndicatorBar({ label })
        bar.setValue(context.colony?.[key] ?? 0, { immediate: true })
        return bar
      }),
      lastElapsed: context.elapsed ?? 0,
      dayShown: context.time?.currentDay ?? 1,
    }
    hudState.set(context, s)
  }
  return s
}

const WIDE = 760

export function getHUDHeight(width) {
  return width >= WIDE ? 104 : 178
}

function drawDayDial(ctx, x, y, r, time, t, night) {
  const day = time?.currentDay ?? 1
  const maxDays = Math.max(1, time?.maxDays ?? 52)
  const frac = Math.min(1, day / maxDays)
  const top = -Math.PI / 2

  drawDottedCircle(ctx, x, y, r + 5, { alpha: 0.3 })
  // Escala de dias: um tick por dia, maior a cada 10.
  drawScaleArc(ctx, x, y, r, top, top + Math.PI * 2, {
    ticks: maxDays,
    majorEvery: 10,
    tickLen: 2.5,
    majorLen: 5.5,
    alpha: 0.55,
    lineWidth: 0.8,
  })
  ctx.save()
  ctx.strokeStyle = UI.gold
  ctx.lineWidth = 2.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, r - 9, top, top + Math.PI * 2 * frac)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(17)
  ctx.fillText(String(day), x, y - 3)
  ctx.font = font(8.5)
  setLetterSpacing(ctx, 1.2)
  ctx.globalAlpha = 0.7
  ctx.fillText(`DE ${maxDays}`, x, y + 10)
  setLetterSpacing(ctx, 0)
  ctx.restore()

  // Pequeno sol / lua orbitando o mostrador.
  const a = top + Math.PI * 2 * frac
  const gx = x + Math.cos(a) * (r + 5)
  const gy = y + Math.sin(a) * (r + 5)
  ctx.save()
  ctx.lineWidth = 0.9
  ctx.strokeStyle = UI.ink
  if (night) {
    ctx.fillStyle = '#D8D2BE'
    ctx.beginPath()
    ctx.arc(gx, gy, 4.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#9AA3AE'
    ctx.beginPath()
    ctx.arc(gx + 1.8, gy - 1.2, 3.4, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = UI.sunGold
    ctx.beginPath()
    ctx.arc(gx, gy, 3.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const ra = (i / 8) * Math.PI * 2 + t * 0.2
      ctx.moveTo(gx + Math.cos(ra) * 5.5, gy + Math.sin(ra) * 5.5)
      ctx.lineTo(gx + Math.cos(ra) * 7.5, gy + Math.sin(ra) * 7.5)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export function drawHUD(ctx, context, layout = {}) {
  const W = context.width
  const {
    x = 12,
    y = 12,
    width = W - 24,
    night = !!context.time?.isNight,
  } = layout
  const height = getHUDHeight(width)
  const t = context.elapsed ?? 0
  const s = getHudState(context)
  const dt = Math.max(0, Math.min(0.1, t - s.lastElapsed))
  s.lastElapsed = t

  const colony = context.colony || {}
  s.bars.forEach((bar, i) => {
    bar.setValue(colony[COLONY_INDICATORS[i].key] ?? 0)
    bar.update(dt)
  })

  drawPaperCard(ctx, x, y, width, height, { seed: 23, night })

  const wide = width >= WIDE
  const rankId = context.tasks?.currentRank
  const dayR = 30
  const dayX = x + 24 + dayR
  const dayY = y + (wide ? height / 2 : 50)
  drawDayDial(ctx, dayX, dayY, dayR, context.time, t, night)

  // Rank + legenda.
  const tx = dayX + dayR + 22
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = font(9)
  setLetterSpacing(ctx, 1.6)
  ctx.globalAlpha = 0.6
  ctx.fillText('FUNÇÃO', tx, dayY - 14)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = 1
  ctx.font = font(21)
  ctx.fillText(rankName(rankId), tx, dayY + 7)
  ctx.font = font(11, { style: 'italic' })
  ctx.globalAlpha = 0.65
  ctx.fillText(`${night ? 'noite' : 'dia'} · Melipona quadrifasciata`, tx, dayY + 24)
  const rankTextW = Math.max(ctx.measureText(`${night ? 'noite' : 'dia'} · Melipona quadrifasciata`).width, 150)
  ctx.restore()

  // Mostradores.
  let areaX0, areaX1, rowY, radius
  if (wide) {
    areaX0 = tx + rankTextW + 24
    areaX1 = x + width - 16
    rowY = y + height / 2 - 6
    // divisória pontilhada vertical
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha = 0.25
    ctx.setLineDash([1.2, 4])
    ctx.beginPath()
    ctx.moveTo(areaX0 - 12, y + 18)
    ctx.lineTo(areaX0 - 12, y + height - 18)
    ctx.stroke()
    ctx.restore()
  } else {
    areaX0 = x + 12
    areaX1 = x + width - 12
    rowY = y + 118
    ctx.save()
    ctx.strokeStyle = UI.ink
    ctx.globalAlpha = 0.25
    ctx.setLineDash([1.2, 4])
    ctx.beginPath()
    ctx.moveTo(x + 18, y + 88)
    ctx.lineTo(x + width - 18, y + 88)
    ctx.stroke()
    ctx.restore()
  }
  const slot = (areaX1 - areaX0) / s.bars.length
  radius = Math.max(12, Math.min(25, slot * 0.3))
  s.bars.forEach((bar, i) => {
    bar.draw(ctx, areaX0 + slot * (i + 0.5), rowY, { radius, time: t })
  })

  return { x, y, width, height, bottom: y + height }
}

export { drawDial }
