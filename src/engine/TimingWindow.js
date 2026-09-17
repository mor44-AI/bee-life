// API pública:
//   create({ periodRange = [1, 2], windowSize = 0.3, jitter = 0.25 })
//     -> timingWindow (também default export)
//     periodRange: [min, max] segundos entre o fim de uma janela e a abertura da
//       próxima — sorteado a cada ciclo (Math.random), não é um metrônomo fixo.
//     windowSize: duração base (segundos) em que a janela fica aberta; também recebe
//       variação orgânica de até `jitter` (fração) a cada abertura.
//   timingWindow.update(dt) -> void
//     Avança o relógio interno e alterna entre fases fechada/aberta.
//   timingWindow.isOpen -> boolean
//   timingWindow.elapsed -> number (relógio interno acumulado, em segundos)
//   timingWindow.judge(actionTime = this.elapsed) -> 'perfect' | 'good' | 'miss'
//     Julga uma ação ocorrida em `actionTime` (mesma linha do tempo de .elapsed;
//     se omitido, usa o instante atual) contra a janela aberta mais recente.
//     Fora da janela = 'miss'; dentro, perto do centro = 'perfect', senão 'good'.
//   --- leitura pública (getters; evite ler os campos _privados) ---
//   timingWindow.phase -> 'closed' | 'open'
//   timingWindow.timeUntilOpen -> number (s até abrir; 0 quando aberta)
//   timingWindow.timeUntilClose -> number (s até fechar; 0 quando fechada)
//   timingWindow.openProgress -> number 0–1 (progresso DENTRO da janela aberta; 0 fechada)
//   timingWindow.closedProgress -> number 0–1 (progresso da espera fechada; 0 aberta)
//   timingWindow.windowDuration -> number (duração da janela atual/mais recente, s)
//   timingWindow.timeToCenter -> number (s até o centro da próxima/atual janela;
//     negativo = centro já passou). Com a janela fechada usa windowSize nominal.
//   Campos _closedDuration/_phaseTime/_windowStart/_windowEnd continuam existindo
//   (compatibilidade), mas são internos.

function randomInRange([min, max]) {
  return min + Math.random() * (max - min)
}

export function create({ periodRange = [1, 2], windowSize = 0.3, jitter = 0.25 } = {}) {
  const timingWindow = {
    elapsed: 0,
    isOpen: false,
    _phaseTime: 0,
    _closedDuration: randomInRange(periodRange),
    _windowStart: 0,
    _windowEnd: 0,

    update(dt) {
      this.elapsed += dt
      this._phaseTime += dt

      if (!this.isOpen) {
        if (this._phaseTime >= this._closedDuration) {
          this.isOpen = true
          this._phaseTime = 0
          const jitteredSize = windowSize * (1 + (Math.random() * 2 - 1) * jitter)
          this._windowStart = this.elapsed
          this._windowEnd = this.elapsed + Math.max(jitteredSize, 0.01)
        }
      } else if (this._phaseTime >= this._windowEnd - this._windowStart) {
        this.isOpen = false
        this._phaseTime = 0
        this._closedDuration = randomInRange(periodRange)
      }
    },

    get phase() {
      return this.isOpen ? 'open' : 'closed'
    },

    get timeUntilOpen() {
      return this.isOpen ? 0 : Math.max(0, this._closedDuration - this._phaseTime)
    },

    get timeUntilClose() {
      return this.isOpen ? Math.max(0, this._windowEnd - this.elapsed) : 0
    },

    get windowDuration() {
      return this._windowEnd > this._windowStart ? this._windowEnd - this._windowStart : windowSize
    },

    get openProgress() {
      if (!this.isOpen) return 0
      const total = this._windowEnd - this._windowStart
      return total > 0 ? Math.min(1, Math.max(0, (this.elapsed - this._windowStart) / total)) : 0
    },

    get closedProgress() {
      if (this.isOpen || !(this._closedDuration > 0)) return 0
      return Math.min(1, Math.max(0, this._phaseTime / this._closedDuration))
    },

    get timeToCenter() {
      if (this.isOpen) return (this._windowStart + this._windowEnd) / 2 - this.elapsed
      return this.timeUntilOpen + windowSize / 2
    },

    judge(actionTime = this.elapsed) {
      const start = this._windowStart
      const end = this._windowEnd

      if (actionTime < start || actionTime > end) {
        return 'miss'
      }

      const center = (start + end) / 2
      const halfWidth = (end - start) / 2 || 0.0001
      const distanceRatio = Math.abs(actionTime - center) / halfWidth

      return distanceRatio <= 0.4 ? 'perfect' : 'good'
    },
  }

  return timingWindow
}

export default create
