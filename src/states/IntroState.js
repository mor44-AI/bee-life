// IntroState - abertura em vídeo (public/video/intro.mp4, vertical 720×1280, com som).
// Um <video> DOM fica sobre o canvas. Como navegadores bloqueiam autoplay com áudio,
// primeiro aparece "Toque/Clique para começar": esse gesto inicia o vídeo com som e
// também desbloqueia o AudioSystem (main.js escuta pointerdown/keydown na window).
// "Pular" (ou Esc/Enter/Espaço) e o fim do vídeo levam ao menu. Toca sozinho só na
// primeira visita (flag em localStorage); o menu reabre com goTo('intro', { replay: true }).
// Se o arquivo faltar ou não ficar reproduzível em LOAD_TIMEOUT_MS, segue para o menu.

import { UI } from '../ui/IndicatorBar.js'
import { anyKeyPressed, isTouchUI } from '../ui/HUD.js'

export const INTRO_SEEN_KEY = 'vida-de-abelha.intro-seen.v1'
const LOAD_TIMEOUT_MS = 8000
const START_KEYS = ['Enter', 'NumpadEnter', 'Space']
const SKIP_KEYS = ['Escape', ...START_KEYS]
const BASE = import.meta.env?.BASE_URL ?? '/'
const VIDEO_SRC = `${BASE}video/intro.mp4`
const POSTER_SRC = `${BASE}video/intro-poster.jpg`

function defaultStorage() {
  try { return globalThis.localStorage } catch { return undefined }
}

/** true se a abertura já foi vista. Storage indisponível conta como "não vista". */
export function hasSeenIntro(storage = defaultStorage()) {
  try { return storage?.getItem(INTRO_SEEN_KEY) === '1' } catch { return false }
}

/** Marca a abertura como vista; falhas de storage são ignoradas. */
export function markIntroSeen(storage = defaultStorage()) {
  try { storage?.setItem(INTRO_SEEN_KEY, '1') } catch { /* Modo privado/cheio: só não lembra. */ }
}

/** A abertura toca automaticamente só se nunca foi vista, ou quando pedida pelo menu. */
export function shouldPlayIntro({ replay = false, storage } = {}) {
  return replay || !hasSeenIntro(storage)
}

const CSS = `
.intro-root{position:fixed;inset:0;z-index:10;background:#1a1410;overflow:hidden;
  font-family:${UI.serif};color:${UI.ink};touch-action:manipulation}
.intro-root video{position:absolute;top:var(--safe-top,0px);right:var(--safe-right,0px);
  bottom:var(--safe-bottom,0px);left:var(--safe-left,0px);width:calc(100% - var(--safe-left,0px) - var(--safe-right,0px));
  height:calc(100% - var(--safe-top,0px) - var(--safe-bottom,0px));object-fit:contain;background:#1a1410}
.intro-start{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  gap:14px;padding:24px 20px calc(var(--safe-bottom,0px) + 112px);cursor:pointer;
  background:linear-gradient(to bottom,rgba(26,20,16,0) 45%,rgba(26,20,16,.72))}
.intro-btn{font:inherit;color:${UI.ink};background:${UI.paper};border:1.5px solid ${UI.ink};border-radius:6px;
  min-height:56px;box-shadow:2px 3px 0 rgba(26,20,16,.45);cursor:pointer;-webkit-tap-highlight-color:transparent}
.intro-btn:active{transform:translateY(1px);box-shadow:1px 2px 0 rgba(26,20,16,.45)}
.intro-play{font-size:22px;padding:0 34px;min-width:min(320px,100%)}
.intro-sub{color:${UI.paper};font-style:italic;font-size:15px;opacity:.85;text-align:center}
.intro-skip{position:absolute;right:calc(var(--safe-right,0px) + 16px);bottom:calc(var(--safe-bottom,0px) + 20px);
  font-size:19px;min-width:120px;padding:0 22px;opacity:.92}
`

let ui = null // { root, video, start, abort, timer }
let exitRequested = false

