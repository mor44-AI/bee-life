// layout — layout responsivo comum a todas as telas/tarefas. Vertical (celular em
// pé) é o formato de DESIGN; tela deitada (PC, tablet, celular deitado) centraliza
// o campo de jogo e manda os botões para as laterais.
//
// API pública:
//   getLayout(width, height, { safe } = {}) -> layout
//     width/height: tamanho lógico do canvas (renderer.width/height, CSS px).
//     safe (opcional): { top, right, bottom, left } — se omitido, lido das CSS vars
//       --safe-top/--safe-right/--safe-bottom/--safe-left (ver installViewportGuards),
//       com fallback 0 fora do navegador.
//     layout = {
//       width, height,
//       orientation: 'portrait' | 'landscape',
//       safe: { top, right, bottom, left },
//       hudBar:     { x, y, w, h }  faixa do HUD no topo (abaixo do notch).
//       playfield:  { x, y, w, h }  área do jogo propriamente dita. Tarefas devem
//                                   desenhar/posicionar o mundo AQUI (o fundo pode
//                                   vazar para a tela toda).
//       controlBar: { x, y, w, h }  área dos botões principais (Ação/Especial).
//                                   portrait: faixa na base (zona do polegar).
//                                   landscape: painel lateral direito.
//       thumbLeft / thumbRight: { x, y, w, h }
//                                   zonas de polegar esquerda/direita. portrait: metades
//                                   da controlBar; landscape: parte de baixo dos painéis
//                                   laterais. Controls põe Ação/Especial na direita e as
//                                   direções (se ativas) na esquerda.
//       sideLeft / sideRight: { x, y, w, h } | null   painéis laterais (só landscape).
//       uiScale: number   escala sugerida para fonte/ícones (~1 num celular de 390px).
//       minTouch: number  lado mínimo (px lógicos) de qualquer alvo de toque = 56.
//     }
//   installViewportGuards(canvas?) -> void
//     Idempotente. Garante, pelo JS, o que index.html já faz no CSS (útil em páginas
//     de preview): meta viewport com viewport-fit=cover e sem zoom; CSS vars
//     --safe-* = env(safe-area-inset-*); touch-action/overscroll/user-select none;
//     bloqueia menu de contexto, gesto de pinça (gesturestart no iOS) e duplo toque.
//   readSafeArea() -> { top, right, bottom, left }
//   pointInRect(x, y, rect) -> boolean

export const MIN_TOUCH = 56

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) })

export function pointInRect(x, y, r) {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

export function readSafeArea() {
  const safe = { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return safe
  try {
    const cs = getComputedStyle(document.documentElement)
    for (const k of Object.keys(safe)) {
      const v = parseFloat(cs.getPropertyValue(`--safe-${k}`))
      safe[k] = Number.isFinite(v) ? v : 0
    }
  } catch {
    /* fallback 0 */
  }
  return safe
}

export function getLayout(width, height, opts = {}) {
  const safe = { top: 0, right: 0, bottom: 0, left: 0, ...(opts.safe || readSafeArea()) }
  const orientation = width > height ? 'landscape' : 'portrait'
  const uiScale = clamp(Math.min(width, height) / 400, 0.85, 1.5)

  const ix = safe.left
  const iy = safe.top
  const iw = Math.max(0, width - safe.left - safe.right)
  const ih = Math.max(0, height - safe.top - safe.bottom)
  const hudH = clamp(Math.round(50 * uiScale), 46, 70)

  const hudBar = rect(ix, iy, iw, hudH)
  let playfield, controlBar, thumbLeft, thumbRight
  let sideLeft = null
  let sideRight = null

  if (orientation === 'portrait') {
    const cbH = clamp(Math.round(ih * 0.21), 140, 210)
    controlBar = rect(ix, iy + ih - cbH, iw, cbH)
    playfield = rect(ix, iy + hudH, iw, ih - hudH - cbH)
    thumbLeft = rect(controlBar.x, controlBar.y, controlBar.w / 2, controlBar.h)
    thumbRight = rect(controlBar.x + controlBar.w / 2, controlBar.y, controlBar.w / 2, controlBar.h)
  } else {
    const sideW = clamp(Math.round(iw * 0.17), 150, 280)
    const top = iy + hudH
    const h = ih - hudH
    sideLeft = rect(ix, top, sideW, h)
    sideRight = rect(ix + iw - sideW, top, sideW, h)
    playfield = rect(ix + sideW, top, iw - sideW * 2, h)
    controlBar = sideRight
    const thumbH = clamp(Math.round(h * 0.55), 150, 320)
    thumbLeft = rect(sideLeft.x, top + h - Math.min(thumbH, h), sideW, Math.min(thumbH, h))
    thumbRight = rect(sideRight.x, top + h - Math.min(thumbH, h), sideW, Math.min(thumbH, h))
  }

  return {
    width,
    height,
    orientation,
    safe,
    hudBar,
    playfield,
    controlBar,
    thumbLeft,
    thumbRight,
    sideLeft,
    sideRight,
    uiScale,
    minTouch: MIN_TOUCH,
  }
}

let guardsInstalled = false

export function installViewportGuards(canvas = null) {
  if (typeof document === 'undefined') return
  if (!guardsInstalled) {
    guardsInstalled = true

    let meta = document.querySelector('meta[name="viewport"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'viewport'
      document.head.appendChild(meta)
    }
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'

    if (!document.getElementById('vda-viewport-guards')) {
      const style = document.createElement('style')
      style.id = 'vda-viewport-guards'
      style.textContent = `
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
html, body {
  overflow: hidden; overscroll-behavior: none; touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
canvas { touch-action: none; -webkit-user-select: none; user-select: none; }`
      document.head.appendChild(style)
    }

    const prevent = (e) => e.preventDefault()
    document.addEventListener('gesturestart', prevent, { passive: false })
    document.addEventListener('gesturechange', prevent, { passive: false })
    document.addEventListener('dblclick', prevent, { passive: false })
    document.addEventListener('selectstart', prevent)
    document.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches && e.touches.length > 1) e.preventDefault()
      },
      { passive: false }
    )
  }
  if (canvas && !canvas.__vdaGuards) {
    canvas.__vdaGuards = true
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    canvas.style.touchAction = 'none'
  }
}
