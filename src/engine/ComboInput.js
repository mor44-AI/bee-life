// API pública:
//   create({ sequence = [], timeLimit = Infinity }) -> combo (também default export)
//     sequence: array de inputs esperados, em ordem, comparados por igualdade estrita
//       (ex. ['up', 'up', 'down', 'A']).
//     timeLimit: segundos permitidos entre o primeiro .feed() e a conclusão da
//       sequência (relógio de parede via performance.now/Date.now — este módulo não
//       tem .update(dt); a contagem de tempo é independente do loop do jogo).
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

export function create({ sequence = [], timeLimit = Infinity } = {}) {
  const combo = {
    isComplete: false,
    failed: false,
    _index: 0,
    _startedAt: null,

    feed(input) {
      if (this.isComplete || this.failed) return

      const t = now()
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
