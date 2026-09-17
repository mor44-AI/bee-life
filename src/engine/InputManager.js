// API pública:
//   new InputManager(canvas)
//     Escuta eventos crus de mouse/ponteiro, toque e teclado no canvas/window.
//     NÃO tem semântica de jogo (sem drag-and-drop, sem "arrastar item" etc.) —
//     isso é responsabilidade de quem consome (ex. MovementController).
//   .getPointer() -> { x, y }
//     Posição atual do ponteiro (mouse ou primeiro toque) já normalizada para o
//     espaço de coordenadas "lógico" do canvas — o mesmo espaço em que o Renderer
//     desenha (CSS px, ou seja, canvas.width/devicePixelRatio), compensando resize
//     e DPI via getBoundingClientRect(). Convenção combinada com Renderer.js.
//   .isPointerDown() -> boolean
//   .isKeyDown(code) -> boolean
//     `code` é o event.code do KeyboardEvent (ex. 'ArrowUp', 'Space', 'KeyW').
//   .consumeClicks() -> Array<{ x, y, button }>
//     Retorna e limpa a fila de cliques/toques discretos ocorridos desde a última
//     chamada (coordenadas já normalizadas, ver getPointer).
//   .destroy() -> void
//     Remove todos os listeners registrados.

export default class InputManager {
  constructor(canvas) {
    this.canvas = canvas
    this._pointer = { x: 0, y: 0 }
    this._pointerDown = false
    this._keys = new Set()
    this._clickQueue = []

    this._bind()
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

  _bind() {
    const canvas = this.canvas

    this._onPointerMove = (e) => {
      this._pointer = this._toCanvasCoords(e.clientX, e.clientY)
    }
    this._onPointerDown = (e) => {
      const p = this._toCanvasCoords(e.clientX, e.clientY)
      this._pointer = p
      this._pointerDown = true
      this._clickQueue.push({ x: p.x, y: p.y, button: e.button })
    }
    this._onPointerUp = () => {
      this._pointerDown = false
    }

    this._onKeyDown = (e) => {
      this._keys.add(e.code)
    }
    this._onKeyUp = (e) => {
      this._keys.delete(e.code)
    }

    // Fallback de touch para navegadores/casos sem suporte completo a Pointer Events.
    this._onTouchStart = (e) => {
      if (e.touches.length === 0) return
      const t = e.touches[0]
      const p = this._toCanvasCoords(t.clientX, t.clientY)
      this._pointer = p
      this._pointerDown = true
      this._clickQueue.push({ x: p.x, y: p.y, button: 0 })
    }
    this._onTouchMove = (e) => {
      if (e.touches.length === 0) return
      const t = e.touches[0]
      this._pointer = this._toCanvasCoords(t.clientX, t.clientY)
    }
    this._onTouchEnd = () => {
      this._pointerDown = false
    }

    canvas.addEventListener('pointermove', this._onPointerMove)
    canvas.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointerup', this._onPointerUp)

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)

    canvas.addEventListener('touchstart', this._onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: true })
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: true })
  }

  getPointer() {
    return { x: this._pointer.x, y: this._pointer.y }
  }

  isPointerDown() {
    return this._pointerDown
  }

  isKeyDown(code) {
    return this._keys.has(code)
  }

  consumeClicks() {
    const clicks = this._clickQueue
    this._clickQueue = []
    return clicks
  }

  destroy() {
    const canvas = this.canvas
    canvas.removeEventListener('pointermove', this._onPointerMove)
    canvas.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointerup', this._onPointerUp)

    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)

    canvas.removeEventListener('touchstart', this._onTouchStart)
    canvas.removeEventListener('touchmove', this._onTouchMove)
    canvas.removeEventListener('touchend', this._onTouchEnd)
  }
}
