// Procedural sound effects. The opening music lives in public/video/intro.mp4.
const STORAGE_KEY = 'vida-de-abelha.audio.v1'

export default class AudioSystem {
  constructor({ storage, AudioContext } = {}) {
    this.Context = AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext
    this.available = typeof this.Context === 'function'
    this.muted = false
    this.volume = 0.45
    this.effectsEnabled = true
    this.context = null
    this.paused = false
    this.notes = new Set()
    try {
      this.storage = storage ?? globalThis.localStorage
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        this.muted = saved.muted === true
        this.effectsEnabled = saved.effectsEnabled !== false
        if (Number.isFinite(saved.volume)) this.volume = Math.max(0, Math.min(1, saved.volume))
      }
    } catch { /* Storage may be disabled; settings still work for this session. */ }
  }

  persist() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({
        muted: this.muted, volume: this.volume, effectsEnabled: this.effectsEnabled,
      }))
    } catch { /* Private browsing and full storage must not interrupt play. */ }
  }

  async unlock() {
    if (!this.available) return false
    try {
      if (!this.context) {
        this.context = new this.Context()
        this.master = this.context.createGain()
        this.master.gain.value = this.outputGain()
        this.master.connect(this.context.destination)
      }
      if (!this.paused && this.context.state !== 'running') await this.context.resume()
      return this.context.state === 'running'
    } catch { return false }
  }

  outputGain() { return this.muted ? 0 : this.volume }
  applyGain() {
    if (this.context) this.master.gain.setTargetAtTime(this.outputGain(), this.context.currentTime, 0.08)
  }
  setMuted(value) {
    this.muted = Boolean(value)
    this.applyGain()
    this.persist()
  }
  toggleMuted() { this.setMuted(!this.muted) }
  setVolume(value) {
    if (!Number.isFinite(value)) return
    this.volume = Math.max(0, Math.min(1, value))
    this.applyGain()
    this.persist()
  }
  setEffectsEnabled(value) { this.effectsEnabled = Boolean(value); this.persist() }

  stopNotes() {
    for (const note of this.notes) {
      try { note.osc.stop() } catch { /* Already ended. */ }
      note.osc.disconnect()
      note.envelope.disconnect()
      this.notes.delete(note)
    }
  }

  tone(midi, start, duration, level) {
    const ctx = this.context
    if (!ctx || ctx.state !== 'running') return
    const osc = ctx.createOscillator()
    const envelope = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(level, start + 0.06)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(envelope)
    envelope.connect(this.master)
    const note = { osc, envelope }
    this.notes.add(note)
    osc.onended = () => {
      osc.disconnect()
      envelope.disconnect()
      this.notes.delete(note)
    }
    osc.start(start)
    osc.stop(start + duration + 0.02)
  }

  playResult(score = 0.5) {
    if (!this.effectsEnabled || this.paused || this.context?.state !== 'running') return
    const now = this.context.currentTime
    const notes = score >= 0.5 ? [67, 72, 76] : [64, 62, 60]
    notes.forEach((midi, i) => this.tone(midi, now + i * 0.12, 0.55, 0.13))
  }
  playPromotion() {
    if (!this.effectsEnabled || this.paused || this.context?.state !== 'running') return
    const now = this.context.currentTime
    ;[60, 64, 67, 72].forEach((midi, i) => this.tone(midi, now + i * 0.14, 0.9, 0.13))
  }
  suspend() {
    this.paused = true
    this.stopNotes()
    try { this.context?.suspend()?.catch(() => {}) } catch { /* Unsupported audio state. */ }
  }
  resume() {
    this.paused = false
    if (this.context) return this.unlock()
    return Promise.resolve(false)
  }
  dispose() {
    this.stopNotes()
    try { this.context?.close()?.catch(() => {}) } catch { /* Already closed. */ }
    this.context = null
  }
}
