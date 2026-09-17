// Harness de preview de estados — roda UM estado (ou o fluxo de UI) isolado,
// fora do main.js, com um `context` que implementa o CONTRATO DE CONTEXTO abaixo.
// Uso: /_preview/state.html?state=cleaning   (tarefas: cleaning|feedLarvae|feedQueen|guard)
//      /_preview/state.html?state=menu       (UI: intro|menu|hub|birth|promotion|end)
//      &rank=feedQueen  -> força o rank inicial (útil para abrir o hub numa etapa)
//
// CONTRATO DE CONTEXTO (a Onda 3 implementa a versão real em src/main.js):
//   context.renderer   Renderer   (.width/.height lógicos, .getContext())
//   context.input      InputManager
//   context.machine    StateMachine
//   context.width / context.height   getters = tamanho lógico atual (CSS px)
//   context.elapsed    segundos desde o início (atualizado pelo loop)
//   context.colony     ColonyState
//   context.time       TimeSystem
//   context.tasks      TaskSystem
//   context.hasSave()           -> boolean
//   context.newGame()           -> inicia vida nova (vai para 'birth')
//   context.continueGame()      -> carrega o save (vai para 'hub')
//   context.completeBirth()     -> fim da animação de nascimento (vai para 'hub', rank 'cleaning')
//   context.startShift()        -> hub inicia turno da tarefa do rank atual
//   context.finishShift({ score, summary })
//        -> tarefa encerra o turno. score 0–100 (50 = neutro), summary = frase curta em PT.
//           Registra pontuação, aplica ColonyState, avança dia/noite e decide o próximo estado:
//           'promotion' (data: { from, to }), 'end' (dominou a defesa), ou 'hub'.
//   context.goTo(name, data)    -> atalho para machine.change
//
// NOMES DE ESTADO: 'intro','menu','birth','hub','promotion','end',
//                  'cleaning','feedLarvae','feedQueen','guard' (tarefa = id do rank)
// enter(context, data) de tarefa recebe data = { shiftIndex } (0 = primeiro turno nessa tarefa),
// para escalar dificuldade entre turnos.

import Renderer from '../src/engine/Renderer.js'
import InputManager from '../src/engine/InputManager.js'
import StateMachine from '../src/engine/StateMachine.js'
import { create as createLoop } from '../src/engine/GameLoop.js'
import ColonyState from '../src/systems/ColonyState.js'
import TimeSystem from '../src/systems/TimeSystem.js'
import TaskSystem, { RANK_ORDER } from '../src/systems/TaskSystem.js'
import { config } from '../src/data/config.js'

const MODULES = {
  intro: '../src/states/IntroState.js',
  menu: '../src/states/MenuState.js',
  birth: '../src/states/BirthState.js',
  hub: '../src/states/TaskHubState.js',
  promotion: '../src/states/PromotionState.js',
  end: '../src/states/EndOfMarco1State.js',
  cleaning: '../src/states/tasks/CleaningTask.js',
  feedLarvae: '../src/states/tasks/FeedLarvaeTask.js',
  feedQueen: '../src/states/tasks/FeedQueenTask.js',
  guard: '../src/states/tasks/GuardTask.js',
}
const TASK_IDS = ['cleaning', 'feedLarvae', 'feedQueen', 'guard']

const params = new URLSearchParams(location.search)
const target = params.get('state') || 'menu'
const debugEl = document.getElementById('hud-debug')

async function loadState(name) {
  try {
    const mod = await import(MODULES[name])
    const state = mod.default ?? Object.values(mod)[0]
    // Estados devem ser objetos { enter, update, render, exit } — stubs antigos (classes) são ignorados.
    return state && typeof state === 'object' ? state : null
  } catch (err) {
    console.warn(`[harness] não carregou "${name}":`, err)
    return null
  }
}

