// Strings for guard. Keys must match between pt and en.
export default {
  pt: {
    'guard.special': 'Alarme de feromônio',
    'guard.actionButton': 'INVESTIR',
    'guard.specialButton': 'ALARME',
    'guard.summary.repelled': ({ n }) => `${n} ${n === 1 ? 'intruso repelido' : 'intrusos repelidos'}`,
    'guard.summary.breaches': ({ n }) => `${n} ${n === 1 ? 'brecha' : 'brechas'}`,
    'guard.summary.friendly': ({ n }) => `${n} ${n === 1 ? 'companheira atingida' : 'companheiras atingidas'}`,
    'guard.summary.byAlarm': ' ({n} pelo alarme)',
    'guard.summary.intact': ' - entrada intacta',
  },
  en: {
    'guard.special': 'Alarm Pheromone',
    'guard.actionButton': 'LUNGE',
    'guard.specialButton': 'ALARM',
    'guard.summary.repelled': ({ n }) => `${n} ${n === 1 ? 'intruder repelled' : 'intruders repelled'}`,
    'guard.summary.breaches': ({ n }) => `${n} ${n === 1 ? 'breach' : 'breaches'}`,
    'guard.summary.friendly': ({ n }) => `${n} ${n === 1 ? 'nestmate struck' : 'nestmates struck'}`,
    'guard.summary.byAlarm': ' ({n} by the alarm)',
    'guard.summary.intact': ' - entrance intact',
  },
}
