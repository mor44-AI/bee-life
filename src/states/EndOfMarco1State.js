// EndOfMarco1State - enter(context, data):
//   data = { reason: 'completed' | 'lifeOver', finalScore, shiftsTotal, finalBonus: { items, total }, bestCombo }
//   (campos de pontuação ausentes -> context.endData(reason), ou calculados de context.score).
//   'completed' -> dominou a defesa da entrada: "Continua em breve - lá fora, o mundo ultravioleta espera"
//   'lifeOver'  -> a vida chegou ao fim antes disso.
//
// Duas páginas, vertical primeiro (botão grande na zona do polegar):
//   'score' - emblema, título e cartão com a PONTUAÇÃO FINAL em contagem animada: pontos dos
//             turnos, melhor combo e o bônus da colmeia por indicador - cada bônus fica sob o
//             mostrador do indicador, e o total sobe à medida que cada mostrador se revela.
//             Toque/tecla adianta a animação; depois -> 'board'.
//   'board' - ranking (top 10, posição do jogador em destaque; registros fictícios normais).
//             Se leaderboard.qualifies(finalScore), um painel DOM sobreposto ao canvas
//             (input + Registrar/Pular) pede o nome; fica no terço superior da área visível
//             quando o teclado virtual está aberto. O painel é removido ao decidir e no exit().
//             Depois: toque/clique/tecla ou botão -> goTo('menu').
//
// Exporta drawLeaderboard / formatScore (usados também pelo painel "Ranking" do menu).

import { ease } from '../engine/tween.js'
import { drawBeeBody, createIdlePose } from '../art/bee.js'
import { UI, font, drawDial, drawScaleArc, drawDottedCircle, drawGuideLine, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  drawPaperCard,
  drawButton,
  wrapText,
  COLONY_INDICATORS,
  fadeScreen,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
  drawHint,
} from '../ui/HUD.js'
import leaderboard, { NAME_MAX } from '../systems/Leaderboard.js'
import { t as tr, getLang } from '../i18n/index.js'

const KEYS = ['Enter', 'NumpadEnter', 'Space', 'Escape']
const T_CARD = 1.3
const T_SHIFTS = 1.5
const T_BONUS = 2.3
const BONUS_STEP = 0.32
const BONUS_DUR = 0.45

const backdrop = createPaperBackdrop({ seed: 97 })
let t = 0
let bt = 0 // tempo na página do ranking
let reason = 'completed'
let page = 'score' // 'score' | 'board'
let score = null // { finalScore, shiftsTotal, items, bestCombo }
let canQualify = false
let prevBest = 0
let naming = false
let decided = false
let submitted = null // { entry, rank }
let panel = null // { root, input, cleanup, lastStyle }
let lastBoardSlot = null

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const clamp01 = (v) => clamp(v, 0, 1)
const seg = (time, a, b, type = 'easeInOutCubic') => ease(clamp01((time - a) / (b - a)), type)
const T_DONE = () => T_BONUS + (score?.items.length ?? 6) * BONUS_STEP + BONUS_DUR + 0.1

const SUBTITLE_KEY = { completed: 'end.completedSubtitle', lifeOver: 'end.lifeOverSubtitle' }

export function formatScore(n) {
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString(getLang() === 'pt' ? 'pt-BR' : 'en-US')
}

// Encolhe a fonte até o texto caber (textos pt/en têm larguras diferentes).
function fitSize(ctx, text, maxW, size, min, opts) {
  ctx.font = font(size, opts)
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 0.5
    ctx.font = font(size, opts)
  }
  return size
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  let s = Array.from(text)
  while (s.length > 1 && ctx.measureText(s.join('') + '…').width > maxW) s.pop()
  return s.join('') + '…'
}

