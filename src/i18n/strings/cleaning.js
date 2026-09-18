// Strings for cleaning. Keys must match between pt and en.
export default {
  pt: {
    'cleaning.hintTouch': 'arraste para voar · encoste para pegar · leve à entrada',
    'cleaning.hintKeys': 'WASD/setas ou mouse · encoste para pegar · leve à entrada',
    'cleaning.resinReadyTouch': 'resina pronta - toque RESINA',
    'cleaning.resinReadyKeys': 'resina pronta - tecla E',
    'cleaning.action': 'AÇÃO',
    'cleaning.special': 'RESINA',
    'cleaning.comb': 'favo',
    'cleaning.summary': ({ debris, pests, damage }) =>
      `${debris} ${debris === 1 ? 'detrito removido' : 'detritos removidos'}, ` +
      `${pests} ${pests === 1 ? 'traça capturada' : 'traças capturadas'}, ` +
      `favo ${damage}% danificado`,
    'cleaning.summaryResin': '; resina usada {n}×',
    'cleaning.summaryAnts': ({ n }) => `; ${n} ${n === 1 ? 'formiga repelida' : 'formigas repelidas'}`,
    'cleaning.invasion': 'Invasão!',
    'cleaning.freeShift': 'Turno livre',
  },
  en: {
    'cleaning.hintTouch': 'drag to fly · touch to grab · take it to the exit',
    'cleaning.hintKeys': 'WASD/arrows or mouse · touch to grab · take it to the exit',
    'cleaning.resinReadyTouch': 'resin ready - tap RESIN',
    'cleaning.resinReadyKeys': 'resin ready - press E',
    'cleaning.action': 'ACTION',
    'cleaning.special': 'RESIN',
    'cleaning.comb': 'comb',
    'cleaning.summary': ({ debris, pests, damage }) =>
      `${debris} debris removed, ` +
      `${pests} ${pests === 1 ? 'moth' : 'moths'} caught, ` +
      `comb ${damage}% damaged`,
    'cleaning.summaryResin': '; resin used {n}×',
    'cleaning.summaryAnts': ({ n }) => `; ${n} ${n === 1 ? 'ant' : 'ants'} repelled`,
    'cleaning.invasion': 'Invasion!',
    'cleaning.freeShift': 'Free shift',
  },
}
