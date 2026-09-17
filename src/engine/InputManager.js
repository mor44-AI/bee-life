// API pública:
//   new InputManager(canvas)
//     Escuta eventos crus de ponteiro (mouse/toque/caneta) e teclado no canvas/window.
//     NÃO tem semântica de jogo (sem botões virtuais, sem drag-and-drop) - isso é
//     responsabilidade de quem consome (ex. src/ui/Controls.js, MovementController).
//
//   COORDENADAS: tudo já normalizado para o espaço "lógico" do canvas - o mesmo em
//   que o Renderer desenha (CSS px, canvas.width/devicePixelRatio), compensando
//   resize e DPI via getBoundingClientRect(). Convenção combinada com Renderer.js.
//
//   FONTE DE EVENTOS: usa SÓ Pointer Events quando o navegador os suporta; os
//   eventos touch* são registrados apenas como fallback em navegadores sem
//   PointerEvent. (Antes os dois rodavam juntos e cada toque era contado 2x.)
//
//   AVANÇO DE FRAME (novo): o loop do jogo deve chamar `input.endFrame()` UMA vez
//   por frame, DEPOIS de todos os consumidores lerem a entrada (ordem no harness/
//   main: controls.update -> machine.update -> input.endFrame). endFrame limpa as
//   bordas de tecla (wasKeyPressed) e os eventos de ponteiro do frame
//   (getFrameEvents). Eventos que chegam entre dois frames ficam guardados até o
//   próximo endFrame. Se ninguém chamar endFrame, as bordas nunca são limpas.
//
//   --- API legada (mantida, mesmo comportamento) ---
//   .getPointer() -> { x, y }
//     Posição do ponteiro primário (último ponteiro que se moveu/pressionou).
//   .isPointerDown() -> boolean   (algum ponteiro pressionado)
//   .isKeyDown(code) -> boolean
//     `code` é o event.code do KeyboardEvent (ex. 'ArrowUp', 'Space', 'KeyW').
//   .consumeClicks() -> Array<{ x, y, button }>
//     Retorna e limpa a fila de pressões discretas (1 por pointerdown/toque) desde a
//     última chamada. Independente de endFrame.
//   .destroy() -> void  Remove todos os listeners.
//
//   --- API nova ---
//   .getPointers() -> Array<{ id, x, y, startX, startY, startTime, isDown, pointerType }>
//     Ponteiros ATUALMENTE pressionados (multitoque real, um item por dedo), em
//     ordem de pressão. startTime em segundos (performance.now()/1000).
//     pointerType: 'mouse' | 'touch' | 'pen'.
//   .getFrameEvents() -> Array<{ type: 'down'|'up'|'cancel', id, x, y, startX, startY,
//                                startTime, time, pointerType, button }>
//     Eventos de ponteiro ocorridos desde o último endFrame (não consome; vários
//     leitores podem ler no mesmo frame).
//   .wasKeyPressed(code) -> boolean
//     true só no frame em que a tecla desceu (ignora auto-repeat do SO).
//   .wasKeyReleased(code) -> boolean
//   .lastInputType -> 'mouse' | 'touch' | 'pen' | 'keyboard'
//     Tipo do último input recebido (Controls usa para decidir `isTouch`).
//   .endFrame() -> void   Ver "AVANÇO DE FRAME".
//   .now() -> number      Relógio em segundos usado em startTime/time.

const PREVENT_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function nowSeconds() {
  return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000
}

export default class InputManager {
  constructor(canvas) {
    this.canvas = canvas
    this._pointer = { x: 0, y: 0 }
    this._pointers = new Map() // id -> ponteiro pressionado
    this._keys = new Set()
    this._pressed = new Set()
    this._released = new Set()
    this._frameEvents = []
    this._clickQueue = []
    this.lastInputType =
      typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
        ? 'touch'
        : 'mouse'

    this._bind()
  }

  now() {
    return nowSeconds()
  }

  _toCanvasCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const logicalWidth = this.canvas.width / dpr || rect.width
    const logicalHeight = this.canvas.height / dpr || rect.height
    const scaleX = rect.width > 0 ? logicalWidth / rect.width : 1
    const scaleY = rect.height > 0 ? logicalHeight / rect.height : 1

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  // --- núcleo comum (pointer events e fallback touch alimentam as mesmas funções) ---

  _down(id, clientX, clientY, pointerType, button = 0) {
    const p = this._toCanvasCoords(clientX, clientY)
    const t = nowSeconds()
    const ptr = { id, x: p.x, y: p.y, startX: p.x, startY: p.y, startTime: t, isDown: true, pointerType }
    this._pointers.set(id, ptr)
    this._pointer = { x: p.x, y: p.y }
    this.lastInputType = pointerType
    this._clickQueue.push({ x: p.x, y: p.y, button })
    this._frameEvents.push({ type: 'down', ...ptr, time: t, button })
  }

  _move(id, clientX, clientY, pointerType) {
    const p = this._toCanvasCoords(clientX, clientY)
    const ptr = this._pointers.get(id)
    if (ptr) {
      ptr.x = p.x
      ptr.y = p.y
      this._pointer = { x: p.x, y: p.y }
    } else if (pointerType === 'mouse') {
      // hover do mouse sem botão: atualiza a posição legada
      this._pointer = { x: p.x, y: p.y }
    }
  }

  _up(id, clientX, clientY, type = 'up') {
    const ptr = this._pointers.get(id)
    if (!ptr) return
    if (clientX != null) {
      const p = this._toCanvasCoords(clientX, clientY)
      ptr.x = p.x
      ptr.y = p.y
    }
    ptr.isDown = false
    this._pointers.delete(id)
    this._frameEvents.push({ type, ...ptr, time: nowSeconds(), button: 0 })
  }

