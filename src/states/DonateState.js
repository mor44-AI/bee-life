// DonateState - "Apoiar o projeto": convite de doação com Pix (QR + chave copiável)
// e Binance Pay (QR + Pay ID copiável). Alcançado a partir de EndOfMarco1State.
// Toque/clique fora dos cartões, "Voltar" ou Esc -> goTo('menu').

import { UI, font, setLetterSpacing } from '../ui/IndicatorBar.js'
import {
  createPaperBackdrop,
  drawPaperCard,
  drawButton,
  pointInRect,
  wrapText,
  fadeScreen,
  screenLayout,
  safeRect,
  uiScaleOf,
  anyKeyPressed,
  isTouchUI,
  drawHint,
} from '../ui/HUD.js'
import { t as tr } from '../i18n/index.js'

const BASE = import.meta.env?.BASE_URL ?? '/'
const PIX_KEY = '14047991767'
const BINANCE_ID = 'User-e76fb'

function loadImage(src) {
  const img = new Image()
  img.src = src
  return img
}

const pixQR = loadImage(`${BASE}donate/pix-qr.png`)
const binanceQR = loadImage(`${BASE}donate/binance-qr.png`)

function imgReady(img) {
  return img.complete && img.naturalWidth > 0
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* falls through to legacy path */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return true
  } catch {
    return false
  }
}

const backdrop = createPaperBackdrop({ seed: 53 })
const KEYS = ['Escape']
let t = 0
let copiedId = null
let copiedT = 0
let lastPointer = null

function fitFont(ctx, text, maxW, size, min, opts) {
  ctx.font = font(size, opts)
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 0.5
    ctx.font = font(size, opts)
  }
  return size
}

function computeLayout(context, ctx) {
  const L = screenLayout(context)
  const S = safeRect(L)
  const u = uiScaleOf(L)
  const wide = S.w >= 680 && S.w > S.h

  const titleSize = Math.max(22, Math.min(34, S.w * 0.075))
  const inviteSize = Math.max(13 * u, 14)
  ctx.save()
  ctx.font = font(inviteSize, { style: 'italic' })
  const inviteLines = wrapText(ctx, tr('donate.invite'), Math.min(560, S.w - 48))
  ctx.restore()

  const backH = Math.max(L.minTouch ?? 56, Math.round(56 * u))
  const hintH = 26 * u
  const headerH = 18 * u + titleSize * 1.2 + 10 * u + inviteLines.length * inviteSize * 1.35 + 16 * u
  const gap = 14 * u
  const marginTop = S.y + 14 * u
  const marginBottom = S.y + S.h - backH - hintH - 12 * u

  const cardsTop = marginTop + headerH
  const cardsAvailH = Math.max(120, marginBottom - cardsTop - gap)
  const cardsAvailW = S.w - 32

  let cardW, cardH, card1, card2
  if (wide) {
    cardW = (cardsAvailW - gap) / 2
    cardH = cardsAvailH
    card1 = { x: S.x + 16, y: cardsTop, w: cardW, h: cardH }
    card2 = { x: S.x + 16 + cardW + gap, y: cardsTop, w: cardW, h: cardH }
  } else {
    cardW = Math.min(cardsAvailW, 420)
    cardH = (cardsAvailH - gap) / 2
    const cx = S.x + S.w / 2 - cardW / 2
    card1 = { x: cx, y: cardsTop, w: cardW, h: cardH }
    card2 = { x: cx, y: cardsTop + cardH + gap, w: cardW, h: cardH }
  }

  const btnW = Math.min(300, S.w - 40)
  const back = { x: S.x + S.w / 2 - btnW / 2, y: S.y + S.h - backH - 8 * u, w: btnW, h: backH }

  return { L, S, u, wide, titleSize, inviteSize, inviteLines, headerH, cardW, cardH, card1, card2, back, marginTop }
}

// Layout de cima para baixo (rótulo -> dica -> QR -> valor -> botão) para nunca sobrepor
// o QR com o texto, mesmo quando o cartão fica baixo (telas estreitas, dois cartões
// empilhados). Em telas muito baixas o QR encolhe até um mínimo (44px) antes de tudo mais.
function cardInner(card, u) {
  const pad = Math.max(10, 16 * u)
  const labelSize = Math.max(15, Math.min(19, card.w * 0.08))
  const hintSize = Math.max(11, labelSize * 0.62)
  const valueSize = Math.max(10, Math.min(13 * u, 15))
  const btnH = Math.max(38, Math.round(40 * u))
  const gap = 8 * u

  const labelY = card.y + pad + labelSize * 0.8
  const hintY = labelY + hintSize * 1.3
  const qrY = hintY + gap
  const qrMaxH = card.h - pad - (qrY - card.y) - gap - valueSize * 1.4 - gap - btnH - pad
  const qrSize = Math.max(44, Math.min(card.w - pad * 2, qrMaxH))
  const valueY = qrY + qrSize + gap + valueSize * 0.8
  const btnY = Math.min(valueY + gap + (btnH - valueSize * 0.8) * 0.5, card.y + card.h - pad - btnH)
  const btnW = Math.min(160, card.w - pad * 2)
  const copyBtn = { x: card.x + (card.w - btnW) / 2, y: btnY, w: btnW, h: btnH }

  return { pad, labelSize, hintSize, valueSize, gap, labelY, hintY, qrY, qrSize, valueY, copyBtn }
}