// ---------------------------------------------------------------------------
// Tabela do ranking (compartilhada com o menu)
// rows: [{ rank, name, score, you?, pending?, extra? }]
//   you: linha do jogador (destaque); pending: nome ainda sendo digitado; extra: linha fora
//   do top (desenhada após um filete tracejado).
// ---------------------------------------------------------------------------
export function drawLeaderboard(ctx, rect, rows, opts = {}) {
  const { u = 1, columns = 1, alpha = 1, time = 0 } = opts
  if (!rows.length || alpha <= 0) return
  const perCol = Math.ceil(rows.length / columns)
  const colGap = columns > 1 ? 18 * u : 0
  const colW = (rect.w - colGap * (columns - 1)) / columns
  const rowH = rect.h / Math.max(1, perCol)
  const size = clamp(rowH * 0.5, 11, 18 * u)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.textBaseline = 'middle'
  ctx.font = font(size)
  const rankW = Math.max(ctx.measureText(tr('score.board.rank', { n: 10 })).width, ctx.measureText(tr('score.board.rank', { n: 99 })).width) + 10
  rows.forEach((row, i) => {
    const col = Math.floor(i / perCol)
    const r = i % perCol
    const x = rect.x + col * (colW + colGap)
    const y = rect.y + r * rowH
    const cy = y + rowH / 2
    if (row.you || row.pending) {
      ctx.save()
      ctx.fillStyle = UI.sunHalo
      ctx.globalAlpha *= 0.6
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y + 1.5, colW, rowH - 3, 6)
      else ctx.rect(x, y + 1.5, colW, rowH - 3)
      ctx.fill()
      ctx.restore()
      // Único acento rosa da página: marcador da posição do jogador.
      const pulse = row.pending ? 0.5 + 0.5 * Math.sin(time * 4) : 1
      ctx.save()
      ctx.fillStyle = UI.pink
      ctx.globalAlpha *= 0.55 + 0.45 * pulse
      ctx.beginPath()
      ctx.moveTo(x + 2, cy - 5)
      ctx.lineTo(x + 8, cy)
      ctx.lineTo(x + 2, cy + 5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    if (row.extra) {
      ctx.save()
      ctx.strokeStyle = UI.ink
      ctx.globalAlpha *= 0.35
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(x, y + 0.5)
      ctx.lineTo(x + colW, y + 0.5)
      ctx.stroke()
      ctx.restore()
    } else if (r > 0) {
      drawGuideLine(ctx, x + 4, y, x + colW - 4, y, { alpha: 0.12 })
    }
    ctx.fillStyle = UI.ink
    ctx.font = font(size)
    ctx.textAlign = 'left'
    ctx.globalAlpha = alpha * (row.you || row.pending ? 1 : 0.75)
    ctx.fillText(tr('score.board.rank', { n: row.rank }), x + 12, cy)
    const scoreText = row.score == null ? '' : formatScore(row.score)
    const scoreW = ctx.measureText(scoreText).width
    const nameX = x + 12 + rankW
    const nameW = colW - 12 - rankW - scoreW - 18
    ctx.globalAlpha = alpha * (row.pending && !row.name ? 0.5 : 1)
    ctx.font = font(size, { style: row.pending && !row.name ? 'italic' : '' })
    ctx.fillText(ellipsize(ctx, row.name || tr('score.board.enterName'), Math.max(20, nameW)), nameX, cy)
    ctx.globalAlpha = alpha
    ctx.font = font(size)
    ctx.textAlign = 'right'
    ctx.fillText(scoreText, x + colW - 8, cy)
  })
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
function resolveScore(context, data) {
  let d = data
  if (!Number.isFinite(d.finalScore) || !d.finalBonus) {
    d = context.endData?.(reason) ?? null
    if (!d || !Number.isFinite(d.finalScore)) {
      const s = context.score
      const finalBonus = s?.finalBonus ? s.finalBonus(context.colony) : { items: [], total: 0 }
      d = { finalScore: (s?.total ?? 0) + finalBonus.total, shiftsTotal: s?.total ?? 0, finalBonus, bestCombo: s?.lifeBestCombo ?? 0 }
    }
  }
  const items = Array.isArray(d.finalBonus?.items) ? d.finalBonus.items : []
  return {
    finalScore: Math.round(d.finalScore ?? 0),
    shiftsTotal: Math.round(d.shiftsTotal ?? 0),
    items: items.map((it) => ({ key: it.key, value: Number(it.value) || 0, points: Math.round(Number(it.points) || 0) })),
    bestCombo: Math.round(d.bestCombo ?? 0),
  }
}

function boardRows(inputValue = '') {
  const top = leaderboard.top(10)
  const rows = top.map((e, i) => ({ rank: i + 1, name: e.name, score: e.score }))
  if (submitted) {
    const idx = submitted.rank - 1
    if (rows[idx]) rows[idx].you = true
    return rows
  }
  const pos = leaderboard.rankOf(score.finalScore)
  if (naming) {
    const list = [...rows]
    list.splice(pos - 1, 0, { name: inputValue.trim(), score: score.finalScore, pending: true })
    return list.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }))
  }
  rows.push({ rank: pos, name: tr('end.you'), score: score.finalScore, you: true, extra: true })
  return rows
}

// Valores exibidos na contagem animada.
function countState(time) {
  const shifts = score.shiftsTotal * seg(time, T_SHIFTS, T_BONUS - 0.1, 'easeOutCubic')
  let total = shifts
  const bonus = score.items.map((it, i) => {
    const a = T_BONUS + i * BONUS_STEP
    const v = it.points * seg(time, a, a + BONUS_DUR, 'easeOutCubic')
    total += v
    return { reveal: seg(time, a - 0.15, a + BONUS_DUR + 0.2), shown: v, active: time >= a && time < a + BONUS_DUR + 0.25 }
  })
  const done = time >= T_DONE()
  return { shifts: done ? score.shiftsTotal : shifts, bonus, total: done ? score.finalScore : total }
}

