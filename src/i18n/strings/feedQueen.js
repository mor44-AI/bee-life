// Strings for feedQueen. Keys must match between pt and en.
export default {
  pt: {
    'feedQueen.hunger': 'fome da rainha',
    'feedQueen.chamber': 'câmara real',
    'feedQueen.scale': '5 mm',
    'feedQueen.special': 'Abrir caminho',
    'feedQueen.specialButton': 'ABRIR',
    'feedQueen.summary.feeds': ({ n }) => `${n} ${n === 1 ? 'alimentação' : 'alimentações'}`,
    'feedQueen.summary.crit': ({ s }) => `rainha em fome crítica por ${s}s`,
    'feedQueen.summary.noCrit': 'rainha nunca passou fome crítica',
    'feedQueen.summary': '{feeds}, {crit}',
  },
  en: {
    'feedQueen.hunger': "queen's hunger",
    'feedQueen.chamber': 'royal chamber',
    'feedQueen.scale': '5 mm',
    'feedQueen.special': 'Clear the Way',
    'feedQueen.specialButton': 'CLEAR',
    'feedQueen.summary.feeds': ({ n }) => `${n} ${n === 1 ? 'feeding' : 'feedings'}`,
    'feedQueen.summary.crit': ({ s }) => `queen critically hungry for ${s}s`,
    'feedQueen.summary.noCrit': 'queen never went critically hungry',
    'feedQueen.summary': '{feeds}, {crit}',
  },
}
