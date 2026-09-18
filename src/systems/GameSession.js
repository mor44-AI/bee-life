import ColonyState from './ColonyState.js'
import TimeSystem from './TimeSystem.js'
import TaskSystem, { RANK_ORDER } from './TaskSystem.js'
import SaveSystem from './SaveSystem.js'
import ScoreSystem from './ScoreSystem.js'
import { config, difficultyFor } from '../data/config.js'

const SCENES = ['birth', 'hub', 'promotion', 'night', 'end']
// Fases jogáveis, na ordem fixa de desbloqueio.
export const TASK_ORDER = RANK_ORDER.filter((rank) => rank !== 'larva')
const COLONY_FIELDS = ['population', 'nectar', 'pollen', 'propolis', 'wax', 'health', '_guardShield']

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

// Fluxo da sessão (context.*). O resultado é salvo antes da noite; recarregar não
// cobra os dias novamente.
//
// Pontuação (context.score = ScoreSystem, uma instância por vida, salva no save):
//   startShift() chama score.beginShift; finishShift chama score.endShift(rank, colônia
//   já com o resultado do turno aplicado) e anexa o retorno em data.points da noite:
//   { taskId, actionPoints, phaseBonus, points, bestCombo, free }, e data.total (placar da vida).
//   Dados de 'end' (todas as rotas da sessão): { reason, finalScore, shiftsTotal, finalBonus:
//   { items: [{ key, value, points }], total }, bestCombo }. Estados que vão a 'end' por conta
//   própria (sem esses campos) podem usar context.endData(reason).
//
// Turno livre - startShift(taskId) com uma fase de unlockedTasks() ANTERIOR ao rank atual:
//   enter da tarefa recebe { shiftIndex, difficulty, free: true } (shiftIndex = último turno
//   jogado naquela fase, com a dificuldade que ela atingiu). Ao terminar: não grava score no
//   TaskSystem (não conta para promoção), não avança dias nem aplica desgaste, não soma no
//   placar da vida, e o efeito na colônia é multiplicado por config.scoring.freeColonyEffect
//   (0,5). O resultado reaproveita a cena 'night' como cartão de resultado com
//   data = { free: true, taskId, nextScene: 'hub', points, total, score, summary, healthChange,
//   oldDay } - a UI deve mostrar "Turno livre" em vez do avanço de dia (context.time.isNight
//   continua false). completeNight() volta ao hub. O save grava 'hub' (recarregar no cartão
//   volta ao hub com o efeito já aplicado). startShift() sem argumento volta à fase atual.
export function installGameSession(context, storage = SaveSystem) {
  let activeShift = null
  let night = null
  context.score ??= new ScoreSystem()
  // resumeScene: cena gravada para retomada, quando difere da exibida agora.
  const saveAt = (scene, data, resumeScene = scene) => {
    const resumeData = resumeScene === scene ? data : undefined
    context.saveFailed = !storage.save({ version: 2, scene: resumeScene, data: resumeData,
      tasks: context.tasks.serialize(), time: context.time.serialize(), colony: context.colony.serialize(),
      score: context.score.serialize() })
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
    context.score = new ScoreSystem()
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
    context.score = ScoreSystem.deserialize(save.score)
    // Regrava a versão migrada, sem perder o ponto de retomada.
    saveAt(save.scene, save.data)
  }
  context.completeBirth = () => {
    context.tasks.currentRank = 'cleaning'
    saveAt('hub')
  }
  // Fases já desbloqueadas (inclui a atual), na ordem fixa.
  context.unlockedTasks = () => {
    const idx = RANK_ORDER.indexOf(context.tasks?.currentRank)
    return TASK_ORDER.filter((id) => RANK_ORDER.indexOf(id) <= idx)
  }
  // Fase do rank atual (null na fase larval).
  context.currentTask = () => (TASK_ORDER.includes(context.tasks?.currentRank) ? context.tasks.currentRank : null)
  context.endData = (reason) => {
    const finalBonus = context.score.finalBonus(context.colony)
    return { reason, finalScore: context.score.total + finalBonus.total, shiftsTotal: context.score.total,
      finalBonus, bestCombo: context.score.lifeBestCombo }
  }
  context.startShift = (taskId) => {
    if (activeShift || night) return
    if (context.time.isLifeOver()) return saveAt('end', context.endData('lifeOver'))
    const rank = context.tasks.currentRank
    if (taskId != null && taskId !== rank) {
      // Turno livre: só fases já desbloqueadas e anteriores à atual; o resto é ignorado.
      if (!context.unlockedTasks().includes(taskId)) return
      const scores = context.tasks.getScores(taskId)
      const shiftIndex = Math.max(0, scores.length - 1)
      activeShift = { rank: taskId, free: true }
      context.score.beginShift(taskId, { free: true })
      return context.goTo(taskId, { shiftIndex, difficulty: difficultyFor(taskId, shiftIndex, scores), free: true })
    }
    if (rank === 'larva') return context.goTo('birth')
    if (context.tasks.isTaskComplete()) {
      if (rank === 'guard') return saveAt('end', context.endData('completed'))
      if (context.tasks.checkPromotion()) return showPromotion({ from: rank, to: context.tasks.currentRank })
    }
    const shiftIndex = context.tasks.getCompletedShifts()
    activeShift = { rank, free: false }
    context.score.beginShift(rank)
    context.goTo(rank, { shiftIndex, difficulty: difficultyFor(rank, shiftIndex, context.tasks.getScores()), free: false })
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
    const { rank, free } = activeShift
    activeShift = null
    score = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0
    const oldDay = context.time.currentDay
    const oldHealth = context.colony.health
    if (free) {
      const colony = context.colony
      const before = COLONY_FIELDS.map((key) => colony[key])
      colony.applyTaskResult(rank, score)
      const f = config.scoring.freeColonyEffect
      COLONY_FIELDS.forEach((key, i) => { colony[key] = before[i] + (colony[key] - before[i]) * f })
      const points = context.score.endShift(rank, colony)
      night = { nextScene: 'hub', free: true, taskId: rank, oldDay, score, summary: String(summary),
        healthChange: Math.round(colony.health - oldHealth), points, total: context.score.total }
      context.audio?.playResult(score)
      saveAt('night', night, 'hub')
      return
    }
    context.tasks.recordShiftScore(score)
    context.colony.applyTaskResult(rank, score)
    const points = context.score.endShift(rank, context.colony)
    context.time.advanceDays(config.days.daysPerShift, () => context.colony.tickDecay(1))
    let nextScene = 'hub'
    let nextData
    if (rank === 'guard' && context.tasks.isTaskComplete()) {
      nextScene = 'end'; nextData = context.endData('completed')
    } else if (context.time.isLifeOver()) {
      nextScene = 'end'; nextData = context.endData('lifeOver')
    } else if (context.tasks.checkPromotion()) {
      nextScene = 'promotion'; nextData = { from: rank, to: context.tasks.currentRank }
    }
    night = { nextScene, nextData, oldDay, score, summary: String(summary),
      healthChange: Math.round(context.colony.health - oldHealth), points, total: context.score.total }
    context.time.isNight = true
    context.audio?.playResult(score)
    saveAt('night', night)
  }
  return context
}