function clearTimer() {
  if (ui?.timer) clearTimeout(ui.timer)
  if (ui) ui.timer = 0
}

function requestExit() { exitRequested = true }

function startVideo() {
  if (!ui || !ui.start.isConnected) return
  const { video } = ui
  ui.start.remove()
  markIntroSeen()
  clearTimer()
  // Sem ficar reproduzível a tempo (arquivo lento/ausente), segue para o menu.
  ui.timer = setTimeout(requestExit, LOAD_TIMEOUT_MS)
  video.muted = ui.muted
  const played = video.play()
  played?.catch?.(() => {
    // Autoplay com som recusado mesmo após o gesto: tenta sem som antes de desistir.
    if (!ui || ui.video !== video) return
    video.muted = true
    video.play()?.catch?.(requestExit)
  })
}

function buildUI(context) {
  const abort = new AbortController()
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal })
  const root = document.createElement('div')
  root.className = 'intro-root'
  const style = document.createElement('style')
  style.textContent = CSS
  const video = document.createElement('video')
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.poster = POSTER_SRC
  video.src = VIDEO_SRC

  const start = document.createElement('div')
  start.className = 'intro-start'
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'intro-btn intro-play'
  // Na primeira carga ainda não houve input: usa o tipo de ponteiro do aparelho.
  const touch = isTouchUI(context) || !!globalThis.matchMedia?.('(pointer: coarse)').matches
  play.textContent = touch ? 'Toque para começar' : 'Clique para começar'
  const sub = document.createElement('p')
  sub.className = 'intro-sub'
  sub.textContent = 'abertura com som'
  start.append(play, sub)

  const skip = document.createElement('button')
  skip.type = 'button'
  skip.className = 'intro-btn intro-skip'
  skip.textContent = 'Pular'

  root.append(style, video, start, skip)
  document.body.append(root)

  on(start, 'click', () => {
    void context.audio?.unlock?.()
    startVideo()
  })
  on(skip, 'click', (e) => {
    e.stopPropagation()
    markIntroSeen()
    requestExit()
  })
  on(video, 'playing', clearTimer)
  on(video, 'ended', requestExit)
  on(video, 'error', requestExit)
  // main.js para o loop ao ocultar a aba; o vídeo segue o mesmo ritmo.
  let resumeOnShow = false
  on(document, 'visibilitychange', () => {
    if (!ui) return
    if (document.hidden) {
      resumeOnShow = !video.paused && !video.ended
      video.pause()
    } else if (resumeOnShow) {
      resumeOnShow = false
      video.play()?.catch?.(() => {})
    }
  })
  return { root, video, start, abort, timer: 0, muted: context.audio?.muted === true }
}

function destroyUI() {
  if (!ui) return
  clearTimer()
  ui.abort.abort()
  const { video, root } = ui
  ui = null
  video.pause()
  video.removeAttribute('src')
  video.removeAttribute('poster')
  video.load()
  root.remove()
}

if (import.meta.hot) import.meta.hot.dispose(destroyUI)

export default {
  enter(context, data) {
    destroyUI()
    exitRequested = false
    if (typeof document === 'undefined' || !shouldPlayIntro({ replay: data?.replay })) {
      context.goTo('menu')
      return
    }
    ui = buildUI(context)
  },
  update(context) {
    if (ui && !exitRequested) {
      if (ui.start.isConnected) {
        if (anyKeyPressed(context.input, ['Escape'])) { markIntroSeen(); requestExit() }
        else if (anyKeyPressed(context.input, START_KEYS)) startVideo()
      } else if (anyKeyPressed(context.input, SKIP_KEYS)) requestExit()
    }
    context.input.consumeClicks()
    if (exitRequested) {
      exitRequested = false
      context.goTo('menu')
    }
  },
  render(context, ctx) {
    ctx.fillStyle = '#1a1410'
    ctx.fillRect(0, 0, context.width, context.height)
  },
  exit() {
    destroyUI()
  },
}
