// API pública:
//   create({ rate = 0, max = 100, min = 0, thresholds = { restless: 0.5, critical: 0.8 } })
//     -> gauge (também default export)
//     rate: taxa de subida/descida automática por segundo, usada por .update(dt).
//     thresholds: frações de (value - min)/(max - min) que definem os limiares de
//       estado (configuráveis por instância).
//   gauge.update(dt) -> void
//     Soma rate * dt a .value (clampado em [min, max]).
//   gauge.add(amount) -> void / gauge.subtract(amount) -> void
//     Eventos discretos (ex. "jogador limpou uma célula" = subtract(10)).
//   gauge.setRate(newRate) -> void
//   gauge.reset() -> void (volta .value para min)
//   gauge.value -> number (0..max, na prática min..max)
//   gauge.state -> 'calm' | 'restless' | 'critical'
//     Derivado de value via os thresholds configurados.

function clamp(v, min, max) {
  if (v < min) return min
  if (v > max) return max
  return v
}

export function create({
  rate = 0,
  max = 100,
  min = 0,
  thresholds = { restless: 0.5, critical: 0.8 },
} = {}) {
  const gauge = {
    value: min,
    max,
    min,
    rate,
    thresholds,

    get state() {
      const range = this.max - this.min
      const ratio = range > 0 ? (this.value - this.min) / range : 0
      if (ratio >= this.thresholds.critical) return 'critical'
      if (ratio >= this.thresholds.restless) return 'restless'
      return 'calm'
    },

    update(dt) {
      this.value = clamp(this.value + this.rate * dt, this.min, this.max)
    },

    add(amount) {
      this.value = clamp(this.value + amount, this.min, this.max)
    },

    subtract(amount) {
      this.value = clamp(this.value - amount, this.min, this.max)
    },

    setRate(newRate) {
      this.rate = newRate
    },

    reset() {
      this.value = this.min
    },
  }

  return gauge
}

export default create
