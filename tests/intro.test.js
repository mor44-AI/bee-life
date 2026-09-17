import test from 'node:test'
import assert from 'node:assert/strict'
import { INTRO_SEEN_KEY, hasSeenIntro, markIntroSeen, shouldPlayIntro } from '../src/states/IntroState.js'

function memoryStorage() {
  const data = new Map()
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)) } }
}

test('intro plays on first visit only, unless replay is requested', () => {
  const storage = memoryStorage()
  assert.equal(hasSeenIntro(storage), false)
  assert.equal(shouldPlayIntro({ storage }), true)
  markIntroSeen(storage)
  assert.equal(storage.getItem(INTRO_SEEN_KEY), '1')
  assert.equal(shouldPlayIntro({ storage }), false)
  assert.equal(shouldPlayIntro({ storage, replay: true }), true)
})

test('unavailable or throwing storage never breaks the intro flag', () => {
  const throwing = { getItem() { throw Error('SecurityError') }, setItem() { throw Error('QuotaExceeded') } }
  assert.doesNotThrow(() => markIntroSeen(throwing))
  assert.equal(hasSeenIntro(throwing), false)
  assert.equal(shouldPlayIntro({ storage: throwing }), true)
  assert.equal(hasSeenIntro(null), false)
  assert.doesNotThrow(() => markIntroSeen(null))
})
