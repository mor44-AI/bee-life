// species - dados factuais reais sobre a Mandaçaia (Melipona quadrifasciata),
// levantados por pesquisa nesta sessão. Estruturado para consumo direto por
// UI de conteúdo educativo (telas de "você sabia?", créditos, fase futura de
// visão geral da espécie) - não é usado por lógica de jogo/balanceamento
// (isso vive em data/config.js).
//
// Bilíngue: dados numéricos/científicos ficam aqui; TODO texto exibível vem de
// src/i18n/strings/species.js (chaves species.*) via getters - cada leitura
// devolve o idioma atual (t()). Não guarde os textos em cache sem getLang().
//
// API pública (export nomeado `species`):
//   scientificName, family: string (não traduzidos)
//   commonName, tribe, nativeRange, nestHabits: string (traduzidos)
//   lifespanDays: { min, max } - vida adulta real de uma operária (dado
//     biológico; o orçamento de DIAS JOGÁVEIS é calibrado com esta faixa mas
//     vive separadamente em config.days, não precisa ser idêntico)
//   laborDivision: Array<{ ageRangeDays: {min, max|null}, role, description }>
//     Polietismo etário (divisão de trabalho por idade); role/description traduzidos.
//     A faixa dias 12-21 para cuidado de cria/construção de células foi
//     confirmada especificamente nesta sessão de pesquisa.
//   casteDetermination: { summary, geneticComponent, virginQueenSurplus } (traduzidos)
//     Nota para fase educativa futura (não é mecânica de jogo agora): em
//     Melipona, ao contrário de Apis mellifera, a determinação de casta
//     rainha/operária tem componente GENÉTICO além do nutricional, e colônias
//     produzem naturalmente um excedente de rainhas virgens, comumente
//     executadas pelas operárias quando não são necessárias.
//   funFacts: string[] - fatos adicionais soltos, para rotação em UI (traduzidos;
//     array novo a cada leitura).

import { t } from '../i18n/index.js'

const FUN_FACT_COUNT = 6

const LABOR_AGES = [
  { min: 1, max: 11 },
  { min: 12, max: 21 },
  { min: 22, max: null },
]

export const species = {
  scientificName: 'Melipona quadrifasciata',
  get commonName() { return t('species.commonName') },
  family: 'Apidae',
  get tribe() { return t('species.tribe') },
  get nativeRange() { return t('species.nativeRange') },
  get nestHabits() { return t('species.nestHabits') },

  // Vida adulta real de uma operária - usado para calibrar (não copiar 1:1)
  // o orçamento de dias jogáveis em data/config.js (config.days).
  lifespanDays: { min: 40, max: 60 },

  laborDivision: LABOR_AGES.map((ageRangeDays, i) => ({
    ageRangeDays,
    get role() { return t(`species.labor.${i}.role`) },
    get description() { return t(`species.labor.${i}.description`) },
  })),

  casteDetermination: {
    get summary() { return t('species.caste.summary') },
    get geneticComponent() { return t('species.caste.geneticComponent') },
    get virginQueenSurplus() { return t('species.caste.virginQueenSurplus') },
  },

  get funFacts() {
    return Array.from({ length: FUN_FACT_COUNT }, (_, i) => t(`species.fact.${i}`))
  },
};

export default species;
