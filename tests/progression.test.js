import test from 'node:test'
import assert from 'node:assert/strict'
import { installGameSession, readSessionSave } from '../src/systems/GameSession.js'
import { config, difficultyFor } from '../src/data/config.js'
import { promotionProgress } from '../src/ui/HUD.js'
import SaveSystem from '../src/systems/SaveSystem.js'
import InputManager from '../src/engine/InputManager.js'

function setup(storage = { value: null, save(value) { this.value = structuredClone(value); return true }, load() { return this.value } }) {
  const c = { goTo(scene, data) { this.scene = scene; this.data = data } }
  installGameSession(c, storage)
  return { c, storage }
}

for (const score of [0, 50, 100]) test(`10 turnos com pontuação ${score}, sem promoção antecipada ou repetição`, () => {
  const { c } = setup()
  c.newGame()
  assert.equal(c.scene, 'birth')
  c.completeBirth()
  for (const rank of ['cleaning', 'feedLarvae', 'feedQueen', 'guard']) {
    for (let i = 0; i < config.turnsPerTask[rank]; i++) {
      assert.equal(c.tasks.currentRank, rank)
      assert.equal(promotionProgress(c).turnsLeft, config.turnsPerTask[rank] - i)
      c.startShift()
      assert.equal(c.scene, rank)
      assert.equal(c.data.shiftIndex, i)
      assert.ok(c.data.difficulty >= 0.57)
      c.finishShift({ score })
      const day = c.time.currentDay
      c.finishShift({ score })
      assert.equal(c.time.currentDay, day, 'callback duplicado não avança o dia')
      assert.equal(c.scene, 'night')
      assert.equal(c.time.isNight, true)
      c.completeNight()
      assert.equal(c.time.isNight, false)
      assert.equal(c.scene, i < config.turnsPerTask[rank] - 1 ? 'hub' : rank === 'guard' ? 'end' : 'promotion')
    }
    assert.equal(c.tasks.getCompletedShifts(rank), config.turnsPerTask[rank])
  }
  assert.equal(c.time.currentDay, 31)
  assert.equal(c.data.reason, 'completed')
  c.startShift()
  assert.equal(c.scene, 'end')
})

test('salvamento restaura histórico, dificuldade, promoção e nova partida', () => {
  const { c, storage } = setup()
  c.newGame(); c.completeBirth()
  c.startShift(); c.finishShift({ score: 20 }); c.completeNight()
  const restored = setup(storage).c
  assert.equal(restored.hasSave(), true)
  restored.continueGame()
  assert.equal(restored.time.currentDay, 4)
  assert.deepEqual(restored.colony.serialize(), c.colony.serialize())
  restored.startShift()
  assert.equal(restored.data.shiftIndex, 1)
  assert.equal(restored.data.difficulty, difficultyFor('cleaning', 1, [20]))
  restored.finishShift({ score: 80 })
  const promoted = setup(storage).c
  promoted.continueGame()
  assert.equal(promoted.scene, 'night')
  promoted.completeNight()
  assert.equal(promoted.scene, 'promotion')
  assert.deepEqual(promoted.data, { from: 'cleaning', to: 'feedLarvae' })
  promoted.startShift()
  assert.equal(promoted.data.shiftIndex, 0)
  promoted.newGame(); promoted.completeBirth()
  assert.equal(promoted.time.currentDay, 1)
  assert.deepEqual(promoted.tasks.history, {})
})

test('duração e dificuldade iniciais são centralizadas', () => {
  assert.equal(config.shiftDuration, 60 * 0.7)
  for (const rank of ['cleaning', 'feedLarvae', 'feedQueen', 'guard']) {
    const shortened = ['cleaning', 'feedLarvae'].includes(rank)
    assert.equal(config.turnsPerTask[rank], shortened ? 2 : 3)
    assert.equal(difficultyFor(rank, 0), shortened ? difficultyFor('feedQueen', 1) : 0.57)
    if (shortened) assert.equal(difficultyFor(rank, 1), difficultyFor('feedQueen', 2))
  }
})

test('save ausente ou inválido não habilita continuar', () => {
  for (const value of [null, {}, { version: 1, tasks: null }]) {
    const { c } = setup({ load: () => value, save() {} })
    assert.equal(c.hasSave(), false)
  }
})

test('SaveSystem tolera JSON corrompido e armazenamento indisponível', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem() { return '{quebrado' }, setItem() { throw new Error('quota') },
    } })
    assert.equal(SaveSystem.load(), null)
    assert.equal(SaveSystem.save({}), false)
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old)
    else delete globalThis.localStorage
  }
})

test('entrada de teclado dura um frame e soltar a tecla encerra o movimento', () => {
  const oldWindow = globalThis.window
  const oldDocument = globalThis.document
  const listeners = new Map()
  globalThis.window = {
    PointerEvent: class {},
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener() {},
  }
  const canvas = { addEventListener() {}, removeEventListener() {} }
  globalThis.document = { body: {} }
  const input = new InputManager(canvas)
  try {
    const key = { code: 'ArrowRight', target: canvas, repeat: false, preventDefault() {} }
    listeners.get('keydown')(key)
    assert.equal(input.wasKeyPressed('ArrowRight'), true)
    input.endFrame()
    assert.equal(input.wasKeyPressed('ArrowRight'), false)
    assert.equal(input.isKeyDown('ArrowRight'), true)
    listeners.get('keyup')(key)
    assert.equal(input.isKeyDown('ArrowRight'), false)
    input.endFrame()
    assert.equal(input.wasKeyReleased('ArrowRight'), false)
  } finally {
    input.destroy()
    if (oldWindow === undefined) delete globalThis.window
    else globalThis.window = oldWindow
    if (oldDocument === undefined) delete globalThis.document
    else globalThis.document = oldDocument
  }
})

