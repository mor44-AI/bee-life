import test from 'node:test'
import assert from 'node:assert/strict'
import ScoreSystem, { multiplierFor, phaseBonusFor } from '../src/systems/ScoreSystem.js'
import { createLeaderboard, SEED, sanitizeName } from '../src/systems/Leaderboard.js'
import { FACTS, nextFact, resetFacts, factCategories } from '../src/data/facts.js'
import { installGameSession } from '../src/systems/GameSession.js'
import ColonyState from '../src/systems/ColonyState.js'
import { config } from '../src/data/config.js'
import { MODULES, setLang } from '../src/i18n/index.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}

function session(storage = { value: null, save(v) { this.value = structuredClone(v); return true }, load() { return this.value } }) {
  const c = { goTo(scene, data) { this.scene = scene; this.data = data } }
  installGameSession(c, storage)
  return { c, storage }
}

test('multiplicador por combo e expiração', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 9, 10, 40].map(multiplierFor), [1, 1, 1.5, 1.5, 2, 2, 3, 3])
  const s = new ScoreSystem()
  s.beginShift('cleaning')
  assert.equal(s.award(25), 25)
  assert.equal(s.award(25), 25)
  assert.equal(s.award(25), 38) // 3º acerto: ×1,5
  assert.equal(s.combo, 3)
  s.update(config.scoring.comboTimeout - 0.1)
  assert.equal(s.combo, 3)
  s.update(0.2)
  assert.equal(s.combo, 0, 'expira sem award')
  for (let i = 0; i < 10; i++) s.award(10)
  assert.equal(s.multiplier, 3)
  assert.equal(s.bestCombo, 10)
  s.miss()
  assert.equal(s.combo, 0)
  assert.equal(s.bestCombo, 10)
  assert.equal(s.award(0), 0)
  assert.equal(s.award(NaN), 0)
  assert.equal(s.combo, 0, 'award inválido não mexe no combo')
  assert.ok(s.popups.items.length > 0)
})

test('render não quebra com canvas falso', () => {
  const s = new ScoreSystem()
  s.beginShift('guard')
  for (let i = 0; i < 7; i++) s.award(25, { x: 10, y: 20, reason: 'score.reason.perfect' })
  s.award(25)
  s.miss()
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'canvas' ? { width: 400, height: 700 } : () => {}), set: () => true })
  s.update(0.1)
  s.render(ctx, { playfield: { x: 0, y: 50, w: 400, h: 600 }, uiScale: 1 })
  s.render(ctx, undefined)
})

test('endShift soma ação + bônus da fase; turno livre não soma no total', () => {
  const colony = new ColonyState({ health: 80, wax: 50, population: 60, pollen: 40, nectar: 70, propolis: 30 })
  assert.equal(phaseBonusFor('cleaning', colony), Math.round(900 * (0.6 * 0.8 + 0.4 * 0.5)))
  assert.equal(phaseBonusFor('feedLarvae', colony), Math.round(1000 * (0.5 * 0.6 + 0.5 * 0.4)))
  assert.equal(phaseBonusFor('feedQueen', colony), Math.round(1100 * (0.5 * 0.6 + 0.5 * 0.7)))
  assert.equal(phaseBonusFor('guard', colony), Math.round(1200 * (0.5 * 0.8 + 0.5 * 0.3)))
  assert.equal(phaseBonusFor('unknown', colony), 0)
  const s = new ScoreSystem()
  s.beginShift('cleaning')
  s.award(25); s.award(25); s.award(25)
  const r = s.endShift('cleaning', colony)
  assert.deepEqual(r, { taskId: 'cleaning', actionPoints: 88, phaseBonus: phaseBonusFor('cleaning', colony), points: 88 + phaseBonusFor('cleaning', colony), bestCombo: 3, free: false })
  assert.equal(s.total, r.points)
  assert.equal(s.active, false)
  s.beginShift('cleaning', { free: true })
  s.award(50)
  const f = s.endShift('cleaning', colony)
  assert.equal(f.free, true)
  assert.equal(s.total, r.points)
  assert.equal(s.history.length, 1)
})

test('finalBonus e finalScore pelo estado da colmeia', () => {
  const s = new ScoreSystem()
  s.total = 1000
  const colony = new ColonyState({ population: 50, nectar: 60, pollen: 60, propolis: 40, wax: 50, health: 70 })
  const fb = s.finalBonus(colony)
  assert.equal(fb.items.length, 6)
  assert.deepEqual(fb.items[0], { key: 'score.final.population', value: 50, points: 50 * config.scoring.finalBonus.perPoint })
  assert.equal(fb.total, 330 * config.scoring.finalBonus.perPoint)
  assert.equal(s.finalScore(colony), 1000 + fb.total)
  for (const item of fb.items) assert.ok(MODULES.score.pt[item.key] && MODULES.score.en[item.key], item.key)
})

