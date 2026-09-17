// config — constantes de balanceamento do jogo (NÃO paleta de cores/estilo;
// isso vive em src/data/styleGuide.js, de outro agente).
//
// API pública (export nomeado `config` + funções nomeadas):
//   config.days: { minDays, maxDays, defaultMaxDays, daysPerShift, randomMaxDays() }
//     Orçamento de vida jogável: 45–60 dias, calibrado com a vida adulta real
//     de operárias de Mandaçaia (40–60 dias — ver data/species.js). TimeSystem
//     usa `defaultMaxDays` por padrão; `randomMaxDays()` sorteia um valor
//     dentro da faixa. `daysPerShift` = 3: cada turno jogado representa vários
//     dias de trabalho (o fluxo chama time.advanceDays(daysPerShift, ...)).
//     Com ~11 turnos esperados (≈33 dias) a vida só aperta para quem repete muito.
//   config.promotionThresholds: { larva, cleaning, feedLarvae, feedQueen, guard, default }
//     Pontuação acumulada (soma de TaskSystem.recordShiftScore, cada turno em
//     escala 0–100) necessária para TaskSystem.checkPromotion() avançar do
//     rank atual para o próximo. Calibrado para um jogador mediano (~55–65 por
//     turno com a curva de dificuldade nova) promover em `turnsPerTask` turnos
//     (limiar ≈ turnsPerTask × 55). Em 'guard' é o limiar do fim do Marco 1.
//   config.turnsPerTask: { larva, cleaning, feedLarvae, feedQueen, guard, default }
//     Nº esperado de turnos em cada tarefa (desempenho médio). Total ≈ 11.
//   config.difficulty: parâmetros de difficultyFor/inShiftRamp (ver abaixo).
//   config.colonyDecay: taxas por dia-jogável consumidas por ColonyState.tickDecay(dt).
//
//   difficultyFor(taskId, shiftIndex, recentScores = []) -> number 0–1
//     FONTE DA VERDADE da dificuldade entre turnos (tarefas não devem mais inventar
//     escalada própria a partir de shiftIndex; recebem `data.difficulty` no enter).
//     - shiftIndex 0 (primeiro turno na tarefa) = treino ≈ 0.1.
//     - sobe suave (exponencial saturando, constante de tempo ∝ turnsPerTask[taskId]):
//       cleaning: 0.10, 0.48, 0.70, 0.83…  demais (3 turnos): 0.10, 0.38, 0.57, 0.70, 0.80…
//       teto 1.
//     - ajuda leve e invisível: se as 2 ÚLTIMAS pontuações de recentScores (pontuações
//       desta tarefa em ordem cronológica, a mais recente no fim) forem ambas < 40,
//       reduz 0.15 (piso 0).
//     Mapeie 0–1 para os parâmetros da tarefa com lerp(fácil, difícil, d).
//
//   inShiftRamp(elapsed, duration, { grace = 10 } = {}) -> number 0–1
//     Rampa DENTRO do turno: 0 durante os primeiros `grace` segundos (tranquilo),
//     depois sobe com ease-in-out até 1 em `duration`. Uso sugerido:
//       const k = difficulty * (0.55 + 0.45 * inShiftRamp(t, SHIFT_DURATION))
//
// Todos os valores são pontos de partida de balanceamento — ajustáveis sem
// quebrar contrato, desde que as chaves existentes continuem presentes.

export const config = {
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

  // Limiar de pontuação acumulada (escala 0-100 por turno, somada ao longo
  // dos turnos da tarefa) necessário para promover do rank-chave ao próximo.
  promotionThresholds: {
    larva: 100,
    cleaning: 110,
    feedLarvae: 165,
    feedQueen: 165,
    guard: 170,
    default: 150,
  },

  // Nº de turnos jogáveis esperados por tarefa (desempenho médio).
  turnsPerTask: {
    larva: 2,
    cleaning: 2,
    feedLarvae: 3,
    feedQueen: 3,
    guard: 3,
    default: 3,
  },

  // Curva de dificuldade central (difficultyFor / inShiftRamp).
  difficulty: {
    training: 0.1, // primeiro turno de cada tarefa
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
  const turns = config.turnsPerTask[taskId] ?? config.turnsPerTask.default;
  const n = Math.max(0, Number.isFinite(shiftIndex) ? shiftIndex : 0);
  const tau = Math.max(0.5, turns * D.tauPerTurn);
  let d = D.training + (D.ceiling - D.training) * (1 - Math.exp(-n / tau));

  const scores = Array.isArray(recentScores) ? recentScores.filter(Number.isFinite) : [];
  if (scores.length >= 2) {
    const [a, b] = scores.slice(-2);
    if (a < D.helpBelowScore && b < D.helpBelowScore) d -= D.helpAmount;
  }
  return clamp01(Math.min(d, D.ceiling));
}

export function inShiftRamp(elapsed, duration, { grace = config.difficulty.shiftGrace } = {}) {
  if (!(duration > grace)) return elapsed >= duration ? 1 : 0;
  const t = clamp01((elapsed - grace) / (duration - grace));
  return t * t * (3 - 2 * t);
}

export default config;
