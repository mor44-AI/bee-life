// config — constantes de balanceamento do jogo (NÃO paleta de cores/estilo;
// isso vive em src/data/styleGuide.js, de outro agente).
//
// API pública (export nomeado `config`):
//   config.days: { minDays, maxDays, defaultMaxDays, randomMaxDays() }
//     Orçamento de vida jogável: 45–60 dias, calibrado com a vida adulta real
//     de operárias de Mandaçaia (40–60 dias — ver data/species.js). TimeSystem
//     usa `defaultMaxDays` por padrão; `randomMaxDays()` sorteia um valor
//     dentro da faixa para variar a duração entre partidas.
//   config.promotionThresholds: { larva, cleaning, feedLarvae, feedQueen, guard, default }
//     Pontuação acumulada (soma de TaskSystem.recordShiftScore, cada turno em
//     escala 0–100) necessária para TaskSystem.checkPromotion() avançar do
//     rank atual para o próximo da sequência fixa.
//   config.turnsPerTask: { larva, cleaning, feedLarvae, feedQueen, guard, default }
//     Número esperado de turnos jogáveis em cada tarefa (assumindo desempenho
//     médio) antes de uma promoção "normal" — usado por UI/TaskHubState para
//     dimensionar cada fase. Combinado com promotionThresholds define o ritmo
//     de progressão (limiar ≈ turnsPerTask × pontuação média esperada/turno).
//   config.colonyDecay: taxas por dia-jogável consumidas por ColonyState.tickDecay(dt).
//
// Todos os valores são pontos de partida de balanceamento — ajustáveis sem
// quebrar contrato, desde que as chaves existentes continuem presentes.

export const config = {
  days: {
    minDays: 45,
    maxDays: 60,
    // Valor default usado quando nada mais é especificado (dentro da faixa).
    defaultMaxDays: 52,
    // Sorteia uma duração de vida jogável dentro da faixa [minDays, maxDays].
    randomMaxDays() {
      const { minDays, maxDays } = config.days;
      return minDays + Math.floor(Math.random() * (maxDays - minDays + 1));
    },
  },

  // Limiar de pontuação acumulada (escala 0-100 por turno, somada ao longo
  // dos turnos da tarefa) necessário para promover do rank-chave ao próximo.
  promotionThresholds: {
    larva: 150,
    cleaning: 220,
    feedLarvae: 260,
    feedQueen: 260,
    guard: 300,
    default: 200,
  },

  // Nº de turnos jogáveis esperados por tarefa (desempenho médio).
  turnsPerTask: {
    larva: 3,
    cleaning: 4,
    feedLarvae: 5,
    feedQueen: 5,
    guard: 6,
    default: 4,
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

export default config;