test('calibração: vida completa simulada fica na faixa 20.000-40.000', () => {
  const { c } = session()
  c.newGame(); c.completeBirth()
  let shifts = 0
  while (c.scene !== 'end') {
    c.startShift()
    if (c.scene === 'end') break
    // Turno médio: ~40 acertos "normal" com duas quebras de combo.
    for (let i = 0; i < 40; i++) { if (i === 14 || i === 28) c.score.miss(); c.score.award(config.scoring.base.normal) }
    c.finishShift({ score: 60 })
    const pts = c.data.points
    assert.ok(pts.points >= 1500 && pts.points <= 3000, `turno ${pts.points}`)
    shifts++
    c.completeNight()
    if (c.scene === 'promotion') c.goTo('hub')
  }
  assert.equal(shifts, 10)
  assert.ok(c.data.finalScore >= 20000 && c.data.finalScore <= 40000, `vida ${c.data.finalScore}`)
  assert.equal(c.data.finalScore, c.data.shiftsTotal + c.data.finalBonus.total)
  assert.equal(c.data.shiftsTotal, c.score.total)
})

test('sessão: pontos no resultado, unlockedTasks/currentTask e turno livre', () => {
  const { c, storage } = session()
  c.newGame()
  assert.deepEqual(c.unlockedTasks(), [])
  assert.equal(c.currentTask(), null)
  c.completeBirth()
  assert.deepEqual(c.unlockedTasks(), ['cleaning'])
  assert.equal(c.currentTask(), 'cleaning')
  for (let i = 0; i < 2; i++) {
    c.startShift()
    assert.equal(c.data.free, false)
    c.score.award(25)
    c.finishShift({ score: 70 })
    assert.equal(c.data.points.actionPoints, 25)
    assert.equal(c.data.points.free, false)
    assert.equal(c.data.total, c.score.total)
    c.completeNight()
  }
  assert.equal(c.scene, 'promotion')
  c.goTo('hub')
  assert.deepEqual(c.unlockedTasks(), ['cleaning', 'feedLarvae'])
  assert.equal(c.currentTask(), 'feedLarvae')

  // Fase bloqueada/inexistente é ignorada.
  c.scene = 'hub'
  c.startShift('guard'); assert.equal(c.scene, 'hub')
  c.startShift('nope'); assert.equal(c.scene, 'hub')

  const day = c.time.currentDay
  const total = c.score.total
  const tasks = structuredClone(c.tasks.serialize())
  const before = c.colony.serialize()
  c.startShift('cleaning')
  assert.equal(c.scene, 'cleaning')
  assert.equal(c.data.free, true)
  assert.equal(c.data.shiftIndex, 1)
  c.score.award(25); c.score.award(25)
  c.finishShift({ score: 100 })
  assert.equal(c.scene, 'night')
  assert.equal(c.data.free, true)
  assert.equal(c.data.taskId, 'cleaning')
  assert.equal(c.data.points.free, true)
  assert.equal(c.time.currentDay, day, 'não consome dias')
  assert.equal(c.time.isNight, false)
  assert.equal(c.score.total, total, 'não soma no total')
  assert.deepEqual(c.tasks.serialize(), tasks, 'não conta para promoção')
  // Efeito na colônia pela metade do que o mesmo turno normal causaria.
  const full = ColonyState.deserialize(before)
  full.applyTaskResult('cleaning', 100)
  for (const key of ['health', 'wax', 'propolis', 'population']) {
    assert.ok(Math.abs(c.colony[key] - (before[key] + (full[key] - before[key]) / 2)) < 1e-9, key)
  }
  assert.ok(c.colony.wax > before.wax)
  assert.equal(storage.value.scene, 'hub', 'recarregar no cartão volta ao hub')
  c.finishShift({ score: 100 })
  assert.equal(c.colony.wax, before.wax + (full.wax - before.wax) / 2, 'callback duplicado ignorado')
  c.completeNight()
  assert.equal(c.scene, 'hub')
  c.startShift()
  assert.equal(c.scene, 'feedLarvae')
  assert.equal(c.data.shiftIndex, 0)
  assert.equal(c.data.free, false)
})

