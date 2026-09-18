// Harness de preview de estados - roda UM estado (ou o fluxo de UI) isolado,
// fora do main.js, com um `context` que implementa o CONTRATO DE CONTEXTO abaixo.
// Uso: /_preview/state.html?state=cleaning   (tarefas: cleaning|feedLarvae|feedQueen|guard)
//      /_preview/state.html?state=menu       (UI: intro|menu|hub|birth|promotion|end)
//      /_preview/state.html?state=controls   (demo de layout + Controls + SpecialMeter)
//      /_preview/state.html?state=scoredemo  (demo da animação de pontos/combo do ScoreSystem)
//      &free=1          -> tarefa isolada entra como turno livre (data.free = true)
//      &rank=feedQueen  -> força o rank inicial (útil para abrir o hub numa etapa)
//      &shift=2         -> shiftIndex inicial de uma tarefa isolada
//      &dirs=0          -> esconde os direcionais na demo 'controls'
//
// CONTRATO DE CONTEXTO (a Onda 3 implementa a versão real em src/main.js):
//   context.renderer   Renderer   (.width/.height lógicos, .getContext())
//   context.input      InputManager  (entrada crua; tarefas devem preferir context.controls)
//   context.controls   Controls (src/ui/Controls.js) - atualizado pelo loop ANTES de
//                      machine.update (controls.update(dt, context.layout)). A tarefa lê
//                      move / actionPressed / actionDown / specialPressed / directionPressed /
//                      pointerTap / isTouch; configura no enter
//                      (context.controls.configure({ showDirections, meter, ... })) e desenha
//                      no fim do render (context.controls.render(ctx, context.layout)).
//                      goTo() chama controls.reset() antes de trocar de estado.
//   context.layout     getLayout(width, height) de src/ui/layout.js - recalculado quando o
//                      tamanho muda (resize/rotação). Use layout.playfield para o mundo,
//                      layout.hudBar para o HUD, e não ponha nada importante sob os botões
//                      (controls.getButtons()).
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
//   context.startShift(taskId?) -> sem argumento: turno da tarefa do rank atual. Com o id de
//                                  uma fase de unlockedTasks() anterior ao rank atual: TURNO
//                                  LIVRE (rejogar fase passada; data.free = true).
//   context.unlockedTasks()     -> ids das fases já desbloqueadas, ordem fixa
//                                  ['cleaning','feedLarvae','feedQueen','guard'] até o rank atual.
//   context.currentTask()       -> fase do rank atual (null na larva).
//   context.score      ScoreSystem (src/systems/ScoreSystem.js) - pontuação arcade da vida.
//                      O loop chama score.update(dt) depois de machine.update e
//                      score.render(ctx, layout) DEPOIS de machine.render (popups por cima da
//                      tarefa). beginShift/endShift são chamados pela sessão, não pela tarefa.
//                      A TAREFA chama:
//                        context.score?.award(base, { x, y, reason })  a cada acerto
//                          -> pontos = round(base × multiplicador do combo); popup "+N" em (x, y)
//                             (coordenadas lógicas do canvas); reason = chave i18n opcional
//                             ('score.reason.perfect' | great | good | fast | chain | special | bonus).
//                          base sugerido: config.scoring.base { small 10, normal 25, great 50,
//                          perfect 80 }; alvo ~config.scoring.targetShiftActionPoints (1.500)
//                          de pontos de ação num turno médio.
//                        context.score?.miss()  em erro/dano -> zera o combo.
//                      Leitura: score.combo, score.multiplier (1 | 1,5 | 2 | 3), score.shiftPoints.
//                      Combo expira após config.scoring.comboTimeout (2,5 s) sem award.
//   context.finishShift({ score, summary })
//        -> tarefa encerra o turno. score 0-100 (50 = neutro), summary = frase curta em PT.
//           Registra pontuação, aplica ColonyState, avança config.days.daysPerShift dias
//           (time.advanceDays, com colony.tickDecay(1) a cada noite) e decide o próximo
//           estado: 'promotion' (data: { from, to }), 'end' (dominou a defesa), ou 'hub'.
//           Também encerra a pontuação (score.endShift) e anexa data.points
//           { actionPoints, phaseBonus, points, bestCombo, free } ao resultado.
//           Turno livre: não gasta dias, não conta para promoção nem placar, efeito na
//           colônia pela metade (ver cabeçalho de src/systems/GameSession.js).
//   context.goTo(name, data)    -> atalho para machine.change (com controls.reset()).
//
// ORDEM DO LOOP (por frame):
//   context.elapsed += dt -> layout (se mudou) -> controls.update(dt, layout)
//   -> machine.update(dt) -> input.endFrame() ; depois render.
//
// NOMES DE ESTADO: 'intro','menu','birth','hub','promotion','end',
//                  'cleaning','feedLarvae','feedQueen','guard' (tarefa = id do rank)
//                  + 'controls', 'scoredemo' (só harness: demonstração)
// enter(context, data) de tarefa recebe data = { shiftIndex, difficulty, free }
//   shiftIndex: 0 = primeiro turno nessa tarefa.
//   free: true em turno livre (a tarefa pode mostrar um selo "Turno livre"; jogabilidade igual).
//   difficulty: 0-1 = difficultyFor(taskId, shiftIndex, pontuaçõesDessaTarefa) de
//               src/data/config.js (0.57 no primeiro turno; ajuda invisível se
//               os 2 últimos turnos foram < 40). É a FONTE DA VERDADE da escalada entre
//               turnos; dentro do turno use inShiftRamp(t, duração).