// ---------------------------------------------------------------------------
// Layout da página de pontuação
// ---------------------------------------------------------------------------
function cardMetrics(cardW, u, perRow) {
  const wide = cardW >= 420
  const slot = (cardW - 32) / perRow
  const labelSize = 12 * u
  const radius = clamp(slot * 0.2, 15, 22 * u)
  const ptsSize = 13.5 * u
  const rowH = radius * 2 + 16 + labelSize * 1.25 + ptsSize * 1.15 + 8 * u
  const totalSize = clamp(cardW * 0.1, 30, 46 * u)
  const headH = wide ? 34 * u : 50 * u
  const totalH = wide ? Math.max(totalSize * 1.2, 44 * u) : totalSize * 1.2 + 44 * u
  const bonusH = 24 * u
  const rows = Math.ceil(Math.max(1, score.items.length) / perRow)
  const h = 8 * u + headH + totalH + bonusH + rowH * rows + 4 * u
  return { wide, perRow, slot, labelSize, radius, ptsSize, rowH, totalSize, headH, totalH, bonusH, h }
}

function computeScoreLayout(context, ctx) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const cx = S.x + S.w / 2
  const titleSize = Math.max(26, Math.min(46, S.w * 0.085))
  const subSize = Math.max(14 * u, titleSize * 0.38)
  const subLH = subSize * 1.35
  ctx.save()
  ctx.font = font(subSize, { style: 'italic' })
  const subLines = wrapText(ctx, tr(SUBTITLE_KEY[reason]), Math.min(560, S.w - 48))
  ctx.restore()

  const cardW = Math.min(640, S.w - 24)
  const perRow = cardW < 520 ? 3 : 6
  const C = cardMetrics(cardW, u, perRow)
  const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))
  const btnW = Math.min(360, S.w - 40)
  const btn = { x: cx - btnW / 2, y: S.y + S.h - btnH - 40 * u, w: btnW, h: btnH }

  const fixed = 12 * u + titleSize * 0.9 + titleSize * 0.85 + (subLines.length - 1) * subLH + 14 * u + 12 * u + C.h + 12 * u
  const avail = btn.y - S.y - fixed
  if (avail < 0 && S.w > S.h) return computeLowScoreLayout(context, ctx, L, S, u)
  // Emblema com o espaço que sobra (some em telas baixas).
  const R = avail >= 26 * 3.3 ? clamp(avail / 3.3, 26, Math.min(S.w * 0.2, 110)) : 0
  const cy = S.y + 10 * u + R * 1.6
  const titleY = (R ? cy + R * 1.6 : S.y + 12 * u) + titleSize * 0.9
  const ulY = titleY + titleSize * 0.85 + (subLines.length - 1) * subLH + 14 * u
  // Sem emblema: o cartão fica centrado no espaço entre o subtítulo e o botão.
  const cardY = R
    ? Math.max(ulY + 12 * u, Math.min(btn.y - C.h - 12 * u, ulY + 20 * u))
    : ulY + 12 * u + Math.max(0, (btn.y - 12 * u - (ulY + 12 * u) - C.h) / 2)
  const card = { x: cx - cardW / 2, y: cardY, w: cardW, h: C.h }
  return { L, S, u, cx, cy, R, titleX: cx, titleW: S.w - 24, titleSize, subSize, subLH, subLines, titleY, ulY, card, C, btn, side: false }
}

// Tela deitada e baixa (celular deitado): título/subtítulo no topo; cartão à esquerda,
// emblema + botão + dica à direita.
function computeLowScoreLayout(context, ctx, L, S, u) {
  const titleSize = clamp(S.h * 0.09, 22, 34)
  const subSize = Math.max(13, 14 * u)
  const subLH = subSize * 1.3
  ctx.save()
  ctx.font = font(subSize, { style: 'italic' })
  const subLines = wrapText(ctx, tr(SUBTITLE_KEY[reason]), Math.min(680, S.w - 48)).slice(0, 2)
  ctx.restore()
  const titleY = S.y + 8 * u + titleSize * 0.9
  const ulY = titleY + titleSize * 0.8 + (subLines.length - 1) * subLH + 11 * u
  const top = ulY + 8 * u
  const bottom = S.y + S.h - 6 * u

  const colW = clamp(S.w * 0.28, 180, 280)
  const gap = 14 * u
  const cardW = Math.min(640, S.w - 24 - colW - gap)
  const C = cardMetrics(cardW, u, 6)
  const cardX = S.x + 12
  const card = { x: cardX, y: top + Math.max(0, (bottom - top - C.h) / 2), w: cardW, h: C.h }

  const colX = cardX + cardW + gap
  const colCx = colX + colW / 2
  const hintSize = 12.5 * u
  ctx.save()
  ctx.font = font(hintSize, { style: 'italic' })
  const hintLines = wrapText(ctx, tr(isTouchUI(context) ? 'end.boardTapHint' : 'end.boardClickHint'), colW - 8).slice(0, 2)
  ctx.restore()
  const hintLH = hintSize * 1.3
  const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))
  const btn = { x: colX, y: bottom - hintLines.length * hintLH - 6 * u - btnH, w: colW, h: btnH }
  const emblemH = btn.y - 8 * u - top
  const R = emblemH >= 18 * 3.2 ? clamp(emblemH / 3.2, 18, Math.min(colW * 0.3, 90)) : 0
  const cy = top + emblemH / 2
  return {
    L, S, u, cx: colCx, cy, R, titleX: S.x + S.w / 2, titleW: S.w - 24, titleSize, subSize, subLH, subLines, titleY, ulY,
    card, C, btn, side: true, hintLines, hintSize, hintLH,
  }
}