test('save/restore com pontuação e save antigo sem pontuação', () => {
  const { c, storage } = session()
  c.newGame(); c.completeBirth()
  c.startShift(); c.score.award(25); c.score.award(25); c.finishShift({ score: 60 }); c.completeNight()
  const total = c.score.total
  assert.ok(total > 0)
  const restored = session(storage).c
  restored.continueGame()
  assert.equal(restored.score.total, total)
  assert.equal(restored.score.history.length, 1)
  assert.equal(restored.score.history[0].actionPoints, 50)

  // Save antigo (sem campo score) carrega com total 0.
  delete storage.value.score
  const legacy = session(storage).c
  legacy.continueGame()
  assert.equal(legacy.score.total, 0)
  legacy.startShift(); legacy.finishShift({ score: 50 })
  assert.ok(legacy.score.total > 0)

  assert.equal(ScoreSystem.deserialize({ total: 'x', history: [{ points: 10 }, null, { points: 'bad' }] }).total, 10)
  // Nova vida zera o placar.
  legacy.completeNight(); legacy.newGame()
  assert.equal(legacy.score.total, 0)
})

test('leaderboard: seed, add, qualifies, rankOf, best e sanitização', () => {
  setLang('pt', { storage: { setItem() {} } })
  assert.ok(SEED.length >= 6 && SEED.length <= 8)
  assert.ok(SEED.every((e) => e.dummy && e.score >= 3000 && e.score <= 12000))
  const storage = memoryStorage()
  const board = createLeaderboard({ storage })
  assert.equal(board.top().length, SEED.length)
  assert.equal(board.best(), 0)
  assert.equal(board.qualifies(0), false)
  assert.equal(board.qualifies(100), true, 'lista com vagas')
  assert.equal(board.rankOf(25000), 1)
  const r = board.add('  Maria   da   Silva de Souza  ', 25000)
  assert.equal(r.rank, 1)
  assert.equal(r.entry.name, 'Maria da Silva d')
  assert.equal(r.entry.name.length, 16)
  assert.equal(board.best(), 25000)
  assert.equal(board.add('', 5).entry.name, 'Abelha')
  setLang('en', { storage: { setItem() {} } })
  assert.equal(sanitizeName('   '), 'Bee')
  assert.equal(sanitizeName('a<b>c'), 'abc')
  // Persistiu: nova instância lê o storage.
  const again = createLeaderboard({ storage })
  assert.equal(again.top(1)[0].score, 25000)
  assert.equal(again.top(1)[0].dummy, false)
  // Enche o top 10 e verifica corte.
  for (let i = 0; i < 10; i++) again.add('x', 20000 + i)
  assert.equal(again.qualifies(4000), false)
  assert.equal(again.qualifies(30000), true)
  assert.equal(again.top(10).length, 10)
  assert.equal(again.add('x', -1), null)
})

test('leaderboard tolera storage quebrado', () => {
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('quota') } }
  const board = createLeaderboard({ storage: broken })
  assert.equal(board.top().length, SEED.length)
  const r = board.add('Zé', 15000)
  assert.equal(r.rank, 1)
  assert.equal(board.saveFailed, true)
  assert.equal(board.top(1)[0].name, 'Zé', 'mantém em memória')
  const corrupt = createLeaderboard({ storage: memoryStorage({ 'bee-life.leaderboard.v1': '{bad' }) })
  assert.equal(corrupt.top().length, SEED.length)
  const none = createLeaderboard({ storage: null })
  assert.equal(none.add('a', 1).rank > 0, true)
})

test('curiosidades: sem repetição até esgotar, strings pt/en para todas', () => {
  const ids = FACTS.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const f of FACTS) {
    assert.ok(factCategories.includes(f.category), f.id)
    assert.ok(MODULES.facts.pt[`facts.${f.id}`], `pt facts.${f.id}`)
    assert.ok(MODULES.facts.en[`facts.${f.id}`], `en facts.${f.id}`)
  }
  const storage = memoryStorage()
  resetFacts({ storage })
  const first = Array.from({ length: FACTS.length }, () => nextFact({ storage }))
  assert.deepEqual(first.map((f) => f.id).sort(), [...ids].sort())
  assert.ok(first.every((f) => f.key === `facts.${f.id}`))
  const second = Array.from({ length: FACTS.length }, () => nextFact({ storage }))
  assert.deepEqual(second.map((f) => f.id).sort(), [...ids].sort())
  assert.notEqual(second[0].id, first.at(-1).id, 'não repete na virada')
  // Storage quebrado: segue em memória, sem lançar.
  const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() {} }
  resetFacts({ storage: broken })
  const mem = Array.from({ length: FACTS.length }, () => nextFact({ storage: broken }).id)
  assert.equal(new Set(mem).size, FACTS.length)
  // Baralho salvo de uma lista antiga é refeito.
  storage.setItem('bee-life.facts.v1', JSON.stringify({ order: ['gone'], i: 0 }))
  assert.ok(ids.includes(nextFact({ storage }).id))
})