import Renderer from '../src/engine/Renderer.js'
import InputManager from '../src/engine/InputManager.js'
import StateMachine from '../src/engine/StateMachine.js'
import { create as createLoop } from '../src/engine/GameLoop.js'
import { create as createMeter } from '../src/engine/SpecialMeter.js'
import ColonyState from '../src/systems/ColonyState.js'
import TimeSystem from '../src/systems/TimeSystem.js'
import TaskSystem, { RANK_ORDER } from '../src/systems/TaskSystem.js'
import { config, difficultyFor } from '../src/data/config.js'
import { createControls } from '../src/ui/Controls.js'
import { getLayout, installViewportGuards } from '../src/ui/layout.js'
import { drawBeeBody, createFlightPose, createIdlePose } from '../src/art/bee.js'
import ScoreSystem from '../src/systems/ScoreSystem.js'
import { TASK_ORDER } from '../src/systems/GameSession.js'

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
// A linha de debug fica no topo (na base ela cobria os botões virtuais no celular).
if (debugEl) {
  Object.assign(debugEl.style, {
    top: 'calc(env(safe-area-inset-top, 0px) + 2px)', bottom: 'auto', left: 'auto', right: '4px',
    fontSize: '10px', opacity: '0.75', maxWidth: '70vw',
  })
  if (target === 'controls' || target === 'scoredemo') debugEl.style.display = 'none' // a demo tem HUD próprio
}

async function loadState(name) {
  try {
    const mod = await import(MODULES[name])
    const state = mod.default ?? Object.values(mod)[0]
    // Estados devem ser objetos { enter, update, render, exit } - stubs antigos (classes) são ignorados.
    return state && typeof state === 'object' ? state : null
  } catch (err) {
    console.warn(`[harness] não carregou "${name}":`, err)
    return null
  }
}

// Estado auxiliar só do harness: mostra o resultado de um turno de tarefa isolada.
function resultState(taskId, nextData) {
  let result = null
  let t = 0
  return {
    enter(c, data) {
      result = data
      t = 0
      c.input.consumeClicks()
    },
    update(c, dt) {
      t += dt
      const clicked = c.input.consumeClicks().length > 0
      if (t < 0.4) return
      if (clicked || c.controls.actionPressed || c.input.wasKeyPressed('Enter')) {
        c.goTo(taskId, nextData(taskId))
      }
    },
    render(c, ctx) {
      const next = nextData(taskId)
      ctx.fillStyle = '#EFE8D6'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#2B2418'
      ctx.textAlign = 'center'
      ctx.font = '600 24px Georgia, serif'
      ctx.fillText(`Turno encerrado - pontuação ${Math.round(result?.score ?? 0)}`, c.width / 2, c.height / 2 - 20)
      ctx.font = '16px Georgia, serif'
      ctx.fillText(result?.summary ?? '', c.width / 2, c.height / 2 + 16)
      const pts = result?.points
      if (pts) {
        ctx.fillText(`pontos ${pts.actionPoints} + bônus da fase ${pts.phaseBonus} = ${pts.points} · melhor combo ${pts.bestCombo}${pts.free ? ' · livre' : ''}`, c.width / 2, c.height / 2 + 36)
      }
      ctx.font = '14px Georgia, serif'
      ctx.fillText('toque, clique ou Enter: próximo turno', c.width / 2, c.height / 2 + 64)
      ctx.fillText(`turno ${next.shiftIndex + 1} · dificuldade ${next.difficulty.toFixed(2)}`, c.width / 2, c.height / 2 + 88)
    },
  }
}

