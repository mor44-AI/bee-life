// SpecialMeter - medidor do "especial" de cada tarefa (carrega, fica pronto, ativa
// por um tempo, recomeça a carregar). Lógica pura, sem desenho (o desenho do
// medidor fica no botão Especial de src/ui/Controls.js, que recebe esta instância).
//
// API pública:
//   create({ chargeTime = 24, duration = 6, passiveRate = 1 }) -> meter (também default export)
//     chargeTime: segundos para carregar de 0 a 1 SÓ com a carga passiva
//       (passiveRate = 1). Recomendação: 20-30s para não trivializar.
//     duration: segundos que o efeito fica ativo após activate().
//     passiveRate: multiplicador da carga passiva (0 = só carrega por acerto).
//   meter.update(dt) -> void
//     Carga passiva (dt / chargeTime * passiveRate) enquanto NÃO ativo, e contagem
//     do efeito ativo. Durante o efeito a carga fica travada em 0.
//   meter.add(amount) -> void
//     Carga por acerto, em fração do total (ex. 0.08 = 8%). Ignorado enquanto ativo.
//   meter.charge -> number 0-1
//   meter.isReady -> boolean (charge >= 1 e não ativo)
//   meter.activate() -> boolean
//     Se pronto: inicia o efeito (isActive = true, charge = 0) e retorna true.
//     Senão retorna false (nada muda).
//   meter.isActive -> boolean
//   meter.activeProgress -> number 0-1 (0 = acabou de ativar, 1 = terminando; 0 se inativo)
//   meter.activeRemaining -> number (segundos restantes do efeito; 0 se inativo)
//   meter.justActivated / meter.justEnded -> boolean
//     true apenas até o próximo update(dt) após ativar / no update em que o efeito acabou.
//   meter.readyTime -> number (segundos desde que ficou pronto; 0 se não pronto) - útil p/ pulsar.
//   meter.reset() -> void  (charge 0, inativo)
//   meter.chargeTime / meter.duration / meter.passiveRate - editáveis em tempo real.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function create({ chargeTime = 24, duration = 6, passiveRate = 1 } = {}) {
  const meter = {
    chargeTime,
    duration,
    passiveRate,
    charge: 0,
    isActive: false,
    activeRemaining: 0,
    justActivated: false,
    justEnded: false,
    readyTime: 0,

    get isReady() {
      return !this.isActive && this.charge >= 1
    },

    get activeProgress() {
      if (!this.isActive || this.duration <= 0) return 0
      return clamp01(1 - this.activeRemaining / this.duration)
    },

    update(dt) {
      this.justActivated = false
      this.justEnded = false
      if (this.isActive) {
        this.activeRemaining -= dt
        if (this.activeRemaining <= 0) {
          this.activeRemaining = 0
          this.isActive = false
          this.justEnded = true
        }
        return
      }
      if (this.charge < 1 && this.chargeTime > 0) {
        this.charge = clamp01(this.charge + (dt / this.chargeTime) * this.passiveRate)
      }
      this.readyTime = this.charge >= 1 ? this.readyTime + dt : 0
    },

    add(amount) {
      if (this.isActive || !Number.isFinite(amount)) return
      this.charge = clamp01(this.charge + amount)
    },

    activate() {
      if (!this.isReady) return false
      this.isActive = true
      this.charge = 0
      this.readyTime = 0
      this.activeRemaining = this.duration
      this.justActivated = true
      return true
    },

    reset() {
      this.charge = 0
      this.isActive = false
      this.activeRemaining = 0
      this.justActivated = false
      this.justEnded = false
      this.readyTime = 0
    },
  }
  return meter
}

export default create
