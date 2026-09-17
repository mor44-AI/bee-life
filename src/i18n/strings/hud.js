// Strings for hud (HUD, IndicatorBar, Controls, TaskHubState). Keys must match between pt and en.
// rank.<id> is shared: other screens call t('rank.cleaning') etc.

const turnsPt = (n) => `${n} ${n === 1 ? 'turno' : 'turnos'}`
const turnsEn = (n) => `${n} ${n === 1 ? 'shift' : 'shifts'}`

export default {
  pt: {
    'rank.larva': 'Larva',
    'rank.cleaning': 'Faxineira',
    'rank.feedLarvae': 'Nutriz',
    'rank.feedQueen': 'Atendente da Rainha',
    'rank.guard': 'Guardiã',

    'hud.indicator.population': 'População',
    'hud.indicator.population.short': 'Pop.',
    'hud.indicator.nectar': 'Néctar',
    'hud.indicator.nectar.short': 'Néctar',
    'hud.indicator.pollen': 'Pólen',
    'hud.indicator.pollen.short': 'Pólen',
    'hud.indicator.propolis': 'Própolis',
    'hud.indicator.propolis.short': 'Própol.',
    'hud.indicator.wax': 'Cera',
    'hud.indicator.wax.short': 'Cera',
    'hud.indicator.health': 'Saúde',
    'hud.indicator.health.short': 'Saúde',

    'hud.dayOf': 'de {max}',
    'hud.role': 'FUNÇÃO',
    'hud.progress.next': ({ n, rank }) => `${turnsPt(n)} até ${rank}`,
    'hud.progress.end': ({ n }) => `${turnsPt(n)} até o fim do Marco 1`,
    'hud.hint.touch': 'toque para {verb}',
    'hud.hint.desktop': 'clique ou Enter para {verb}',
    'hud.verb.continue': 'continuar',

    'hub.didYouKnow': 'VOCÊ SABIA?',
    'hub.startShift': 'Iniciar turno',
    'hub.beBorn': 'Nascer',
    'hub.shiftCaption': '{rank} · turno {n} de {total}',

    'controls.action': 'AÇÃO',
    'controls.special': 'ESPECIAL',
    'controls.ready': 'PRONTO',
    'controls.active': 'ATIVO',
    'controls.key.action': 'Espaço',
    'controls.key.special': 'E / Shift',
    'controls.key.arrows': 'setas',
  },
  en: {
    'rank.larva': 'Larva',
    'rank.cleaning': 'Housekeeper',
    'rank.feedLarvae': 'Nurse',
    'rank.feedQueen': "Queen's Attendant",
    'rank.guard': 'Guard',

    'hud.indicator.population': 'Population',
    'hud.indicator.population.short': 'Pop.',
    'hud.indicator.nectar': 'Nectar',
    'hud.indicator.nectar.short': 'Nectar',
    'hud.indicator.pollen': 'Pollen',
    'hud.indicator.pollen.short': 'Pollen',
    'hud.indicator.propolis': 'Propolis',
    'hud.indicator.propolis.short': 'Prop.',
    'hud.indicator.wax': 'Wax',
    'hud.indicator.wax.short': 'Wax',
    'hud.indicator.health': 'Health',
    'hud.indicator.health.short': 'Health',

    'hud.dayOf': 'of {max}',
    'hud.role': 'ROLE',
    'hud.progress.next': ({ n, rank }) => `${turnsEn(n)} until ${rank}`,
    'hud.progress.end': ({ n }) => `${turnsEn(n)} until the end of Chapter 1`,
    'hud.hint.touch': 'tap to {verb}',
    'hud.hint.desktop': 'click or press Enter to {verb}',
    'hud.verb.continue': 'continue',

    'hub.didYouKnow': 'DID YOU KNOW?',
    'hub.startShift': 'Start shift',
    'hub.beBorn': 'Emerge',
    'hub.shiftCaption': '{rank} · shift {n} of {total}',

    'controls.action': 'ACTION',
    'controls.special': 'SPECIAL',
    'controls.ready': 'READY',
    'controls.active': 'ACTIVE',
    'controls.key.action': 'Space',
    'controls.key.special': 'E / Shift',
    'controls.key.arrows': 'arrows',
  },
}
