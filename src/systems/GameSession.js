import ColonyState from './ColonyState.js'
import TimeSystem from './TimeSystem.js'
import TaskSystem, { RANK_ORDER } from './TaskSystem.js'
import SaveSystem from './SaveSystem.js'
import { config, difficultyFor } from '../data/config.js'

const SCENES = ['birth', 'hub', 'promotion', 'night', 'end']

export function readSessionSave(storage = SaveSystem) {
  const save = storage.load()
  if (![1, 2].includes(save?.version) || !RANK_ORDER.includes(save.tasks?.currentRank)
    || !save.colony || !save.time || !SCENES.includes(save.scene)
    || !Number.isFinite(save.time.currentDay) || save.time.currentDay < 1
    || !Number.isFinite(save.time.maxDays) || save.time.maxDays < 1) return null
  if (save.scene === 'night' && (!save.data || !['hub', 'promotion', 'end'].includes(save.data.nextScene))) return null
  const result = structuredClone(save)
  if (result.version === 1) {
    // Saves da regra antiga mantêm dias/colônia e descartam apenas o turno removido.
    for (const rank of ['cleaning', 'feedLarvae']) {
      const scores = result.tasks.history?.[rank]
      if (Array.isArray(scores)) result.tasks.history[rank] = scores.slice(1)
    }
    result.version = 2
  }
  return result
}

// O resultado é salvo antes da noite. Recarregar não cobra os dias novamente.
export function installGameSession(context, storage = SaveSystem) {
  let activeShift = null
  let night = null
  // resumeScene: cena gravada para retomada, quando difere da exibida agora.
  const saveAt = (scene, data, resumeScene = scene) => {
    const resumeData = resumeScene === scene ? data : undefined
    context.saveFailed = !storage.save({ version: 2, scene: resumeScene, data: resumeData,
      tasks: context.tasks.serialize(), time: context.time.serialize(), colony: context.colony.serialize() })
    context.goTo(scene, data)
  }
  // A promoção já foi aplicada em tasks; retomar deve cair no hub, sem repetir a animação.
  const showPromotion = (data) => saveAt('promotion', data, 'hub')
  // Partida encerrada (Marco 1 concluído ou fim de vida) não é oferecida como "Continuar".
  context.hasSave = () => {
    const save = readSessionSave(storage)
    return !!save && save.scene !== 'end'
  }
  context.newGame = () => {
    activeShift = null
    night = null
    context.colony = new ColonyState()
    context.time = new TimeSystem()
    context.tasks = new TaskSystem()
    saveAt('birth')
  }
  context.continueGame = () => {
    const save = readSessionSave(storage)
    if (!save || save.scene === 'end') return context.newGame()
    activeShift = null
    night = save.scene === 'night' ? save.data : null
    context.colony = ColonyState.deserialize(save.colony)
    context.time = TimeSystem.deserialize(save.time)
    context.tasks = TaskSystem.deserialize(save.tasks)
    // Regrava a versão migrada, sem perder o ponto de retomada.
    saveAt(save.scene, save.data)
  }
  context.completeBirth = () => {
    context.tasks.currentRank = 'cleaning'
    saveAt('hub')
  }
  context.startShift = () => {
    if (activeShift || night) return
    if (context.time.isLifeOver()) return saveAt('end', { reason: 'lifeOver' })
    const rank = context.tasks.currentRank
    if (rank === 'larva') return context.goTo('birth')
    if (context.tasks.isTaskComplete()) {
      if (rank === 'guard') return saveAt('end', { reason: 'completed' })
      if (context.tasks.checkPromotion()) return showPromotion({ from: rank, to: context.tasks.currentRank })
    }
    const shiftIndex = context.tasks.getCompletedShifts()
    activeShift = rank
    context.goTo(rank, { shiftIndex, difficulty: difficultyFor(rank, shiftIndex, context.tasks.getScores()) })
  }
  context.completeNight = () => {
    if (!night) return
    const { nextScene, nextData } = night
    night = null
    context.time.isNight = false
    if (nextScene === 'promotion') context.audio?.playPromotion()
    if (nextScene === 'promotion') showPromotion(nextData)
    else saveAt(nextScene, nextData)
  }
  context.finishShift = ({ score = 50, summary = '' } = {}) => {
    if (!activeShift) return
    const rank = activeShift
    activeShift = null
    score = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0
    const oldDay = context.time.currentDay
    const oldHealth = context.colony.health
    context.tasks.recordShiftScore(score)
    context.colony.applyTaskResult(rank, score)
    context.time.advanceDays(config.days.daysPerShift, () => context.colony.tickDecay(1))
    let nextScene = 'hub'
    let nextData
    if (rank === 'guard' && context.tasks.isTaskComplete()) {
      nextScene = 'end'; nextData = { reason: 'completed' }
    } else if (context.time.isLifeOver()) {
      nextScene = 'end'; nextData = { reason: 'lifeOver' }
    } else if (context.tasks.checkPromotion()) {
      nextScene = 'promotion'; nextData = { from: rank, to: context.tasks.currentRank }
    }
    night = { nextScene, nextData, oldDay, score, summary: String(summary),
      healthChange: Math.round(context.colony.health - oldHealth) }
    context.time.isNight = true
    context.audio?.playResult(score)
    saveAt('night', night)
  }
  return context
}