// Estado de demonstração só do harness: layout responsivo + Controls + SpecialMeter.
function controlsDemoState() {
  let meter = null
  let bee = null
  let taps = []
  let pulses = []
  const log = { actions: 0, specials: 0, dir: '-', taps: 0 }
  return {
    enter(c) {
      meter = createMeter({ chargeTime: 22, duration: 6 })
      const pf = c.layout.playfield
      bee = { x: pf.x + pf.w / 2, y: pf.y + pf.h / 2, heading: -Math.PI / 2, moving: false, t: 0 }
      c.controls.configure({ showDirections: params.get('dirs') !== '0', meter })
      c.__demo = { log, bee, meter } // inspeção via window.__harness.__demo
    },
    update(c, dt) {
      const ctl = c.controls
      const pf = c.layout.playfield
      meter.update(dt)
      bee.t += dt
      if (ctl.actionPressed) {
        log.actions++
        meter.add(0.1)
        pulses.push({ x: bee.x, y: bee.y, t: 0 })
      }
      if (ctl.specialPressed && meter.activate()) log.specials++
      if (ctl.directionPressed) log.dir = ctl.directionPressed
      if (ctl.pointerTap) {
        log.taps++
        taps.push({ ...ctl.pointerTap, t: 0 })
      }
      const speed = 240 * (meter.isActive ? 1.7 : 1)
      let dx = 0
      let dy = 0
      const m = ctl.move
      if (m && m.vx != null) {
        dx = m.vx * speed * dt
        dy = m.vy * speed * dt
      } else if (m) {
        const ex = m.targetX - bee.x
        const ey = m.targetY - bee.y
        const d = Math.hypot(ex, ey)
        const step = Math.min(d, speed * dt)
        if (d > 0.5) {
          dx = (ex / d) * step
          dy = (ey / d) * step
        }
      }
      bee.moving = Math.hypot(dx, dy) > 0.2
      if (bee.moving) bee.heading = Math.atan2(dy, dx)
      bee.x = Math.min(Math.max(bee.x + dx, pf.x + 12), pf.x + pf.w - 12)
      bee.y = Math.min(Math.max(bee.y + dy, pf.y + 12), pf.y + pf.h - 12)
      for (const p of taps) p.t += dt
      for (const p of pulses) p.t += dt
      taps = taps.filter((p) => p.t < 0.9)
      pulses = pulses.filter((p) => p.t < 0.6)
    },
    render(c, ctx) {
      const L = c.layout
      ctx.fillStyle = '#E3DAC0'
      ctx.fillRect(0, 0, c.width, c.height)
      const box = (r, fill, label) => {
        if (!r) return
        ctx.fillStyle = fill
        ctx.fillRect(r.x, r.y, r.w, r.h)
        ctx.strokeStyle = 'rgba(43,36,24,0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(43,36,24,0.5)'
        ctx.font = '11px Georgia, serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(label, r.x + 6, r.y + 5)
      }
      box(L.playfield, '#EFE8D6', 'playfield')
      box(L.controlBar, 'rgba(201,162,39,0.10)', 'controlBar')
      if (L.sideLeft) box(L.sideLeft, 'rgba(201,162,39,0.06)', 'sideLeft')
      box(L.hudBar, 'rgba(43,36,24,0.06)', '')

      for (const p of pulses) {
        ctx.strokeStyle = `rgba(201,162,39,${1 - p.t / 0.6})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, 20 + p.t * 60, 0, Math.PI * 2)
        ctx.stroke()
      }
      for (const p of taps) {
        ctx.strokeStyle = `rgba(43,36,24,${0.8 * (1 - p.t / 0.9)})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(p.x - 10, p.y)
        ctx.lineTo(p.x + 10, p.y)
        ctx.moveTo(p.x, p.y - 10)
        ctx.lineTo(p.x, p.y + 10)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(p.x, p.y, 8 + p.t * 20, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (meter.isActive) {
        const g = ctx.createRadialGradient(bee.x, bee.y, 4, bee.x, bee.y, 60)
        g.addColorStop(0, 'rgba(247,223,160,0.8)')
        g.addColorStop(1, 'rgba(247,223,160,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(bee.x, bee.y, 60, 0, Math.PI * 2)
        ctx.fill()
      }
      const scale = 1.6 * L.uiScale
      const pose = bee.moving
        ? createFlightPose(bee.x, bee.y, bee.t, { scale, rotation: bee.heading })
        : createIdlePose(bee.x, bee.y, { t: bee.t, scale, rotation: bee.heading })
      drawBeeBody(ctx, pose)

      const ptrs = c.input.getPointers().length
      ctx.fillStyle = '#2B2418'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const hy = L.hudBar.y + L.hudBar.h / 2
      ctx.font = `600 ${Math.round(12 * L.uiScale)}px Georgia, serif`
      ctx.fillText(
        `${L.orientation} ${L.width}×${L.height} · ${c.controls.isTouch ? 'toque' : 'teclado/mouse'} · dedos ${ptrs}`,
        L.hudBar.x + 10,
        hy - 9
      )
      ctx.font = `${Math.round(11 * L.uiScale)}px Georgia, serif`
      ctx.fillText(
        `ação ${log.actions} · especial ${log.specials} · dir ${log.dir} · taps ${log.taps} · carga ${Math.round(meter.charge * 100)}%${meter.isActive ? ' ATIVO' : ''}`,
        L.hudBar.x + 10,
        hy + 9
      )

      c.controls.render(ctx, L)
    },
  }
}

// Demo só do harness: chama award/miss periodicamente para visualizar popups e combo.
function scoreDemoState() {
  let t = 0
  let next = 0.4
  let n = 0
  const reasons = [null, null, 'score.reason.good', null, 'score.reason.perfect', 'score.reason.fast']
  return {
    enter(c) {
      t = 0; next = 0.4; n = 0
      c.score.beginShift('cleaning')
      c.controls.configure({ showDirections: false })
    },
    update(c, dt) {
      t += dt
      const pf = c.layout.playfield
      // Toque/clique também pontua ali (para testar coordenadas).
      if (c.controls.pointerTap) c.score.award(25, { x: c.controls.pointerTap.x, y: c.controls.pointerTap.y })
      if (c.controls.actionPressed) c.score.award(50, { reason: 'score.reason.great' })
      if (t < next) return
      n++
      // Ciclo: 13 acertos (sobe até ×3), um erro, 4 acertos, pausa longa (expira).
      const phase = n % 20
      if (phase === 14) { c.score.miss(); next = t + 1.1; return }
      if (phase === 19) { next = t + 3.2; return }
      const x = pf.x + pf.w * (0.2 + 0.6 * ((n * 0.37) % 1))
      const y = pf.y + pf.h * (0.35 + 0.35 * ((n * 0.61) % 1))
      c.score.award(n % 7 === 0 ? 80 : 25, { x, y, reason: reasons[n % reasons.length] ?? undefined })
      next = t + 0.35 + (n % 3) * 0.15
    },
    render(c, ctx) {
      const L = c.layout
      ctx.fillStyle = '#E3DAC0'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#EFE8D6'
      ctx.fillRect(L.playfield.x, L.playfield.y, L.playfield.w, L.playfield.h)
      ctx.fillStyle = '#2B2418'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${Math.round(12 * L.uiScale)}px Georgia, serif`
      const s = c.score
      ctx.fillText(`pontos ${s.shiftPoints} · combo ${s.combo} · ×${s.multiplier} · melhor ${s.bestCombo}`, L.hudBar.x + 10, L.hudBar.y + L.hudBar.h / 2)
      c.controls.render(ctx, L)
    },
  }
}

async function main() {
  const renderer = new Renderer('#game-canvas')
  installViewportGuards(renderer.canvas)
  const input = new InputManager(renderer.canvas)
  const controls = createControls(input)
  const context = {
    renderer,
    input,
    controls,
    layout: getLayout(renderer.width, renderer.height),
    elapsed: 0,
    colony: new ColonyState(),
    time: new TimeSystem(),
    tasks: new TaskSystem(),
    score: new ScoreSystem(),
    get width() { return renderer.width },
    get height() { return renderer.height },
  }
  const machine = StateMachine(target, context)
  context.machine = machine
  window.__harness = context // só para inspeção/depuração no console
  context.goTo = (name, data) => {
    controls.reset()
    machine.change(name, data)
  }
  const refreshLayout = () => {
    const L = context.layout
    if (!L || L.width !== renderer.width || L.height !== renderer.height) {
      context.layout = getLayout(renderer.width, renderer.height)
    }
  }
  window.addEventListener('resize', () => {
    context.layout = getLayout(renderer.width, renderer.height)
  })

  const forcedRank = params.get('rank')
  if (forcedRank && RANK_ORDER.includes(forcedRank)) context.tasks.currentRank = forcedRank

  const shiftCounts = {}
  const scoresByTask = {}
  const taskData = (rank) => {
    const shiftIndex = shiftCounts[rank] ?? 0
    return { shiftIndex, difficulty: difficultyFor(rank, shiftIndex, scoresByTask[rank] ?? []) }
  }

  const registered = new Set()
  context.hasSave = () => false
  context.newGame = () => {
    for (const key of Object.keys(shiftCounts)) delete shiftCounts[key]
    for (const key of Object.keys(scoresByTask)) delete scoresByTask[key]
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
  context.unlockedTasks = () => {
    const idx = RANK_ORDER.indexOf(context.tasks.currentRank)
    return TASK_ORDER.filter((id) => RANK_ORDER.indexOf(id) <= idx)
  }
  context.currentTask = () => (TASK_ORDER.includes(context.tasks.currentRank) ? context.tasks.currentRank : null)
  let freeShift = false
  context.startShift = (taskId) => {
    const rank = context.tasks.currentRank
    freeShift = taskId != null && taskId !== rank && context.unlockedTasks().includes(taskId)
    const id = freeShift ? taskId : rank
    context.score.beginShift(id, { free: freeShift })
    context.goTo(id, { ...taskData(id), free: freeShift })
  }

  const isolatedTask = TASK_IDS.includes(target)
  const isDemo = target === 'controls' || target === 'scoredemo'
  const freeParam = params.get('free') === '1'
  const startShiftParam = parseInt(params.get('shift'), 10)
  if (isolatedTask && Number.isFinite(startShiftParam) && startShiftParam > 0) {
    shiftCounts[target] = startShiftParam
  }

  context.finishShift = ({ score = 50, summary = '' } = {}) => {
    const rank = isolatedTask ? target : context.score.taskId ?? context.tasks.currentRank
    const shiftIndex = shiftCounts[rank] ?? 0
    shiftCounts[rank] = shiftIndex + 1
    ;(scoresByTask[rank] ??= []).push(score)
    const points = context.score.endShift(rank, context.colony)
    console.log(`[harness] finishShift(${rank})`, { score, summary, points })

    if (isolatedTask) {
      context.goTo('result', { score, summary, shiftIndex, points })
      return
    }
    if (freeShift) {
      freeShift = false
      context.goTo('hub')
      return
    }
    context.tasks.recordShiftScore(score)
    context.colony.applyTaskResult(rank, score)
    context.time.advanceDays(config.days.daysPerShift, () => context.colony.tickDecay(1))

    if (rank === 'guard' && context.tasks.isTaskComplete()) {
      context.goTo('end')
    } else if (context.tasks.checkPromotion()) {
      context.goTo('promotion', { from: rank, to: context.tasks.currentRank })
    } else {
      context.goTo('hub')
    }
  }

  const names = isDemo ? [] : isolatedTask ? [target] : Object.keys(MODULES)
  const missing = []
  for (const name of names) {
    const state = await loadState(name)
    if (state) {
      machine.register(name, state)
      registered.add(name)
    } else missing.push(name)
  }
  if (isolatedTask) machine.register('result', resultState(target, taskData))
  if (target === 'controls') machine.register('controls', controlsDemoState())
  if (target === 'scoredemo') machine.register('scoredemo', scoreDemoState())

  if (missing.includes(target)) {
    debugEl.textContent = `estado "${target}" ainda não implementado (stub)`
    return
  }
  // A primeira entrada numa tarefa isolada também recebe { shiftIndex, difficulty }.
  if (isolatedTask) {
    // Cada entrada na tarefa isolada (primeira e "próximo turno") começa um turno de pontuação.
    const baseGoTo = context.goTo
    context.goTo = (name, data) => {
      if (name === target) context.score.beginShift(target, { free: freeParam })
      baseGoTo(name, data)
    }
    context.score.beginShift(target, { free: freeParam })
    machine.change(target, { ...taskData(target), free: freeParam })
  }

  const loop = createLoop({
    update(dt) {
      context.elapsed += dt
      refreshLayout()
      controls.update(dt, context.layout)
      machine.update(dt)
      context.score.update(dt)
      input.endFrame()
    },
    render() {
      const ctx = renderer.getContext()
      renderer.clear('#1a1410')
      machine.render(ctx)
      // Popups/combo por cima da tarefa (as tarefas isoladas já mostram quando chamarem award).
      if (TASK_ORDER.includes(machine.currentName) || machine.currentName === 'scoredemo') {
        context.score.render(ctx, context.layout)
      }
      const c = context.colony
      debugEl.textContent =
        `estado=${machine.currentName} rank=${context.tasks.currentRank} dia=${context.time.currentDay}` +
        ` | pts ${context.score.shiftPoints} combo ${context.score.combo} total ${context.score.total}` +
        ` | pop ${c.population|0} néc ${c.nectar|0} pól ${c.pollen|0} cera ${c.wax|0} saúde ${c.health|0}` +
        (missing.length ? ` | stubs: ${missing.join(',')}` : '')
    },
  })
  loop.start()
}

main()