// ---------------------------------------------------------------------------
// Layout da página do ranking
// ---------------------------------------------------------------------------
function computeBoardLayout(context, ctx) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const btnH = Math.max(L.minTouch ?? 56, Math.round(60 * u))
  const titleSize = clamp(Math.min(S.w, S.h) * 0.075, 22, 38)
  const scoreSize = 16 * u
  const noteSize = 14.5 * u
  const hasNote = prevBest > 0 || isRecord()
  const headH = titleSize * 1.05 + scoreSize * 1.6 + (hasNote ? noteSize * 1.6 : 0)
  const panelH = 12 * u * 2 + 50 + 10 + 56
  const rowCount = naming || submitted ? 10 : 11
  const side = S.w > S.h

  if (!side) {
    const cx = S.x + S.w / 2
    const colW = Math.min(520, S.w - 24)
    const head = { x: cx - colW / 2, y: S.y + 16 * u, w: colW }
    let y = head.y + headH + 10 * u
    let panelRect = null
    if (naming) {
      const pw = Math.min(420, colW)
      panelRect = { x: cx - pw / 2, y, w: pw, h: panelH }
      y += panelH + 12 * u
    }
    const btnW = Math.min(360, S.w - 40)
    const btn = { x: cx - btnW / 2, y: S.y + S.h - btnH - 40 * u, w: btnW, h: btnH }
    const bottom = naming ? S.y + S.h - 12 * u : btn.y - 12 * u
    const rowH = Math.min(34 * u, (bottom - y) / rowCount)
    const table = { x: head.x, y, w: colW, h: rowH * rowCount }
    return { L, S, u, side, head, headAlign: 'center', titleSize, scoreSize, noteSize, panelRect, table, btn, hintBelow: true }
  }

  // Deitado: título, pontuação e painel/botão à esquerda; tabela à direita.
  const totalW = Math.min(S.w - 24, 980)
  const x0 = S.x + (S.w - totalW) / 2
  const leftW = clamp(totalW * 0.4, 220, 380)
  const gap = 20 * u
  const rightW = totalW - leftW - gap
  const hintSize = 12.5 * u
  const leftBlock = headH + 12 * u + (naming ? panelH : btnH + 8 * u + hintSize * 1.3)
  const top = S.y + Math.max(8 * u, (S.h - leftBlock) / 2)
  const head = { x: x0, y: top, w: leftW }
  let panelRect = null
  let btn = null
  const below = top + headH + 12 * u
  if (naming) panelRect = { x: x0, y: below, w: leftW, h: panelH }
  else btn = { x: x0 + (leftW - Math.min(leftW, 320)) / 2, y: below, w: Math.min(leftW, 320), h: btnH }
  const availH = S.h - 16 * u
  const rowH = Math.min(36 * u, availH / rowCount)
  const tableH = rowH * rowCount
  const table = { x: x0 + leftW + gap, y: S.y + (S.h - tableH) / 2, w: rightW, h: tableH }
  return { L, S, u, side, head, headAlign: 'center', titleSize, scoreSize, noteSize, panelRect, table, btn, hintSize }
}

function isRecord() {
  return score && score.finalScore > 0 && score.finalScore > prevBest
}

// ---------------------------------------------------------------------------
// Painel DOM do nome
// ---------------------------------------------------------------------------
function css(el, styles) {
  Object.assign(el.style, styles)
}

