// Strings for feedLarvae. Keys must match between pt and en.
export default {
  pt: {
    'feedLarvae.action': 'ALIMENTAR',
    'feedLarvae.special': 'NUTRIZES',
    'feedLarvae.nurseCall': 'chamado das nutrizes',
    'feedLarvae.noFood': 'sem alimento - potes',
    'feedLarvae.waste': 'desperdício',
    'feedLarvae.perfect': 'perfeito',
    'feedLarvae.good': 'bom',
    'feedLarvae.larvaLost': 'larva perdida',
    'feedLarvae.weakened': 'enfraqueceu',
    'feedLarvae.shiftOver': 'turno encerrado',
    'feedLarvae.food': 'alimento',
    'feedLarvae.summaryFeeds': ({ feeds, perfect }) =>
      `${feeds} ${feeds === 1 ? 'alimentação' : 'alimentações'} (${perfect} ${perfect === 1 ? 'perfeita' : 'perfeitas'})`,
    'feedLarvae.summaryNoneWeak': ', nenhuma larva enfraquecida',
    'feedLarvae.summaryWeak': ({ n }) => `, ${n} ${n === 1 ? 'larva enfraquecida' : 'larvas enfraquecidas'}`,
    'feedLarvae.summaryLost': ({ n }) => `, ${n} ${n === 1 ? 'larva perdida' : 'larvas perdidas'}`,
  },
  en: {
    'feedLarvae.action': 'FEED',
    'feedLarvae.special': 'NURSES',
    'feedLarvae.nurseCall': 'nurse call',
    'feedLarvae.noFood': 'out of food - pots',
    'feedLarvae.waste': 'wasted',
    'feedLarvae.perfect': 'perfect',
    'feedLarvae.good': 'good',
    'feedLarvae.larvaLost': 'larva lost',
    'feedLarvae.weakened': 'weakened',
    'feedLarvae.shiftOver': 'shift over',
    'feedLarvae.food': 'food',
    'feedLarvae.summaryFeeds': ({ feeds, perfect }) =>
      `${feeds} ${feeds === 1 ? 'feeding' : 'feedings'} (${perfect} perfect)`,
    'feedLarvae.summaryNoneWeak': ', no larvae weakened',
    'feedLarvae.summaryWeak': ({ n }) => `, ${n} ${n === 1 ? 'larva' : 'larvae'} weakened`,
    'feedLarvae.summaryLost': ({ n }) => `, ${n} ${n === 1 ? 'larva' : 'larvae'} lost`,
  },
}
