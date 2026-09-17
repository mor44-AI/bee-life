// Progressão fixa por tarefa, independentemente da pontuação.
import { config } from '../data/config.js'
export const RANK_ORDER = ['larva', 'cleaning', 'feedLarvae', 'feedQueen', 'guard']
export default class TaskSystem {
  constructor() {
    this.currentRank = RANK_ORDER[0]
    this.history = {}
  }
  recordShiftScore(score) {
    if (this.isTaskComplete()) return
    const value = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0
    ;(this.history[this.currentRank] ??= []).push(value)
  }
  getScores(rank = this.currentRank) { return [...(this.history[rank] ?? [])] }
  getCompletedShifts(rank = this.currentRank) { return this.getScores(rank).length }
  isTaskComplete() {
    return this.getCompletedShifts() >= (config.turnsPerTask[this.currentRank] ?? config.turnsPerTask.default)
  }
  checkPromotion() {
    if (!this.isTaskComplete()) return false
    const next = RANK_ORDER[RANK_ORDER.indexOf(this.currentRank) + 1]
    if (!next) return false
    this.currentRank = next
    return true
  }
  getAccumulatedScore() { return this.getScores().reduce((sum, score) => sum + score, 0) }
  serialize() { return { currentRank: this.currentRank, history: structuredClone(this.history) } }
  static deserialize(data = {}) {
    const task = new TaskSystem()
    task.currentRank = RANK_ORDER.includes(data.currentRank) ? data.currentRank : RANK_ORDER[0]
    for (const rank of RANK_ORDER) {
      const scores = data.history?.[rank]
      if (Array.isArray(scores)) task.history[rank] = scores.filter(Number.isFinite)
        .slice(0, config.turnsPerTask[rank]).map(score => Math.max(0, Math.min(100, score)))
    }
    return task
  }
}
