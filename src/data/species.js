// species — dados factuais reais sobre a Mandaçaia (Melipona quadrifasciata),
// levantados por pesquisa nesta sessão. Estruturado para consumo direto por
// UI de conteúdo educativo (telas de "você sabia?", créditos, fase futura de
// visão geral da espécie) — não é usado por lógica de jogo/balanceamento
// (isso vive em data/config.js).
//
// API pública (export nomeado `species`):
//   scientificName, commonName, family, tribe: string
//   nativeRange, nestHabits: string
//   lifespanDays: { min, max } — vida adulta real de uma operária (dado
//     biológico; o orçamento de DIAS JOGÁVEIS é calibrado com esta faixa mas
//     vive separadamente em config.days, não precisa ser idêntico)
//   laborDivision: Array<{ ageRangeDays: {min, max|null}, role, description }>
//     Polietismo etário (divisão de trabalho por idade). A faixa dias 12–21
//     para cuidado de cria/construção de células foi confirmada
//     especificamente nesta sessão de pesquisa.
//   casteDetermination: { summary, geneticComponent, virginQueenSurplus }
//     Nota para fase educativa futura (não é mecânica de jogo agora): em
//     Melipona, ao contrário de Apis mellifera, a determinação de casta
//     rainha/operária tem componente GENÉTICO além do nutricional, e colônias
//     produzem naturalmente um excedente de rainhas virgens, comumente
//     executadas pelas operárias quando não são necessárias.
//   funFacts: string[] — fatos adicionais soltos, para rotação em UI.

export const species = {
  scientificName: 'Melipona quadrifasciata',
  commonName: 'Mandaçaia',
  family: 'Apidae',
  tribe: 'Meliponini (abelhas sem ferrão / stingless bees)',
  nativeRange:
    'Mata Atlântica e áreas de floresta/cerrado do Brasil — principalmente regiões sul, sudeste e parte do nordeste.',
  nestHabits:
    'Nidifica em cavidades pré-existentes, tipicamente ocos de troncos de árvores vivas. Constrói favos de cria horizontais em discos (não em favo vertical como Apis mellifera) e potes independentes de armazenamento de mel e pólen, tudo em cerume — mistura de cera produzida pela própria abelha com resina/própolis coletada.',

  // Vida adulta real de uma operária — usado para calibrar (não copiar 1:1)
  // o orçamento de dias jogáveis em data/config.js (config.days).
  lifespanDays: { min: 40, max: 60 },

  laborDivision: [
    {
      ageRangeDays: { min: 1, max: 11 },
      role: 'Serviços internos iniciais',
      description:
        'Operárias recém-emergidas assumem primeiro tarefas internas de baixo risco: limpeza de células, higiene do ninho e processamento inicial de alimento, antes de passar ao cuidado de cria.',
    },
    {
      ageRangeDays: { min: 12, max: 21 },
      role: 'Cuidado de cria e construção',
      description:
        'Faixa etária confirmada nesta pesquisa: operárias entre 12 e 21 dias cuidam da cria (alimentam larvas) e constroem/operam células de cria e potes de cerume — período de maior atividade glandular (produção de cera e alimento larval).',
    },
    {
      ageRangeDays: { min: 22, max: null },
      role: 'Guarda e forrageamento',
      description:
        'Operárias mais velhas migram para tarefas externas de maior risco: guarda da entrada do ninho e forrageamento de néctar, pólen, água e resina — condizente com abelhas mais próximas do fim da vida útil ("expendable caste" clássica de abelhas eussociais).',
    },
  ],

  casteDetermination: {
    summary:
      'Ao contrário de Apis mellifera (onde a casta rainha/operária é determinada quase inteiramente pela dieta larval — geleia real), em Melipona a determinação de casta tem um componente GENÉTICO além do nutricional.',
    geneticComponent:
      'Modelo proposto por Warwick Kerr (pesquisador brasileiro pioneiro no estudo de Melipona): tornar-se rainha depende de heterozigose em loci genéticos específicos, além de alimentação em quantidade adequada durante a fase larval — ou seja, nem toda larva bem alimentada vira rainha, e a proporção de larvas geneticamente aptas é parcialmente herdada.',
    virginQueenSurplus:
      'Consequência desse sistema: colônias de Melipona produzem naturalmente um excedente de rainhas virgens, muito além do que a colônia precisa para substituição da rainha-mãe ou enxameação. Rainhas virgens excedentes costumam ser executadas pelas próprias operárias quando não são necessárias — comportamento bem documentado no gênero. (Conteúdo educativo para uma fase futura do jogo; não é mecânica agora.)',
  },

  funFacts: [
    'Mandaçaia é abelha sem ferrão (tribo Meliponini): o ferrão é vestigial e não é usado para defesa — a colônia se defende mordendo o invasor, bloqueando a entrada com o próprio corpo, ou selando-a com própolis pegajosa.',
    'O nome popular "mandaçaia" é de origem tupi e é usado para Melipona quadrifasciata e espécies/variedades próximas no Brasil; é uma das espécies de Melipona mais estudadas e mais criadas em meliponários.',
    'A entrada do ninho é frequentemente um tubo de cerume esculpido pelas próprias operárias, usado tanto para controle de temperatura e umidade internas quanto como primeira linha de defesa.',
    'Guardas costumam ficar paradas ou pairando perto da entrada e podem estreitar/fechar parcialmente o tubo de entrada com própolis à noite ou diante de ameaças.',
    'Diferente de Apis mellifera, Melipona não realiza a "dança do requebrado" (waggle dance) da mesma forma; a comunicação sobre fontes de alimento em Meliponini usa outros sinais, incluindo sons/vibrações e, em algumas espécies, acompanhamento físico de forrageiras até a fonte.',
    'O mel de Mandaçaia tem composição diferente do mel de Apis mellifera (geralmente mais úmido e mais ácido) e é valorizado tanto culturalmente quanto por uso medicinal tradicional em diversas comunidades brasileiras.',
  ],
};

export default species;
