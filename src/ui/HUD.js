// HUD - painel de "caderno de campo" com os 6 indicadores da colônia (mostradores
// técnicos de IndicatorBar), o dia atual/maxDays (mostrador circular de dias)
// e o rank atual da operária. Também exporta pequenos utilitários de UI
// compartilhados pelos estados de interface (src/states/*State.js).
//
// Vertical (celular em pé) é o formato de design; em tela larga o painel vira uma
// faixa única centralizada com largura máxima.
//
// API pública:
//   drawHUD(ctx, context, opts = {}) -> { x, y, width, height, bottom }
//     opts: { x, y, width, night = context.time.isNight, showProgress = true }
//       Padrão: centralizado na área segura de screenLayout(context), 10px abaixo do
//       notch, largura = área segura − 24 (máx. 1100).
//     Largura < 760: cabeçalho (dia + função + progresso) e mostradores em grade 3×2.
//     Largura ≥ 760: tudo numa faixa só.
//     Lê context.colony / context.time / context.tasks / context.elapsed.
//     Mantém um IndicatorBar por indicador (por context, via WeakMap) - valores
//     animam suavemente sozinhos quando ColonyState muda.
//   getHUDHeight(width, uiScale = 1) -> number   (altura que drawHUD vai ocupar)
//   RANK_NAMES, rankName(id), COLONY_INDICATORS [{ key, label, short }]
//   promotionProgress(context) -> { rank, next, acc, threshold, frac, turnsLeft, expectedTurns }
//     Progresso até a próxima função (config.promotionThresholds / turnsPerTask).
//     turnsLeft é a quantidade exata de turnos restantes.
//   Utilitários de tela (mobile first):
//     screenLayout(context) -> layout  (context.layout, ou getLayout(w, h) se ausente)
//     uiScaleOf(layout) -> número 0.9-1.3 para fontes/ícones
//     safeRect(layout) -> { x, y, w, h }  área sem notch/barra
//     isTouchUI(context) -> boolean  (context.controls.isTouch / input.lastInputType)
//     anyKeyPressed(input, codes) -> boolean  (borda via input.wasKeyPressed)
//     continueHint(context, verb = t('hud.verb.continue')) -> 'toque para …' / 'tap to …'
//       (traduzido via hud.hint.*; passe o verbo já traduzido)
//     drawHint(ctx, layout, text, alpha = 1)  dica centralizada acima da borda segura
//   Utilitários de desenho: createLayerCache(paint), createPaperBackdrop(opts),
//     wrapText(ctx, text, maxWidth), drawPaperCard(ctx, x, y, w, h, opts),
//     drawButton(ctx, rect, label, opts), pointInRect(p, rect), fadeScreen(ctx, w, h, alpha)
//   createKeyWatcher(input, codes) - LEGADO (prefira anyKeyPressed); mantido por compat.

import IndicatorBar, { UI, font, drawDial, drawScaleArc, drawDottedCircle, setLetterSpacing } from './IndicatorBar.js'
import { getLayout } from './layout.js'
import { config } from '../data/config.js'
import { RANK_ORDER } from '../systems/TaskSystem.js'
import { drawPaperGrain, strokeHandDrawn, seedFromString } from '../art/textureUtils.js'
import { drawBackground } from '../art/environment.js'
import { t as tr } from '../i18n/index.js'

const RANK_IDS = ['larva', 'cleaning', 'feedLarvae', 'feedQueen', 'guard']

// Nomes traduzidos: getters que leem t('rank.<id>') no idioma atual a cada acesso.
export const RANK_NAMES = Object.freeze(
  Object.defineProperties({}, Object.fromEntries(RANK_IDS.map((id) => [id, { enumerable: true, get: () => tr(`rank.${id}`) }])))
)

export function rankName(id) {
  return RANK_IDS.includes(id) ? tr(`rank.${id}`) : String(id ?? '')
}

