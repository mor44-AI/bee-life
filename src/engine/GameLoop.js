// API pública:
//   create({ update(dt), render(), maxDt = 0.1 }) -> loop (também default export)
//     update(dt): chamado a cada frame com o delta time em segundos.
//     render(): chamado a cada frame após update, sem argumentos.
//     maxDt: teto para dt (segundos) - evita saltos grandes de simulação quando a
//       aba fica em segundo plano ou o frame demora demais.
//   loop.start() -> void
//     Inicia (ou reinicia) o requestAnimationFrame. Idempotente se já rodando.
//   loop.stop() -> void
//     Cancela o requestAnimationFrame agendado.
//   loop.isRunning -> boolean (getter)

export function create({ update = () => {}, render = () => {}, maxDt = 0.1 } = {}) {
  let rafId = null
  let lastTime = null
  let running = false

  function frame(timestamp) {
    if (!running) return

    if (lastTime === null) lastTime = timestamp
    let dt = (timestamp - lastTime) / 1000
    lastTime = timestamp
    if (dt > maxDt) dt = maxDt

    update(dt)
    render()

    rafId = requestAnimationFrame(frame)
  }

  function start() {
    if (running) return
    running = true
    lastTime = null
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return {
    start,
    stop,
    get isRunning() {
      return running
    },
  }
}

export default create