function openPanel(context) {
  closePanel()
  if (typeof document === 'undefined') return
  const root = document.createElement('form')
  root.setAttribute('autocomplete', 'off')
  root.noValidate = true
  css(root, {
    position: 'fixed', left: '0px', top: '0px', width: '300px', zIndex: '20', boxSizing: 'border-box',
    padding: '12px', background: UI.paper, border: `1.5px solid ${UI.ink}`, borderRadius: '8px',
    boxShadow: '4px 6px 0 rgba(20,14,8,0.14)', display: 'flex', flexDirection: 'column', gap: '10px',
    touchAction: 'manipulation', fontFamily: UI.serif, color: UI.ink,
  })
  const input = document.createElement('input')
  input.type = 'text'
  input.name = 'bee-name'
  input.setAttribute('inputmode', 'text')
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('autocorrect', 'off')
  input.setAttribute('autocapitalize', 'words')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('enterkeyhint', 'done')
  input.maxLength = NAME_MAX
  input.placeholder = tr('score.board.enterName')
  input.setAttribute('aria-label', tr('score.board.enterName'))
  css(input, {
    height: '50px', width: '100%', boxSizing: 'border-box', padding: '0 14px', fontSize: '19px',
    fontFamily: UI.serif, color: UI.ink, background: '#FBF7EC', border: `1px solid ${UI.ink}`, borderRadius: '6px',
    outline: 'none', userSelect: 'text', webkitUserSelect: 'text', touchAction: 'manipulation',
  })
  const row = document.createElement('div')
  css(row, { display: 'flex', gap: '10px' })
  const mkBtn = (label, type, primary) => {
    const b = document.createElement('button')
    b.type = type
    b.textContent = label
    css(b, {
      flex: '1 1 0', minHeight: '56px', minWidth: '0', padding: '0 8px', fontSize: '18px', fontFamily: UI.serif,
      color: UI.ink, background: primary ? UI.sunHalo : UI.paper, border: `1px solid ${UI.ink}`, borderRadius: '6px',
      cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    })
    return b
  }
  const saveBtn = mkBtn(tr('score.board.save'), 'submit', true)
  const skipBtn = mkBtn(tr('end.skip'), 'button', false)
  row.append(saveBtn, skipBtn)
  root.append(input, row)

  const onSubmit = (e) => {
    e.preventDefault()
    decide(true)
  }
  const onSkip = (e) => {
    e.preventDefault()
    decide(false)
  }
  // Teclas digitadas no painel não chegam ao InputManager (listener no window).
  const stop = (e) => {
    e.stopPropagation()
    if (e.type === 'keydown' && e.key === 'Escape') {
      e.preventDefault()
      decide(false)
    }
  }
  const onFocus = () => { panel && (panel.focused = true) }
  const onBlur = () => { panel && (panel.focused = false) }
  const vv = globalThis.visualViewport
  const onViewport = () => { if (panel) panel.dirty = true }
  root.addEventListener('submit', onSubmit)
  skipBtn.addEventListener('click', onSkip)
  root.addEventListener('keydown', stop)
  root.addEventListener('keyup', stop)
  input.addEventListener('focus', onFocus)
  input.addEventListener('blur', onBlur)
  vv?.addEventListener('resize', onViewport)
  vv?.addEventListener('scroll', onViewport)
  document.body.appendChild(root)
  panel = {
    root, input, focused: false, dirty: true, lastStyle: '',
    cleanup() {
      root.removeEventListener('submit', onSubmit)
      skipBtn.removeEventListener('click', onSkip)
      root.removeEventListener('keydown', stop)
      root.removeEventListener('keyup', stop)
      input.removeEventListener('focus', onFocus)
      input.removeEventListener('blur', onBlur)
      vv?.removeEventListener('resize', onViewport)
      vv?.removeEventListener('scroll', onViewport)
      if (document.activeElement === input) input.blur()
      root.remove()
    },
  }
  positionPanel(context)
  try { input.focus({ preventScroll: true }) } catch { input.focus() }
}

function closePanel() {
  if (!panel) return
  const p = panel
  panel = null
  p.cleanup()
}

