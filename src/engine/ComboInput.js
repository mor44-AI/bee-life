// API pública:
//   create({ sequence = [], timeLimit = Infinity, clock = 'wall' }) -> combo (também default export)
//     sequence: array de inputs esperados, em ordem, comparados por igualdade estrita
//       (ex. ['up', 'up', 'down', 'A']).
//     timeLimit: segundos permitidos entre o primeiro .feed() e a conclusão da
//       sequência (relógio de parede via performance.now/Date.now — este módulo não
//       tem .update(dt); a contagem de tempo é independente do loop do jogo).
//     clock: 'wall' (padrão, comportamento antigo: performance.now) ou 'game' — usa o
//       tempo do jogo acumulado por combo.update(dt) (pausa/câmera lenta respeitadas).
//       No modo 'game', update(dt) também marca .failed quando o tempo estoura
//       mesmo sem nova entrada.
//   combo.update(dt) -> void  (só tem efeito com clock: 'game')
//   combo.index -> number (quantas entradas já acertou)
//   combo.progress -> number 0–1 (index / sequence.length)
//   combo.timeElapsed -> number (s desde o primeiro feed; 0 antes dele)
//   combo.timeRemaining -> number (s restantes; Infinity sem timeLimit)
//   combo.feed(input) -> void
//     Alimenta uma entrada. Se não bater com o próximo esperado, ou se o timeLimit
//     estourar, marca .failed = true. Ao completar toda a sequência, .isComplete = true.
//     Chamadas após completar ou falhar são ignoradas.
//   combo.isComplete -> boolean
//   combo.failed -> boolean
//   combo.reset() -> void

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

export function create({ sequence = [], timeLimit = Infinity, clock = 'wall' } = {}) {
  const useGame = clock === 'game'
  const combo = {
    isComplete: false,
    failed: false,
    _index: 0,
    _startedAt: null,
    _gameTime: 0,

    _now() {
      return useGame ? this._gameTime * 1000 : now()
    },

    get index() {
      return this._index
    },

    get progress() {
      return sequence.length ? this._index / sequence.length : 1
    },

    get timeElapsed() {
      return this._startedAt === null ? 0 : (this._now() - this._startedAt) / 1000
    },

    get timeRemaining() {
      return timeLimit === Infinity ? Infinity : Math.max(0, timeLimit - this.timeElapsed)
    },

    update(dt) {
      if (!useGame) return
      this._gameTime += dt || 0
      if (
        !this.isComplete &&
        !this.failed &&
        this._startedAt !== null &&
        timeLimit !== Infinity &&
        this.timeElapsed > timeLimit
      ) {
        this.failed = true
      }
    },

    feed(input) {
      if (this.isComplete || this.failed) return

      const t = this._now()
      if (this._startedAt === null) {
        this._startedAt = t
      } else if (timeLimit !== Infinity && (t - this._startedAt) / 1000 > timeLimit) {
        this.failed = true
        return
      }

      const expected = sequence[this._index]
      if (input !== expected) {
        this.failed = true
        return
      }

      this._index += 1
      if (this._index >= sequence.length) {
        this.isComplete = true
      }
    },

    reset() {
      this.isComplete = false
      this.failed = false
      this._index = 0
      this._startedAt = null
    },
  }

  return combo
}

export default create