// Estado auxiliar só do harness: mostra o resultado de um turno de tarefa isolada.
function resultState(taskId) {
  let result = null
  return {
    enter(_c, data) { result = data },
    update(c) {
      if (c.input.consumeClicks().length || c.input.isKeyDown('Enter')) {
        c.goTo(taskId, { shiftIndex: (result?.shiftIndex ?? 0) + 1 })
      }
    },
    render(c, ctx) {
      ctx.fillStyle = '#EFE8D6'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#2B2418'
      ctx.textAlign = 'center'
      ctx.font = '600 28px Georgia, serif'
      ctx.fillText(`Turno encerrado — pontuação ${Math.round(result?.score ?? 0)}`, c.width / 2, c.height / 2 - 20)
      ctx.font = '18px Georgia, serif'
      ctx.fillText(result?.summary ?? '', c.width / 2, c.height / 2 + 16)
      ctx.font = '14px Georgia, serif'
      ctx.fillText('clique ou Enter para jogar o próximo turno (dificuldade maior)', c.width / 2, c.height / 2 + 56)
    },
  }
}

async function main() {
  const renderer = new Renderer('#game-canvas')
  const input = new InputManager(renderer.canvas)
  const context = {
    renderer,
    input,
    elapsed: 0,
    colony: new ColonyState(),
    time: new TimeSystem(),
    tasks: new TaskSystem(),
    get width() { return renderer.width },
    get height() { return renderer.height },
  }
  const machine = StateMachine(target, context)
  context.machine = machine
  context.goTo = (name, data) => machine.change(name, data)

  const forcedRank = params.get('rank')
  if (forcedRank && RANK_ORDER.includes(forcedRank)) context.tasks.currentRank = forcedRank

  const shiftCounts = {}
  const registered = new Set()
  context.hasSave = () => false
  context.newGame = () => {
    context.colony = new ColonyState()
    context.time = new TimeSystem()
    context.tasks = new TaskSystem()
    context.goTo(registered.has('birth') ? 'birth' : 'hub')
  }
  context.continueGame = () => context.goTo('hub')
  context.completeBirth = () => {
    context.tasks.currentRank = 'cleaning'
    context.goTo('hub')
  }
  context.startShift = () => {
    const rank = context.tasks.currentRank
    context.goTo(rank, { shiftIndex: shiftCounts[rank] ?? 0 })
  }

  const isolatedTask = TASK_IDS.includes(target)
  context.finishShift = ({ score = 50, summary = '' } = {}) => {
    const rank = isolatedTask ? target : context.tasks.currentRank
    const shiftIndex = shiftCounts[rank] ?? 0
    shiftCounts[rank] = shiftIndex + 1
    console.log(`[harness] finishShift(${rank})`, { score, summary })

    if (isolatedTask) {
      context.goTo('result', { score, summary, shiftIndex })
      return
    }
    context.tasks.recordShiftScore(score)
    context.colony.applyTaskResult(rank, score)
    context.time.advanceDay()
    context.colony.tickDecay(1)
    context.time.advanceDay()

    if (rank === 'guard' && context.tasks.getAccumulatedScore() >= config.promotionThresholds.guard) {
      context.goTo('end')
    } else if (context.tasks.checkPromotion()) {
      context.goTo('promotion', { from: rank, to: context.tasks.currentRank })
    } else {
      context.goTo('hub')
    }
  }

  const names = isolatedTask ? [target] : Object.keys(MODULES)
  const missing = []
  for (const name of names) {
    const state = await loadState(name)
    if (state) {
      machine.register(name, state)
      registered.add(name)
    } else missing.push(name)
  }
  if (isolatedTask) machine.register('result', resultState(target))

  if (missing.includes(target)) {
    debugEl.textContent = `estado "${target}" ainda não implementado (stub)`
    return
  }

  const loop = createLoop({
    update(dt) {
      context.elapsed += dt
      machine.update(dt)
    },
    render() {
      const ctx = renderer.getContext()
      renderer.clear('#1a1410')
      machine.render(ctx)
      const c = context.colony
      debugEl.textContent =
        `estado=${machine.currentName} rank=${context.tasks.currentRank} dia=${context.time.currentDay}` +
        ` | pop ${c.population|0} néc ${c.nectar|0} pól ${c.pollen|0} cera ${c.wax|0} saúde ${c.health|0}` +
        (missing.length ? ` | stubs: ${missing.join(',')}` : '')
    },
  })
  loop.start()
}

main()
