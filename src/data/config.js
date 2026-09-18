// Balanceamento central: turnos de 42 segundos, progressão 2/2/3/3.
// A pontuação afeta a colônia; a promoção depende apenas dos turnos concluídos.
export const config = {
  shiftDuration: 42,
  durationScale: 0.7,
  days: {
    minDays: 45,
    maxDays: 60,
    // Valor default usado quando nada mais é especificado (dentro da faixa).
    defaultMaxDays: 52,
    // Dias de vida consumidos por turno jogado.
    daysPerShift: 3,
    // Sorteia uma duração de vida jogável dentro da faixa [minDays, maxDays].
    randomMaxDays() {
      const { minDays, maxDays } = config.days;
      return minDays + Math.floor(Math.random() * (maxDays - minDays + 1));
    },
  },

  // Referência histórica de pontuação; não controla mais a promoção.
  promotionThresholds: {
    larva: 100,
    cleaning: 110,
    feedLarvae: 165,
    feedQueen: 165,
    guard: 170,
    default: 150,
  },

  // Número fixo de turnos por tarefa.
  turnsPerTask: {
    larva: 3,
    cleaning: 2,
    feedLarvae: 2,
    feedQueen: 3,
    guard: 3,
    default: 3,
  },

  // Curva de dificuldade central (difficultyFor / inShiftRamp).
  difficulty: {
    training: 0.57, // primeiro turno de cada tarefa
    curveTurns: 3, // preserva a curva original ao retirar o primeiro turno
    skippedTurns: { cleaning: 1, feedLarvae: 1 },
    ceiling: 1,
    tauPerTurn: 0.9, // constante de tempo da subida = turnsPerTask × tauPerTurn
    helpBelowScore: 40, // 2 últimos turnos abaixo disso => ajuda
    helpAmount: 0.15,
    shiftGrace: 10, // segundos tranquilos no começo de cada turno
  },

  // Pontuação "arcade" (ScoreSystem, context.score). Independente do score 0-100
  // de finishShift, que continua sendo o que afeta a colônia.
  // Ordens de grandeza: um turno médio ~1.500-3.000 pontos (ação + bônus da fase);
  // uma vida completa (10 turnos + bônus final) ~20.000-40.000.
  scoring: {
    // Sem award por este tempo (s) o combo expira.
    comboTimeout: 2.5,
    // Multiplicador pelo combo (já incluindo o acerto atual): o 3º acerto seguido
    // já vale ×1,5. Ordem decrescente; o primeiro que casar vence.
    multipliers: [
      { combo: 10, mult: 3 },
      { combo: 6, mult: 2 },
      { combo: 3, mult: 1.5 },
    ],
    // Guia para as tarefas escolherem o `base` de award(): num turno de 42 s,
    // ~35-60 acertos "normal" somam ~1.000-2.000 pontos de ação com combos.
    base: { small: 10, normal: 25, great: 50, perfect: 80 },
    targetShiftActionPoints: 1500,
    // Bônus de fase no fim do turno: max × Σ(peso × indicador/100), lido da colônia
    // DEPOIS de aplicar o resultado do turno (antes do desgaste da noite). Fases
    // mais avançadas valem mais (max crescente).
    phaseBonus: {
      cleaning: { max: 900, weights: { health: 0.6, wax: 0.4 } },
      feedLarvae: { max: 1000, weights: { population: 0.5, pollen: 0.5 } },
      feedQueen: { max: 1100, weights: { population: 0.5, nectar: 0.5 } },
      guard: { max: 1200, weights: { health: 0.5, propolis: 0.5 } },
    },
    // Turno livre (rejogar fase passada): fração do efeito do turno aplicada à colônia.
    freeColonyEffect: 0.5,
    // Bônus final da vida: cada indicador 0-100 vale perPoint pontos por ponto.
    finalBonus: {
      perPoint: 30,
      indicators: ['population', 'nectar', 'pollen', 'propolis', 'wax', 'health'],
    },
  },

  // Taxas de decaimento/recuperação usadas por ColonyState.tickDecay(dt),
  // aplicadas proporcionalmente a `dt` (dias-jogáveis).
  colonyDecay: {
    nectarPerDay: 3,
    pollenPerDay: 2.5,
    waxPerDay: 1,
    propolisPerDay: 0.5,
    healthRecovery: 1.5, // aplicado quando estoques estão saudáveis
    healthPenalty: 2, // aplicado quando estoques estão baixos
    populationGrowth: 0.8, // crescimento lento quando colônia está saudável
    populationDecline: 1.2, // declínio quando saúde está crítica
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function difficultyFor(taskId, shiftIndex = 0, recentScores = []) {
  const D = config.difficulty;
  const turns = D.curveTurns;
  const n = Math.max(0, Number.isFinite(shiftIndex) ? shiftIndex : 0) + (D.skippedTurns[taskId] ?? 0);
  const tau = Math.max(0.5, turns * D.tauPerTurn);
  let d = D.training + (D.ceiling - D.training) * (1 - Math.exp(-n / tau));

  const scores = Array.isArray(recentScores) ? recentScores.filter(Number.isFinite) : [];
  if (scores.length >= 2) {
    const [a, b] = scores.slice(-2);
    if (a < D.helpBelowScore && b < D.helpBelowScore) d -= D.helpAmount;
  }
  return clamp01(Math.max(D.training, Math.min(d, D.ceiling)));
}

export function inShiftRamp(elapsed, duration, { grace = config.difficulty.shiftGrace } = {}) {
  if (!(duration > grace)) return elapsed >= duration ? 1 : 0;
  const t = clamp01((elapsed - grace) / (duration - grace));
  return t * t * (3 - 2 * t);
}

export default config;