// label/short são getters traduzidos (idioma atual a cada leitura).
export const COLONY_INDICATORS = ['population', 'nectar', 'pollen', 'propolis', 'wax', 'health'].map((key) => ({
  key,
  get label() { return tr(`hud.indicator.${key}`) },
  get short() { return tr(`hud.indicator.${key}.short`) },
}))

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

const clampN = (v, a, b) => Math.max(a, Math.min(b, v))

let fallbackLayout = null
/** Layout da tela: context.layout (contrato novo) ou calculado aqui como fallback. */
export function screenLayout(context) {
  const w = context.width
  const h = context.height
  const L = context.layout
  if (L && L.width === w && L.height === h) return L
  if (!fallbackLayout || fallbackLayout.width !== w || fallbackLayout.height !== h) fallbackLayout = getLayout(w, h)
  return fallbackLayout
}

export function uiScaleOf(L) {
  return clampN(L?.uiScale ?? 1, 0.9, 1.3)
}

export function safeRect(L) {
  const s = L.safe || { top: 0, right: 0, bottom: 0, left: 0 }
  return { x: s.left, y: s.top, w: Math.max(0, L.width - s.left - s.right), h: Math.max(0, L.height - s.top - s.bottom) }
}

export function isTouchUI(context) {
  if (context.controls && typeof context.controls.isTouch === 'boolean') return context.controls.isTouch
  const t = context.input?.lastInputType
  return t === 'touch' || t === 'pen'
}

export function anyKeyPressed(input, codes) {
  if (!input || typeof input.wasKeyPressed !== 'function') return false
  return codes.some((c) => input.wasKeyPressed(c))
}

export function continueHint(context, verb = tr('hud.verb.continue')) {
  return tr(isTouchUI(context) ? 'hud.hint.touch' : 'hud.hint.desktop', { verb })
}

/** Dica discreta (mas legível) centralizada acima da borda segura inferior. */
export function drawHint(ctx, L, text, alpha = 1) {
  if (!text || alpha <= 0) return
  const u = uiScaleOf(L)
  const S = safeRect(L)
  ctx.save()
  ctx.globalAlpha *= 0.7 * Math.min(1, alpha)
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = font(13.5 * u, { style: 'italic' })
  ctx.fillText(text, S.x + S.w / 2, S.y + S.h - 16 * u)
  ctx.restore()
}

export function promotionProgress(context) {
  const rank = context.tasks?.currentRank ?? 'cleaning'
  const idx = RANK_ORDER.indexOf(rank)
  const next = idx >= 0 && idx < RANK_ORDER.length - 1 ? RANK_ORDER[idx + 1] : null
  const acc = Math.max(0, context.tasks?.getAccumulatedScore?.() ?? 0)
  const T = config.promotionThresholds || {}
  const threshold = Math.max(1, T[rank] ?? T.default ?? 150)
  const TP = config.turnsPerTask || {}
  const expectedTurns = Math.max(1, TP[rank] ?? TP.default ?? 3)
  const completed = context.tasks?.getCompletedShifts?.() ?? 0
  const frac = clampN(completed / expectedTurns, 0, 1)
  const turnsLeft = Math.max(0, expectedTurns - completed)
  return { rank, next, acc, threshold, frac, turnsLeft, expectedTurns }
}

