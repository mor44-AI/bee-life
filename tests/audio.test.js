import test from 'node:test'
import assert from 'node:assert/strict'
import AudioSystem from '../src/systems/AudioSystem.js'

class FakeContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.oscillators = [] }
  createGain() {
    return {
      gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} },
      connect() {}, disconnect() {},
    }
  }
  createOscillator() {
    const oscillator = { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true } }
    this.oscillators.push(oscillator)
    return oscillator
  }
  async resume() { this.state = 'running' }
  async suspend() { this.state = 'suspended' }
  async close() { this.state = 'closed' }
}

test('audio settings persist, clamp volume, and tolerate malformed storage', () => {
  let saved = '{invalid'
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value } }
  const audio = new AudioSystem({ storage, AudioContext: FakeContext })
  assert.equal(audio.volume, 0.45)
  audio.setVolume(3)
  audio.setMuted(true)
  audio.setEffectsEnabled(false)
  const restored = new AudioSystem({ storage, AudioContext: FakeContext })
  assert.equal(restored.volume, 1)
  assert.equal(restored.muted, true)
  assert.equal(restored.effectsEnabled, false)
  restored.setVolume(NaN)
  assert.equal(restored.volume, 1)
})

test('sound waits for gesture, mute silences all output, and dispose closes the context', async () => {
  const audio = new AudioSystem({ AudioContext: FakeContext })
  audio.playResult(1)
  assert.equal(audio.context, null)
  assert.equal(await audio.unlock(), true)
  assert.equal(audio.outputGain(), 0.45)
  audio.setMuted(true)
  assert.equal(audio.outputGain(), 0)
  audio.setVolume(0.8)
  assert.equal(audio.outputGain(), 0)
  audio.setMuted(false)
  assert.equal(audio.outputGain(), 0.8)
  const context = audio.context
  audio.dispose()
  assert.equal(context.state, 'closed')
})

test('visibility suspension cancels sounds and disabled effects stay silent', async () => {
  const audio = new AudioSystem({ AudioContext: FakeContext })
  await audio.unlock()
  audio.playPromotion()
  assert.equal(audio.notes.size, 4)
  audio.suspend()
  assert.equal(audio.notes.size, 0)
  audio.playResult(1)
  assert.equal(audio.notes.size, 0)
  await audio.resume()
  audio.setEffectsEnabled(false)
  audio.playPromotion()
  assert.equal(audio.notes.size, 0)
})

test('unavailable audio and rejected resume never reject gameplay actions', async () => {
  const brokenStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
  const unavailable = new AudioSystem({ storage: brokenStorage, AudioContext: false })
  assert.equal(await unavailable.unlock(), false)
  unavailable.toggleMuted()
  unavailable.playPromotion()
  unavailable.dispose()
  class BlockedContext extends FakeContext { async resume() { throw Error('gesture required') } }
  const blocked = new AudioSystem({ AudioContext: BlockedContext })
  assert.equal(await blocked.unlock(), false)
  blocked.playResult(1)
})
