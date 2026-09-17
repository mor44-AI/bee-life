// Original procedural score. No media files or network requests are needed.
const STORAGE_KEY = 'vida-de-abelha.audio.v1'
const MELODY = [0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 9, 12, 14, 12, 7, 4]

export default class AudioSystem {
  constructor({ storage, AudioContext } = {}) {
    this.Context = AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext
    this.available = typeof this.Context === 'function'
    this.muted = false
    this.volume = 0.45
    this.effectsEnabled = true
    this.context = null
    this.intro = false
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
        this.master.gain.value = this.volume
        this.master.connect(this.context.destination)
        this.music = this.context.createGain()
        this.music.gain.value = this.muted ? 0 : 1
        this.music.connect(this.master)
        this.nextNote = this.context.currentTime
      }
      if (!this.paused && this.context.state !== 'running') await this.context.resume()
      return this.context.state === 'running'
    } catch { return false }
  }

  setMuted(value) {
    this.muted = Boolean(value)
    if (this.context) this.music.gain.setTargetAtTime(this.muted ? 0 : 1, this.context.currentTime, 0.08)
    this.persist()
  }
  toggleMuted() { this.setMuted(!this.muted) }
  setVolume(value) {
    if (!Number.isFinite(value)) return
    this.volume = Math.max(0, Math.min(1, value))
    if (this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.08)
    this.persist()
  }
  setEffectsEnabled(value) { this.effectsEnabled = Boolean(value); this.persist() }

  startIntro() {
    this.intro = true
    this.step = 0
    this.nextNote = this.context?.currentTime ?? 0
  }
  stopIntro() {
    this.intro = false
    this.stopNotes('music')
  }
  stopNotes(kind) {
    for (const note of this.notes) {
      if (kind && note.kind !== kind) continue
      try { note.osc.stop() } catch { /* Already ended. */ }
      note.osc.disconnect()
      note.envelope.disconnect()
      this.notes.delete(note)
    }
  }

  tone(midi, start, duration, level, kind = 'music') {
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
    envelope.connect(kind === 'music' ? this.music : this.master)
    const note = { osc, envelope, kind }
    this.notes.add(note)
    osc.onended = () => {
      osc.disconnect()
      envelope.disconnect()
      this.notes.delete(note)
    }
    osc.start(start)
    osc.stop(start + duration + 0.02)
  }

  update() {
    if (!this.intro || this.paused || this.context?.state !== 'running') return
    const now = this.context.currentTime
    if (this.nextNote < now - 0.2) this.nextNote = now
    while (this.nextNote < now + 0.15) {
      const step = this.step++
      this.tone(60 + MELODY[step % MELODY.length], this.nextNote, 1.4, 0.13)
      if (step % 4 === 0) {
        const root = [48, 45, 53, 55][Math.floor(step / 4) % 4]
        this.tone(root, this.nextNote, 2.9, 0.1)
        this.tone(root + 7, this.nextNote, 2.6, 0.045)
      }
      this.nextNote += 0.66
    }
  }

  playResult(score = 0.5) {
    if (!this.effectsEnabled || this.paused || this.context?.state !== 'running') return
    const now = this.context.currentTime
    const notes = score >= 0.5 ? [67, 72, 76] : [64, 62, 60]
    notes.forEach((midi, i) => this.tone(midi, now + i * 0.12, 0.55, 0.13, 'effect'))
  }
  playPromotion() {
    if (!this.effectsEnabled || this.paused || this.context?.state !== 'running') return
    const now = this.context.currentTime
    ;[60, 64, 67, 72].forEach((midi, i) => this.tone(midi, now + i * 0.14, 0.9, 0.13, 'effect'))
  }
  suspend() {
    this.paused = true
    this.stopNotes()
    try { this.context?.suspend()?.catch(() => {}) } catch { /* Unsupported audio state. */ }
  }
  resume() {
    this.paused = false
    this.nextNote = this.context?.currentTime ?? 0
    if (this.context) return this.unlock()
    return Promise.resolve(false)
  }
  dispose() {
    this.stopIntro()
    this.stopNotes()
    try { this.context?.close()?.catch(() => {}) } catch { /* Already closed. */ }
    this.context = null
  }
}
