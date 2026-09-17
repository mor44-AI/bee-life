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