/**
 * LEGADO - detecção de borda por polling de isKeyDown. Prefira anyKeyPressed().
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
  const { hover = false, focused = false, disabled = false, time = 0, caption = '', accent = true, seed } = opts
  // Rótulo cresce com a altura do botão (alvo de toque grande = texto grande).
  const size = opts.size ?? clampN(rect.h * (caption ? 0.3 : 0.33), 17, 24)
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
    ctx.font = font(Math.max(12, size * 0.62), { style: 'italic' })
    ctx.globalAlpha *= 0.8
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
      bars: COLONY_INDICATORS.map(({ key, label, short }) => {
        const bar = new IndicatorBar({ label, shortLabel: short })
        bar.setValue(context.colony?.[key] ?? 0, { immediate: true })
        return bar
      }),
      lastElapsed: context.elapsed ?? 0,
    }
    hudState.set(context, s)
  }
  return s
}

const WIDE = 760

function hudMetrics(width, uiScale = 1) {
  const u = clampN(uiScale, 0.9, 1.3)
  const pad = 14 * u
  const labelSize = 12 * u
  if (width >= WIDE) {
    const dayR = 30 * u
    return { wide: true, u, pad, labelSize, dayR, height: Math.round(Math.max(118 * u, dayR * 2 + pad * 2 + 20)) }
  }
  const dayR = 27 * u
  const headH = pad + 78 * u
  const slotW = (width - pad * 2) / 3
  const r = clampN(slotW * 0.17, 15, 22 * u)
  const rowH = r * 2 + 16 + labelSize * 1.25 + 6 * u
  const height = Math.round(headH + 8 * u + rowH * 2 + 2 * u)
  return { wide: false, u, pad, labelSize, dayR, headH, slotW, r, rowH, height }
}

export function getHUDHeight(width, uiScale = 1) {
  return hudMetrics(width, uiScale).height
}

function fitFont(ctx, text, maxW, size, min, opts) {
  let s = size
  ctx.font = font(s, opts)
  while (s > min && ctx.measureText(text).width > maxW) {
    s -= 0.5
    ctx.font = font(s, opts)
  }
  return s
}

function drawDayDial(ctx, x, y, r, time, t, night, u) {
  const day = time?.currentDay ?? 1
  const maxDays = Math.max(1, time?.maxDays ?? 52)
  const frac = Math.min(1, day / maxDays)
  const top = -Math.PI / 2

  drawDottedCircle(ctx, x, y, r + 5, { alpha: 0.35 })
  // Escala de dias: um tick por dia, maior a cada 10.
  drawScaleArc(ctx, x, y, r, top, top + Math.PI * 2, {
    ticks: maxDays,
    majorEvery: 10,
    tickLen: 2.5,
    majorLen: 5.5,
    alpha: 0.6,
    lineWidth: 0.8,
  })
  ctx.save()
  ctx.strokeStyle = UI.gold
  ctx.lineWidth = 2.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, r - 8.5, top, top + Math.PI * 2 * frac)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(18 * u)
  ctx.fillText(String(day), x, y - 4 * u)
  const ofMax = tr('hud.dayOf', { max: maxDays })
  fitFont(ctx, ofMax, r * 1.5, 12 * u, 9, { style: 'italic' })
  ctx.globalAlpha = 0.8
  ctx.fillText(ofMax, x, y + 10 * u)
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

/** Régua curta de progresso até a próxima função: marcas por turno esperado + traço dourado. */
function drawProgressRule(ctx, x, y, w, progress, u) {
  const { frac, expectedTurns } = progress
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.45
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w, y)
  for (let i = 0; i <= expectedTurns; i++) {
    const tx = x + (w * i) / expectedTurns
    const len = i === 0 || i === expectedTurns ? 6 * u : 4 * u
    ctx.moveTo(tx, y - len)
    ctx.lineTo(tx, y + len * 0.4)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
  if (frac > 0.002) {
    ctx.strokeStyle = UI.gold
    ctx.lineWidth = 3.4 * u
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w * frac, y)
    ctx.stroke()
  }
  // cubo no ponto atual
  ctx.fillStyle = UI.gold
  ctx.strokeStyle = UI.ink
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.arc(x + w * frac, y, 3.4 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function progressCaption(p) {
  const n = p.turnsLeft
  return p.next ? tr('hud.progress.next', { n, rank: rankName(p.next) }) : tr('hud.progress.end', { n })
}

function drawRankBlock(ctx, context, tx, top, colW, u, showProgress) {
  const rankId = context.tasks?.currentRank
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = font(11.5 * u)
  setLetterSpacing(ctx, 1.5)
  ctx.globalAlpha = 0.75
  ctx.fillText(tr('hud.role'), tx, top + 12 * u)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = 1
  fitFont(ctx, rankName(rankId), colW, 22 * u, 15)
  ctx.fillText(rankName(rankId), tx, top + 37 * u)
  ctx.restore()

  if (showProgress && rankId && rankId !== 'larva') {
    const p = promotionProgress(context)
    const ruleW = Math.min(colW - 6, 240 * u)
    drawProgressRule(ctx, tx + 3, top + 52 * u, ruleW, p, u)
    ctx.save()
    ctx.fillStyle = UI.ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const cap = progressCaption(p)
    fitFont(ctx, cap, colW, 13 * u, 12, { style: 'italic' })
    ctx.globalAlpha = 0.85
    ctx.fillText(cap, tx, top + 74 * u)
    ctx.restore()
  }
}

function dottedLine(ctx, x0, y0, x1, y1) {
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.28
  ctx.setLineDash([1.2, 4])
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.restore()
}

export function drawHUD(ctx, context, opts = {}) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const width = opts.width ?? Math.min(1100, S.w - 24)
  const x = opts.x ?? S.x + (S.w - width) / 2
  const y = opts.y ?? S.y + 10
  const night = opts.night ?? !!context.time?.isNight
  const showProgress = opts.showProgress ?? true
  const M = hudMetrics(width, L.uiScale)
  const { u, pad, height } = M
  const t = context.elapsed ?? 0
  const s = getHudState(context)
  const dt = Math.max(0, Math.min(0.1, t - s.lastElapsed))
  s.lastElapsed = t

  const colony = context.colony || {}
  s.bars.forEach((bar, i) => {
    const ind = COLONY_INDICATORS[i]
    bar.label = ind.label
    bar.shortLabel = ind.short
    bar.setValue(colony[ind.key] ?? 0)
    bar.update(dt)
  })

  drawPaperCard(ctx, x, y, width, height, { seed: 23, night })

  if (M.wide) {
    const dayR = M.dayR
    const dayX = x + pad + 8 + dayR
    const dayY = y + height / 2
    drawDayDial(ctx, dayX, dayY, dayR, context.time, t, night, u)
    const tx = dayX + dayR + 20 * u
    const colW = 250 * u
    drawRankBlock(ctx, context, tx, dayY - 42 * u, colW, u, showProgress)
    const areaX0 = tx + colW + 14 * u
    const areaX1 = x + width - pad
    dottedLine(ctx, areaX0 - 8 * u, y + 16, areaX0 - 8 * u, y + height - 16)
    const slot = (areaX1 - areaX0) / s.bars.length
    const radius = clampN(slot * 0.27, 14, 26 * u)
    const rowY = y + height / 2 - M.labelSize * 0.7
    s.bars.forEach((bar, i) => {
      bar.draw(ctx, areaX0 + slot * (i + 0.5), rowY, {
        radius,
        time: t,
        labelSize: M.labelSize,
        labelMaxWidth: slot - 6,
      })
    })
    return { x, y, width, height, bottom: y + height }
  }

  // Compacto (celular em pé): cabeçalho + grade 3×2.
  const dayR = M.dayR
  const dayX = x + pad + 6 + dayR
  const dayY = y + pad + 6 * u + dayR
  drawDayDial(ctx, dayX, dayY, dayR, context.time, t, night, u)
  const tx = dayX + dayR + 18 * u
  drawRankBlock(ctx, context, tx, y + pad - 2 * u, x + width - pad - tx, u, showProgress)
  dottedLine(ctx, x + pad + 4, y + M.headH + 2 * u, x + width - pad - 4, y + M.headH + 2 * u)

  const rowTop = y + M.headH + 8 * u
  s.bars.forEach((bar, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    bar.draw(ctx, x + pad + M.slotW * (col + 0.5), rowTop + M.r + 7 + row * M.rowH, {
      radius: M.r,
      time: t,
      labelSize: M.labelSize,
      labelMaxWidth: M.slotW - 6,
    })
  })

  return { x, y, width, height, bottom: y + height }
}

export { drawDial }