export default {
  enter(context) {
    t = 0
    copiedId = null
    copiedT = 0
    context.input.consumeClicks()
    lastPointer = context.input.getPointer()
  },

  update(context, dt) {
    t += dt
    if (copiedId && (t - copiedT) > 1.6) copiedId = null

    const ctx = context.renderer?.getContext?.()
    if (!ctx) return
    const M = computeLayout(context, ctx)
    const input = context.input
    const clicks = input.consumeClicks()

    if (anyKeyPressed(input, KEYS)) {
      context.goTo('menu')
      return
    }

    const { pad: pad1, copyBtn: copyBtn1 } = cardInner(M.card1, M.u)
    const { copyBtn: copyBtn2 } = cardInner(M.card2, M.u)
    void pad1

    for (const c of clicks) {
      if (pointInRect(c, copyBtn1)) {
        copyToClipboard(PIX_KEY)
        copiedId = 'pix'
        copiedT = t
        return
      }
      if (pointInRect(c, copyBtn2)) {
        copyToClipboard(BINANCE_ID)
        copiedId = 'binance'
        copiedT = t
        return
      }
      if (pointInRect(c, M.back)) {
        context.goTo('menu')
        return
      }
      if (!pointInRect(c, M.card1) && !pointInRect(c, M.card2) && !pointInRect(c, M.back)) {
        context.goTo('menu')
        return
      }
    }
  },

  render(context, ctx) {
    const w = context.width
    const h = context.height
    backdrop.draw(ctx, 0, 0, w, h)
    const M = computeLayout(context, ctx)
    const { S, u, titleSize, inviteSize, inviteLines, marginTop } = M
    const cx = S.x + S.w / 2

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = UI.ink
    let ty = marginTop + titleSize
    fitFont(ctx, tr('donate.title'), S.w - 32, titleSize, 18)
    ctx.fillText(tr('donate.title'), cx, ty)
    ctx.globalAlpha = 0.88
    ctx.font = font(inviteSize, { style: 'italic' })
    ty += 10 * u + inviteSize
    inviteLines.forEach((line, i) => ctx.fillText(line, cx, ty + i * inviteSize * 1.35))
    ctx.restore()

    drawDonateCard(ctx, M.card1, u, {
      label: tr('donate.pixLabel'),
      hint: tr('donate.pixHint'),
      valueText: tr('donate.pixKey', { key: PIX_KEY }),
      img: pixQR,
      copyLabel: copiedId === 'pix' ? tr('donate.copied') : tr('donate.copy'),
      justCopied: copiedId === 'pix',
      seed: 71,
    })
    drawDonateCard(ctx, M.card2, u, {
      label: tr('donate.binanceLabel'),
      hint: tr('donate.binanceHint'),
      valueText: tr('donate.binanceId', { id: BINANCE_ID }),
      img: binanceQR,
      copyLabel: copiedId === 'binance' ? tr('donate.copied') : tr('donate.copy'),
      justCopied: copiedId === 'binance',
      seed: 82,
    })

    drawButton(ctx, M.back, tr('donate.back'), { focused: true, time: t })
    drawHint(ctx, M.L, tr(isTouchUI(context) ? 'donate.tapHint' : 'donate.clickHint'), 0.8)

    fadeScreen(ctx, w, h, (1 - Math.min(1, t / 0.5)) * 0.9, UI.paper)
  },

  exit() {},
}

function drawDonateCard(ctx, card, u, opts) {
  const { label, hint, valueText, img, copyLabel, justCopied, seed } = opts
  const { pad, labelSize, hintSize, valueSize, qrY, qrSize, valueY, copyBtn } = cardInner(card, u)
  drawPaperCard(ctx, card.x, card.y, card.w, card.h, { seed })
  const cx = card.x + card.w / 2

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = UI.ink
  ctx.font = font(labelSize)
  setLetterSpacing(ctx, 1)
  ctx.fillText(label, cx, card.y + pad + labelSize * 0.8)
  setLetterSpacing(ctx, 0)
  ctx.globalAlpha = 0.75
  ctx.font = font(hintSize, { style: 'italic' })
  ctx.fillText(hint, cx, card.y + pad + labelSize * 0.8 + hintSize * 1.3)
  ctx.restore()

  const qrX = card.x + (card.w - qrSize) / 2
  ctx.save()
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(qrX, qrY, qrSize, qrSize)
  if (imgReady(img)) ctx.drawImage(img, qrX, qrY, qrSize, qrSize)
  ctx.strokeStyle = UI.ink
  ctx.globalAlpha = 0.25
  ctx.lineWidth = 1
  ctx.strokeRect(qrX + 0.5, qrY + 0.5, qrSize - 1, qrSize - 1)
  ctx.restore()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = UI.ink
  const fitSize = fitFont(ctx, valueText, card.w - pad * 2, valueSize, 9)
  ctx.font = font(fitSize)
  ctx.fillText(valueText, cx, valueY)
  ctx.restore()

  drawButton(ctx, copyBtn, copyLabel, { size: Math.max(12, Math.min(16, copyBtn.h * 0.38)), accent: justCopied })
}
