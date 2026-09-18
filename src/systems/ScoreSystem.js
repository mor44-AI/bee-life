// ScoreSystem - pontuação "arcade" da vida atual (context.score).
//
// Não substitui o score 0-100 de finishShift (que continua afetando a colônia):
// é a camada de pontos/combos exibida na tela, somada ao longo da vida e usada no
// ranking. Uma instância por vida; GameSession salva/restaura com serialize().
// Valores de calibração em config.scoring (src/data/config.js).
//
// API (contrato usado pelas tarefas e pela UI):
//   beginShift(taskId, { free = false } = {})  zera pontos/combo/popups do turno e ativa.
//   award(base, { x, y, reason } = {}) -> number
//       Concede round(base × multiplier). Incrementa `combo` ANTES de calcular o
//       multiplicador (o 3º acerto seguido já vale ×1,5). Cria um popup "+N" em (x, y)
//       (coordenadas lógicas do canvas; sem x/y -> centro-alto do playfield).
//       `reason`: chave i18n opcional, mostrada pequena abaixo do número
//       (ex. 'score.reason.perfect'). base <= 0 ou inválido -> 0, sem mexer no combo.
//   miss()        zera o combo (com feedback visual curto se o combo era >= 3).
//   combo         int - acertos seguidos; expira após config.scoring.comboTimeout s sem award.
//   multiplier    1 | 1.5 | 2 | 3 (config.scoring.multipliers).
//   shiftPoints   pontos de ação do turno atual.   bestCombo  maior combo do turno.
//   update(dt)    expiração do combo e animação dos popups.
//   render(ctx, layout)   desenha popups e o selo de combo (src/ui/ScorePopups.js).
//                         Não desenha nada fora de um turno (active = false).
//   endShift(taskId, colony) -> { taskId, actionPoints, phaseBonus, points, bestCombo, free }
//       phaseBonus = phaseBonusFor(taskId, colony) (fase + estado da colmeia).
//       points = actionPoints + phaseBonus. Turno livre não soma em `total` nem no histórico.
//   total         soma dos `points` dos turnos não-livres.
//   history       [{ taskId, actionPoints, phaseBonus, points, bestCombo }] (turnos contados).
//   lifeBestCombo maior combo da vida (turnos contados).
//   finalBonus(colony) -> { items: [{ key, value, points }], total }
//       key = chave i18n do indicador (score.final.<indicador>), value = indicador 0-100,
//       points = pontos concedidos.
//   finalScore(colony) -> total + finalBonus(colony).total
//   serialize() / static deserialize(data)  (dados ausentes/antigos -> total 0).

import { config } from '../data/config.js'
import { createScorePopups } from '../ui/ScorePopups.js'

const S = () => config.scoring
const num = (v, d = 0) => (Number.isFinite(v) ? v : d)
const clamp100 = (v) => Math.max(0, Math.min(100, num(v)))

export function multiplierFor(combo) {
  for (const step of S().multipliers) if (combo >= step.combo) return step.mult
  return 1
}

export function phaseBonusFor(taskId, colony) {
  const rule = S().phaseBonus[taskId]
  if (!rule || !colony) return 0
  let sum = 0
  for (const [key, w] of Object.entries(rule.weights)) sum += w * clamp100(colony[key]) / 100
  return Math.round(rule.max * sum)
}

export default class ScoreSystem {
  constructor() {
    this.total = 0
    this.history = []
    this.lifeBestCombo = 0
    this.popups = createScorePopups()
    this._resetShift(null, false)
    this.active = false
  }

  _resetShift(taskId, free) {
    this.taskId = taskId
    this.free = !!free
    this.shiftPoints = 0
    this.combo = 0
    this.bestCombo = 0
    this.comboTimer = 0
  }

  get multiplier() { return multiplierFor(this.combo) }

  beginShift(taskId, { free = false } = {}) {
    this._resetShift(taskId ?? null, free)
    this.popups.clear()
    this.active = true
  }

  award(base, { x, y, reason } = {}) {
    if (!Number.isFinite(base) || base <= 0) return 0
    const before = this.multiplier
    this.combo += 1
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    this.comboTimer = S().comboTimeout
    const mult = this.multiplier
    const points = Math.round(base * mult)
    this.shiftPoints += points
    this.popups.spawn({ points, x, y, reason, mult, combo: this.combo, multUp: mult > before })
    return points
  }

  miss() {
    const lost = this.combo
    this.combo = 0
    this.comboTimer = 0
    if (lost >= 3) this.popups.comboLost(lost)
  }

  update(dt) {
    const d = num(dt)
    if (this.combo > 0) {
      this.comboTimer -= d
      if (this.comboTimer <= 0) {
        this.combo = 0
        this.comboTimer = 0
        this.popups.comboExpired()
      }
    }
    this.popups.update(d)
  }

  render(ctx, layout) {
    if (!this.active || !ctx) return
    this.popups.render(ctx, layout, {
      combo: this.combo,
      multiplier: this.multiplier,
      timerFrac: this.combo > 0 ? this.comboTimer / S().comboTimeout : 0,
    })
  }

  endShift(taskId = this.taskId, colony = null) {
    const free = this.free
    const actionPoints = this.shiftPoints
    const phaseBonus = phaseBonusFor(taskId, colony)
    const points = actionPoints + phaseBonus
    const bestCombo = this.bestCombo
    if (!free) {
      this.total += points
      this.history.push({ taskId, actionPoints, phaseBonus, points, bestCombo })
      this.lifeBestCombo = Math.max(this.lifeBestCombo, bestCombo)
    }
    this.active = false
    this.popups.clear()
    this.combo = 0
    this.comboTimer = 0
    return { taskId, actionPoints, phaseBonus, points, bestCombo, free }
  }

  finalBonus(colony) {
    const { perPoint, indicators } = S().finalBonus
    const items = indicators.map((key) => {
      const value = Math.round(clamp100(colony?.[key]))
      return { key: `score.final.${key}`, value, points: value * perPoint }
    })
    return { items, total: items.reduce((s, i) => s + i.points, 0) }
  }

  finalScore(colony) {
    return this.total + this.finalBonus(colony).total
  }

  serialize() {
    return { total: this.total, history: structuredClone(this.history), lifeBestCombo: this.lifeBestCombo }
  }

  static deserialize(data) {
    const score = new ScoreSystem()
    if (!data || typeof data !== 'object') return score
    score.history = Array.isArray(data.history)
      ? data.history.filter((h) => h && Number.isFinite(h.points)).map((h) => ({
        taskId: String(h.taskId ?? ''), actionPoints: num(h.actionPoints), phaseBonus: num(h.phaseBonus),
        points: h.points, bestCombo: num(h.bestCombo),
      }))
      : []
    score.total = Number.isFinite(data.total) ? Math.max(0, data.total)
      : score.history.reduce((s, h) => s + h.points, 0)
    score.lifeBestCombo = num(data.lifeBestCombo)
    return score
  }
}
