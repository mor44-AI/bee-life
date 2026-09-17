// TaskSystem — tarefa/rank atual da operária e progressão fixa (lógica pura).
//
// A progressão é linear e NÃO-ramificada — não existe mecanismo de escolha
// de caminho. A sequência fixa é exportada como RANK_ORDER e também usada
// internamente para decidir o próximo rank em checkPromotion().
//
// API pública:
//   RANK_ORDER: readonly string[]
//     ['larva', 'cleaning', 'feedLarvae', 'feedQueen', 'guard']
//   new TaskSystem()
//     currentRank: 'larva' | 'cleaning' | 'feedLarvae' | 'feedQueen' | 'guard'
//       Começa em 'larva'.
//   recordShiftScore(score: number): void
//     Acumula a pontuação de desempenho do turno atual (clampada 0–100) no
//     acumulador interno do rank atual.
//   checkPromotion(): boolean
//     Compara o acumulador com config.promotionThresholds[currentRank]. Se
//     atingido: zera o acumulador, avança currentRank para o próximo item de
//     RANK_ORDER e retorna true. Caso contrário retorna false. Em 'guard'
//     (último rank) não há próximo estágio: o método continua retornando
//     false e o acumulador permanece intacto (excesso não é descartado) —
//     não há mais promoção possível, mas nada quebra se for chamado de novo.
//   getAccumulatedScore(): number — leitura do acumulador (UI/debug).
//   serialize(): object / static deserialize(data): TaskSystem

import { config } from '../data/config.js';

export const RANK_ORDER = ['larva', 'cleaning', 'feedLarvae', 'feedQueen', 'guard'];

export default class TaskSystem {
  constructor() {
    this.currentRank = RANK_ORDER[0];
    this._accumulatedScore = 0;
  }

  recordShiftScore(score) {
    const s = Number.isFinite(score) ? score : 0;
    this._accumulatedScore += Math.max(0, Math.min(100, s));
  }

  checkPromotion() {
    const threshold =
      config.promotionThresholds[this.currentRank] ?? config.promotionThresholds.default;

    if (this._accumulatedScore < threshold) {
      return false;
    }

    const currentIndex = RANK_ORDER.indexOf(this.currentRank);
    const nextRank = RANK_ORDER[currentIndex + 1];

    if (!nextRank) {
      // 'guard' é o último rank da sequência fixa — sem próxima promoção.
      return false;
    }

    this._accumulatedScore = 0;
    this.currentRank = nextRank;
    return true;
  }

  getAccumulatedScore() {
    return this._accumulatedScore;
  }

  serialize() {
    return {
      currentRank: this.currentRank,
      accumulatedScore: this._accumulatedScore,
    };
  }

  static deserialize(data = {}) {
    const task = new TaskSystem();
    task.currentRank = RANK_ORDER.includes(data.currentRank) ? data.currentRank : RANK_ORDER[0];
    task._accumulatedScore = Number.isFinite(data.accumulatedScore) ? data.accumulatedScore : 0;
    return task;
  }
}