// Posiciona o painel sobre a vaga calculada no canvas; com o teclado virtual aberto
// (visualViewport menor que a janela), sobe para o terço superior da área visível.
function positionPanel(context) {
  if (!panel || !lastBoardSlot) return
  const canvas = context.renderer?.canvas
  const cr = canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: context.width }
  const k = cr.width && context.width ? cr.width / context.width : 1
  const slot = lastBoardSlot
  const ph = panel.root.offsetHeight || slot.h
  let top = cr.top + slot.y * k
  const left = cr.left + slot.x * k
  const vv = globalThis.visualViewport
  if (vv) {
    const vTop = vv.offsetTop
    const vH = vv.height
    const keyboard = vH < (globalThis.innerHeight || vH) * 0.82
    const safeTop = screenLayout(context).safe?.top ?? 0
    if (panel.focused && keyboard) top = Math.min(top, vTop + Math.max(vH / 3 - ph / 2, 0))
    top = Math.min(top, vTop + vH - ph - 4)
    top = Math.max(top, vTop + Math.max(4, keyboard ? 4 : safeTop))
  }
  const style = `${Math.round(left)}|${Math.round(top)}|${Math.round(slot.w * k)}`
  if (style === panel.lastStyle) return
  panel.lastStyle = style
  css(panel.root, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${Math.round(slot.w * k)}px` })
}

function decide(save) {
  if (!naming) return
  const name = panel?.input.value ?? ''
  if (save) submitted = leaderboard.add(name, score.finalScore)
  naming = false
  decided = true
  bt = 0
  closePanel()
}

function openBoard(context) {
  page = 'board'
  bt = 0
  naming = canQualify && !decided
  lastBoardSlot = null
  if (naming) {
    const ctx = context.renderer?.getContext?.()
    if (ctx) lastBoardSlot = computeBoardLayout(context, ctx).panelRect
    openPanel(context)
  }
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
function drawEmblem(ctx, context, cx, cy, R, completed) {
  if (R <= 0) return
  if (completed) {
    const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.6)
    glow.addColorStop(0, `rgba(247, 223, 160, ${0.7 * seg(t, 0, 1.5)})`)
    glow.addColorStop(1, 'rgba(247, 223, 160, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + t * 0.02
      drawGuideLine(ctx, cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1, cx + Math.cos(a) * R * 1.55, cy + Math.sin(a) * R * 1.55, {
        progress: seg(t, 0.2 + i * 0.03, 1.4 + i * 0.03),
        alpha: 0.3,
        dash: [1.5, 4],
      })
    }
  }
  drawDottedCircle(ctx, cx, cy, R * 1.05, { progress: seg(t, 0, 1.2), alpha: 0.35 })
  ctx.save()
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.45
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * seg(t, 0.1, 1.3))
  ctx.stroke()
  ctx.restore()
  const time = context.time || {}
  const maxDays = time.maxDays ?? 52
  const daysLived = Math.min(time.currentDay ?? 1, maxDays)
  drawScaleArc(ctx, cx, cy, R * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (daysLived / maxDays), {
    progress: seg(t, 0.3, 1.8),
    ticks: daysLived,
    majorEvery: 10,
    tickLen: 3,
    majorLen: 7,
    alpha: 0.55,
  })
  const scale = (R * 0.75) / 34
  drawBeeBody(
    ctx,
    createIdlePose(cx - scale * 1.5, cy + scale * 2, {
      t: completed ? t : 0,
      colorVariant: 'old',
      scale,
      rotation: completed ? -Math.PI / 2 + 0.25 : -0.1,
      seed: 12,
    })
  )
}

const indicatorOf = (key) => COLONY_INDICATORS.find((ind) => key === `score.final.${ind.key}`)

function drawStat(ctx, x, w, y, label, value, u, alpha) {
  ctx.save()
  ctx.globalAlpha = alpha * 0.75
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  setLetterSpacing(ctx, 1)
  fitSize(ctx, label.toUpperCase(), w - 16, 11 * u, 8)
  ctx.fillText(label.toUpperCase(), x + w / 2, y + 12 * u)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = alpha
  fitSize(ctx, value, w - 6, 20 * u, 12)
  ctx.fillText(value, x + w / 2, y + 36 * u)
  ctx.restore()
}

function drawScoreCard(ctx, context, M) {
  const { card, C, u } = M
  const padX = 18 * u
  const cp = seg(t, T_CARD, T_CARD + 0.8)
  drawPaperCard(ctx, card.x, card.y, card.w, card.h, { seed: 64, alpha: cp })
  if (cp <= 0) return
  const counts = countState(t)
  const time = context.time || {}
  const maxDays = time.maxDays ?? 52
  const daysLived = Math.min(time.currentDay ?? 1, maxDays)
  const rankId = context.tasks?.currentRank
  const info = `${tr('end.daysLived', { days: daysLived, max: maxDays })} · ${tr('end.finalRole', { rank: rankId ? tr(`rank.${rankId}`) : '' })}`
  const innerW = card.w - padX * 2
  let y = card.y + 8 * u

  // Cabeçalho: rótulo + dias/função.
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.globalAlpha = cp * 0.8
  const label = tr('score.final.title').toUpperCase()
  setLetterSpacing(ctx, 1.5)
  ctx.font = font(12 * u)
  const labelW = ctx.measureText(label).width
  ctx.fillText(label, card.x + padX, y + 18 * u)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = cp * 0.85
  if (C.wide) {
    ctx.textAlign = 'right'
    fitSize(ctx, info, innerW - labelW - 16, 13.5 * u, 9, { style: 'italic' })
    ctx.fillText(info, card.x + card.w - padX, y + 18 * u)
  } else {
    fitSize(ctx, info, innerW, 13.5 * u, 9, { style: 'italic' })
    ctx.fillText(info, card.x + padX, y + 38 * u)
  }
  ctx.restore()
  y += C.headH

  // Total (contagem) + pontos dos turnos + melhor combo.
  const totalText = formatScore(counts.total)
  const statsW = C.wide ? Math.min(innerW * 0.56, 330) : innerW
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = cp
  if (C.wide) {
    ctx.textAlign = 'left'
    fitSize(ctx, totalText, innerW - statsW - 12, C.totalSize, 20)
    ctx.fillText(totalText, card.x + padX, y + C.totalH * 0.5 + C.totalSize * 0.36)
  } else {
    ctx.textAlign = 'center'
    fitSize(ctx, totalText, innerW, C.totalSize, 20)
    ctx.fillText(totalText, card.x + card.w / 2, y + C.totalSize * 0.95)
  }
  ctx.restore()
  const statsX = C.wide ? card.x + card.w - padX - statsW : card.x + padX
  const statsY = C.wide ? y + (C.totalH - 44 * u) / 2 : y + C.totalSize * 1.2
  const half = statsW / 2
  drawStat(ctx, statsX, half, statsY, tr('end.shiftsPoints'), formatScore(counts.shifts), u, cp * seg(t, T_SHIFTS - 0.2, T_SHIFTS + 0.3))
  drawStat(ctx, statsX + half, half, statsY, tr('score.shift.bestCombo'), String(score.bestCombo), u, cp * seg(t, T_SHIFTS, T_SHIFTS + 0.5))
  y += C.totalH

  // Bônus da colmeia: filete com rótulo.
  const bp = seg(t, T_BONUS - 0.4, T_BONUS)
  ctx.save()
  ctx.fillStyle = UI.ink
  ctx.globalAlpha = cp * bp * 0.75
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  setLetterSpacing(ctx, 1.5)
  const bl = tr('end.hiveBonus').toUpperCase()
  fitSize(ctx, bl, innerW - 60, 11 * u, 8.5)
  const blW = ctx.measureText(bl).width
  const lineY = y + C.bonusH / 2
  ctx.fillText(bl, card.x + card.w / 2, lineY)
  setLetterSpacing(ctx, 0)
  ctx.restore()
  drawGuideLine(ctx, card.x + padX, lineY, card.x + card.w / 2 - blW / 2 - 10, lineY, { alpha: 0.25 * bp })
  drawGuideLine(ctx, card.x + card.w / 2 + blW / 2 + 10, lineY, card.x + card.w - padX, lineY, { alpha: 0.25 * bp })
  y += C.bonusH

  // Mostradores de cada indicador com os pontos concedidos logo abaixo.
  score.items.forEach((it, i) => {
    const row = Math.floor(i / C.perRow)
    const col = i % C.perRow
    const dx = card.x + 16 + C.slot * (col + 0.5)
    const dy = y + C.radius + 7 + row * C.rowH
    const b = counts.bonus[i]
    const ind = indicatorOf(it.key)
    drawDial(ctx, dx, dy, C.radius, it.value, {
      label: tr(it.key),
      shortLabel: ind?.short ?? '',
      time: t,
      labelSize: C.labelSize,
      labelMaxWidth: C.slot - 6,
      reveal: b.reveal,
    })
    if (b.reveal <= 0) return
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = UI.sageShadow
    ctx.globalAlpha = b.reveal
    const pts = `+${formatScore(b.shown)}`
    fitSize(ctx, pts, C.slot - 6, C.ptsSize * (b.active ? 1.12 : 1), 10, { style: 'italic' })
    ctx.fillText(pts, dx, dy + C.radius + 11 + C.labelSize * 1.25)
    ctx.restore()
  })
}

function renderScorePage(context, ctx) {
  const completed = reason === 'completed'
  const M = computeScoreLayout(context, ctx)
  const { u } = M
  drawEmblem(ctx, context, M.cx, M.cy, M.R, completed)

  // Títulos.
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = UI.ink
  ctx.globalAlpha = seg(t, 0.6, 1.5)
  const title = tr(completed ? 'end.completedTitle' : 'end.lifeOverTitle')
  fitSize(ctx, title, M.titleW, M.titleSize, 18)
  ctx.fillText(title, M.titleX, M.titleY)
  ctx.globalAlpha = 0.88 * seg(t, 1.0, 2.0)
  ctx.font = font(M.subSize, { style: 'italic' })
  M.subLines.forEach((line, i) => ctx.fillText(line, M.titleX, M.titleY + M.titleSize * (M.side ? 0.8 : 0.85) + i * M.subLH))
  // Único acento rosa da página: filete sob o subtítulo.
  const ulW = 60 * seg(t, 1.4, 2.2)
  ctx.globalAlpha = 1
  ctx.strokeStyle = UI.pink
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(M.titleX - ulW, M.ulY)
  ctx.lineTo(M.titleX + ulW, M.ulY)
  ctx.stroke()
  ctx.restore()

  drawScoreCard(ctx, context, M)

  const ready = seg(t, T_DONE() - 0.4, T_DONE() + 0.4)
  if (ready > 0) {
    ctx.save()
    ctx.globalAlpha = ready
    drawButton(ctx, M.btn, tr('end.toBoard'), { focused: true, accent: false, time: t })
    ctx.restore()
    const hint = tr(isTouchUI(context) ? 'end.boardTapHint' : 'end.boardClickHint')
    if (M.side) {
      ctx.save()
      ctx.globalAlpha = 0.7 * ready
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.font = font(M.hintSize, { style: 'italic' })
      M.hintLines.forEach((line, i) => ctx.fillText(line, M.btn.x + M.btn.w / 2, M.btn.y + M.btn.h + 6 * u + M.hintSize + i * M.hintLH))
      ctx.restore()
    } else {
      drawHint(ctx, M.L, hint, ready)
    }
  }
}

function renderBoardPage(context, ctx) {
  const M = computeBoardLayout(context, ctx)
  const { u, head } = M
  const fade = seg(bt, 0, 0.5)
  const cx = head.x + head.w / 2
  ctx.save()
  ctx.globalAlpha = fade
  ctx.fillStyle = UI.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  let y = head.y + M.titleSize * 0.9
  fitSize(ctx, tr('score.board.title'), head.w, M.titleSize, 16)
  ctx.fillText(tr('score.board.title'), cx, y)
  y += M.scoreSize * 1.6
  const yourText = tr('end.yourScore', { n: formatScore(score.finalScore) })
  fitSize(ctx, yourText, head.w, M.scoreSize, 11, { style: 'italic' })
  ctx.fillText(yourText, cx, y)
  if (isRecord()) {
    y += M.noteSize * 1.6
    const rec = tr('score.board.newRecord')
    const size = fitSize(ctx, rec, head.w - 24, M.noteSize * 1.1, 10)
    const w = ctx.measureText(rec).width + 22
    ctx.save()
    ctx.fillStyle = UI.sunHalo
    ctx.globalAlpha = fade * (0.75 + 0.25 * Math.sin(bt * 3))
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(cx - w / 2, y - size * 1.05, w, size * 1.45, size * 0.7)
    else ctx.rect(cx - w / 2, y - size * 1.05, w, size * 1.45)
    ctx.fill()
    ctx.restore()
    ctx.fillText(rec, cx, y)
  } else if (prevBest > 0) {
    y += M.noteSize * 1.6
    ctx.globalAlpha = fade * 0.75
    const best = tr('score.board.best', { n: formatScore(prevBest) })
    fitSize(ctx, best, head.w, M.noteSize, 10, { style: 'italic' })
    ctx.fillText(best, cx, y)
  }
  ctx.restore()

  drawLeaderboard(ctx, M.table, boardRows(panel?.input.value ?? ''), { u, alpha: fade, time: bt })

  lastBoardSlot = M.panelRect
  if (naming) {
    positionPanel(context)
    return
  }
  const ready = seg(bt, 0.2, 0.8)
  if (M.btn && ready > 0) {
    ctx.save()
    ctx.globalAlpha = ready
    drawButton(ctx, M.btn, tr('end.backToMenu'), { focused: true, accent: false, time: bt })
    ctx.restore()
    const hint = tr(isTouchUI(context) ? 'end.tapHint' : 'end.clickHint')
    if (M.side) {
      ctx.save()
      ctx.globalAlpha = 0.7 * ready
      ctx.fillStyle = UI.ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      fitSize(ctx, hint, M.head.w, M.hintSize, 9, { style: 'italic' })
      ctx.fillText(hint, M.btn.x + M.btn.w / 2, M.btn.y + M.btn.h + 8 * u + M.hintSize)
      ctx.restore()
    } else {
      drawHint(ctx, M.L, hint, ready)
    }
  }
}

export default {
  enter(context, data = {}) {
    closePanel()
    t = 0
    bt = 0
    page = 'score'
    reason = data.reason === 'lifeOver' ? 'lifeOver' : 'completed'
    score = resolveScore(context, data)
    prevBest = leaderboard.best()
    canQualify = leaderboard.qualifies(score.finalScore)
    naming = false
    decided = false
    submitted = null
    lastBoardSlot = null
    context.input.consumeClicks()
  },

  update(context, dt) {
    t += dt
    const input = context.input
    const clicks = input.consumeClicks()
    if (page === 'score') {
      const pressed = clicks.length > 0 || anyKeyPressed(input, KEYS)
      if (!pressed || t < 0.3) return
      if (t < T_DONE()) t = T_DONE()
      else openBoard(context)
      return
    }
    bt += dt
    if (naming) {
      // Esc fora do campo também pula; toques no canvas apenas tiram o foco do campo.
      if (anyKeyPressed(input, ['Escape'])) decide(false)
      return
    }
    const pressed = clicks.length > 0 || anyKeyPressed(input, KEYS)
    if (pressed && bt >= 0.5) context.goTo('menu')
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    if (page === 'score') renderScorePage(context, ctx)
    else renderBoardPage(context, ctx)
    fadeScreen(ctx, w, h, (1 - seg(t, 0, 0.8)) * 0.9, UI.paper)
  },

  exit() {
    closePanel()
    naming = false
    lastBoardSlot = null
  },
}