test('save antigo remove o primeiro turno das duas primeiras fases uma única vez', () => {
  const { c, storage } = setup()
  c.newGame(); c.completeBirth()
  storage.value.version = 1
  storage.value.tasks.history = { cleaning: [10, 40, 90], feedLarvae: [30], feedQueen: [70] }
  storage.value.tasks.currentRank = 'feedLarvae'
  storage.value.time.currentDay = 13
  const before = structuredClone(storage.value.colony)
  c.continueGame()
  assert.deepEqual(c.tasks.getScores('cleaning'), [40, 90])
  assert.deepEqual(c.tasks.getScores('feedLarvae'), [])
  assert.deepEqual(c.tasks.getScores('feedQueen'), [70])
  assert.equal(c.time.currentDay, 13)
  assert.deepEqual(c.colony.serialize(), before)
  assert.equal(storage.value.version, 2)
  c.continueGame()
  assert.deepEqual(c.tasks.getScores('cleaning'), [40, 90])
})

test('retomar durante a noite não duplica pontuação, desgaste nem dias', () => {
  const { c, storage } = setup()
  c.newGame(); c.completeBirth(); c.startShift(); c.finishShift({ score: 10 })
  const saved = structuredClone(storage.value)
  const loaded = setup(storage).c
  loaded.continueGame()
  loaded.startShift()
  assert.equal(loaded.scene, 'night')
  loaded.completeNight(); loaded.completeNight()
  assert.equal(loaded.scene, 'hub')
  assert.equal(loaded.time.currentDay, saved.time.currentDay)
  assert.deepEqual(loaded.tasks.serialize(), saved.tasks)
  assert.deepEqual(loaded.colony.serialize(), saved.colony)
})

test('fim de vida e save malformado têm destino seguro', () => {
  const { c, storage } = setup()
  c.newGame(); c.completeBirth()
  c.time.maxDays = 1
  c.startShift(); c.finishShift({ score: 20 }); c.completeNight()
  assert.equal(c.scene, 'end')
  assert.equal(c.data.reason, 'lifeOver')
  storage.value.scene = 'night'
  storage.value.data = { nextScene: 'missing' }
  assert.equal(readSessionSave(storage), null)
})

test('partida encerrada não oferece Continuar e Novo Jogo recomeça', () => {
  for (const reason of ['completed', 'lifeOver']) {
    const { c, storage } = setup()
    c.newGame(); c.completeBirth()
    if (reason === 'lifeOver') {
      c.time.maxDays = 1
      c.startShift(); c.finishShift({ score: 20 })
    } else {
      for (const rank of ['cleaning', 'feedLarvae', 'feedQueen', 'guard']) {
        for (let i = 0; i < config.turnsPerTask[rank]; i++) {
          c.startShift(); c.finishShift({ score: 60 }); c.completeNight()
          if (c.scene === 'promotion') c.goTo('hub')
        }
      }
    }
    if (reason === 'lifeOver') {
      assert.equal(setup(storage).c.hasSave(), true, 'noite antes do fim ainda pode ser retomada')
      c.completeNight()
    }
    assert.equal(c.scene, 'end')
    assert.equal(c.data.reason, reason)
    assert.equal(storage.value.scene, 'end')
    const menu = setup(storage).c
    assert.equal(menu.hasSave(), false)
    menu.continueGame()
    assert.equal(menu.scene, 'birth')
    menu.newGame(); menu.completeBirth()
    assert.equal(menu.time.currentDay, 1)
    assert.equal(menu.hasSave(), true)
  }
})

test('recarregar após a promoção volta ao hub sem repetir a animação nem contar turno', () => {
  const { c, storage } = setup()
  c.newGame(); c.completeBirth()
  for (let i = 0; i < config.turnsPerTask.cleaning; i++) { c.startShift(); c.finishShift({ score: 70 }); c.completeNight() }
  assert.equal(c.scene, 'promotion')
  assert.deepEqual(c.data, { from: 'cleaning', to: 'feedLarvae' })
  assert.equal(storage.value.scene, 'hub')
  const saved = structuredClone(storage.value)
  const reloaded = setup(storage).c
  assert.equal(reloaded.hasSave(), true)
  reloaded.continueGame()
  assert.equal(reloaded.scene, 'hub')
  assert.equal(reloaded.tasks.currentRank, 'feedLarvae')
  assert.equal(reloaded.time.currentDay, saved.time.currentDay)
  assert.deepEqual(reloaded.tasks.serialize(), saved.tasks)
  reloaded.startShift()
  assert.equal(reloaded.scene, 'feedLarvae')
  assert.equal(reloaded.data.shiftIndex, 0)
})