  _bind() {
    const canvas = this.canvas
    const usePointer = typeof window !== 'undefined' && 'PointerEvent' in window
    this._usePointer = usePointer

    this._onKeyDown = (e) => {
      if (PREVENT_KEYS.has(e.code) && (e.target === document.body || e.target === canvas)) e.preventDefault()
      this.lastInputType = 'keyboard'
      if (!e.repeat && !this._keys.has(e.code)) this._pressed.add(e.code)
      this._keys.add(e.code)
    }
    this._onKeyUp = (e) => {
      if (this._keys.has(e.code)) this._released.add(e.code)
      this._keys.delete(e.code)
    }
    this._onBlur = () => {
      this._keys.clear()
      for (const id of [...this._pointers.keys()]) this._up(id, null, null, 'cancel')
    }
    this._onContextMenu = (e) => e.preventDefault()

    if (usePointer) {
      this._onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) {
          // botão direito/meio: só entra na fila legada de cliques
          const p = this._toCanvasCoords(e.clientX, e.clientY)
          this._clickQueue.push({ x: p.x, y: p.y, button: e.button })
          return
        }
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          /* alguns navegadores recusam captura - sem problema */
        }
        this._down(e.pointerId, e.clientX, e.clientY, e.pointerType || 'mouse', e.button)
      }
      this._onPointerMove = (e) => this._move(e.pointerId, e.clientX, e.clientY, e.pointerType || 'mouse')
      this._onPointerUp = (e) => this._up(e.pointerId, e.clientX, e.clientY, 'up')
      this._onPointerCancel = (e) => this._up(e.pointerId, e.clientX, e.clientY, 'cancel')

      canvas.addEventListener('pointerdown', this._onPointerDown)
      canvas.addEventListener('pointermove', this._onPointerMove)
      window.addEventListener('pointerup', this._onPointerUp)
      window.addEventListener('pointercancel', this._onPointerCancel)
    } else {
      // Fallback touch (sem PointerEvent) + mouse clássico.
      const each = (e, fn) => {
        for (const t of e.changedTouches) fn(t)
      }
      this._onTouchStart = (e) => {
        e.preventDefault()
        each(e, (t) => this._down(`t${t.identifier}`, t.clientX, t.clientY, 'touch'))
      }
      this._onTouchMove = (e) => {
        e.preventDefault()
        each(e, (t) => this._move(`t${t.identifier}`, t.clientX, t.clientY, 'touch'))
      }
      this._onTouchEnd = (e) => each(e, (t) => this._up(`t${t.identifier}`, t.clientX, t.clientY, 'up'))
      this._onTouchCancel = (e) => each(e, (t) => this._up(`t${t.identifier}`, t.clientX, t.clientY, 'cancel'))
      this._onMouseDown = (e) => this._down('mouse', e.clientX, e.clientY, 'mouse', e.button)
      this._onMouseMove = (e) => this._move('mouse', e.clientX, e.clientY, 'mouse')
      this._onMouseUp = (e) => this._up('mouse', e.clientX, e.clientY, 'up')

      canvas.addEventListener('touchstart', this._onTouchStart, { passive: false })
      canvas.addEventListener('touchmove', this._onTouchMove, { passive: false })
      canvas.addEventListener('touchend', this._onTouchEnd)
      canvas.addEventListener('touchcancel', this._onTouchCancel)
      canvas.addEventListener('mousedown', this._onMouseDown)
      canvas.addEventListener('mousemove', this._onMouseMove)
      window.addEventListener('mouseup', this._onMouseUp)
    }

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('blur', this._onBlur)
    canvas.addEventListener('contextmenu', this._onContextMenu)
  }

  // --- API legada ---

  getPointer() {
    return { x: this._pointer.x, y: this._pointer.y }
  }

  isPointerDown() {
    return this._pointers.size > 0
  }

  isKeyDown(code) {
    return this._keys.has(code)
  }

  consumeClicks() {
    const clicks = this._clickQueue
    this._clickQueue = []
    return clicks
  }

  // --- API nova ---

  getPointers() {
    return [...this._pointers.values()].map((p) => ({ ...p }))
  }

  getFrameEvents() {
    return this._frameEvents
  }

  wasKeyPressed(code) {
    return this._pressed.has(code)
  }

  wasKeyReleased(code) {
    return this._released.has(code)
  }

  endFrame() {
    this._pressed.clear()
    this._released.clear()
    this._frameEvents = []
  }

  destroy() {
    const canvas = this.canvas
    if (this._usePointer) {
      canvas.removeEventListener('pointerdown', this._onPointerDown)
      canvas.removeEventListener('pointermove', this._onPointerMove)
      window.removeEventListener('pointerup', this._onPointerUp)
      window.removeEventListener('pointercancel', this._onPointerCancel)
    } else {
      canvas.removeEventListener('touchstart', this._onTouchStart)
      canvas.removeEventListener('touchmove', this._onTouchMove)
      canvas.removeEventListener('touchend', this._onTouchEnd)
      canvas.removeEventListener('touchcancel', this._onTouchCancel)
      canvas.removeEventListener('mousedown', this._onMouseDown)
      canvas.removeEventListener('mousemove', this._onMouseMove)
      window.removeEventListener('mouseup', this._onMouseUp)
    }
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
    canvas.removeEventListener('contextmenu', this._onContextMenu)
  }
}
