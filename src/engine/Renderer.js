// API pública:
//   new Renderer(canvasSelector = '#game-canvas')
//     Localiza o elemento canvas no DOM (aceita seletor string ou o próprio elemento),
//     pega o contexto 2D, e mantém o canvas redimensionado para
//     window.innerWidth/innerHeight com correção de devicePixelRatio.
//     Convenção: após o setup, ctx.setTransform aplica a escala de DPI - todo desenho
//     subsequente usa coordenadas "lógicas" (CSS px, 0..innerWidth / 0..innerHeight),
//     não pixels físicos do backing store. InputManager.js segue a mesma convenção
//     para normalizar coordenadas de ponteiro.
//   .resize() -> void
//     Reaplica o cálculo de tamanho/DPI. Chamado automaticamente no construtor e no
//     evento window resize.
//   .clear(color) -> void
//     Limpa o canvas inteiro. Sem argumento, usa clearRect (transparente); com uma cor,
//     preenche o fundo com fillRect.
//   .getContext() -> CanvasRenderingContext2D
//   .width / .height -> number (tamanho lógico atual, CSS px)
//   .canvas -> HTMLCanvasElement
//   .destroy() -> void (remove o listener de resize)

export default class Renderer {
  constructor(canvasSelector = '#game-canvas') {
    this.canvas =
      typeof canvasSelector === 'string' ? document.querySelector(canvasSelector) : canvasSelector

    if (!this.canvas) {
      throw new Error(`Renderer: elemento não encontrado para "${canvasSelector}"`)
    }

    this.ctx = this.canvas.getContext('2d')
    this.dpr = window.devicePixelRatio || 1
    this.width = 0
    this.height = 0

    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)

    this.resize()
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    this.dpr = dpr
    this.width = window.innerWidth
    this.height = window.innerHeight

    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  clear(color) {
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (color) {
      this.ctx.fillStyle = color
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    } else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
    this.ctx.restore()
  }

  getContext() {
    return this.ctx
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)
  }
}
