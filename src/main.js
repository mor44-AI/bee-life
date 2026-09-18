import Renderer from './engine/Renderer.js'
import { inject } from '@vercel/analytics'
import InputManager from './engine/InputManager.js'
import StateMachine from './engine/StateMachine.js'
import { create as createLoop } from './engine/GameLoop.js'
import { createControls } from './ui/Controls.js'
import { getLayout, installViewportGuards } from './ui/layout.js'
import { installGameSession, TASK_ORDER } from './systems/GameSession.js'
import AudioSystem from './systems/AudioSystem.js'
import IntroState from './states/IntroState.js'
import MenuState from './states/MenuState.js'
import BirthState from './states/BirthState.js'
import TaskHubState from './states/TaskHubState.js'
import PromotionState from './states/PromotionState.js'
import EndOfMarco1State from './states/EndOfMarco1State.js'
import CleaningTask from './states/tasks/CleaningTask.js'
import FeedLarvaeTask from './states/tasks/FeedLarvaeTask.js'
import FeedQueenTask from './states/tasks/FeedQueenTask.js'
import GuardTask from './states/tasks/GuardTask.js'
import NightState from './states/NightState.js'
import { t as tr } from './i18n/index.js'

inject()

const renderer = new Renderer('#game-canvas')
installViewportGuards(renderer.canvas)
const input = new InputManager(renderer.canvas)
const controls = createControls(input)
const audio = new AudioSystem()
const context = {
  renderer, input, controls, audio,
  layout: getLayout(renderer.width, renderer.height), elapsed: 0,
  get width() { return renderer.width },
  get height() { return renderer.height },
}
const machine = StateMachine('intro', context)
context.machine = machine
context.goTo = (name, data) => {
  controls.reset()
  input.consumeClicks()
  machine.change(name, data)
}
installGameSession(context)
for (const [name, state] of Object.entries({
  intro: IntroState, menu: MenuState, birth: BirthState, hub: TaskHubState,
  promotion: PromotionState, night: NightState, end: EndOfMarco1State, cleaning: CleaningTask,
  feedLarvae: FeedLarvaeTask, feedQueen: FeedQueenTask, guard: GuardTask,
})) machine.register(name, state)

const loop = createLoop({
  update(dt) {
    context.elapsed += dt
    if (context.layout.width !== renderer.width || context.layout.height !== renderer.height)
      context.layout = getLayout(renderer.width, renderer.height)
    controls.update(dt, context.layout)
    machine.update(dt)
    context.score?.update(dt)
    input.endFrame()
  },
  render() {
    renderer.clear('#1a1410')
    machine.render(renderer.getContext())
    // Popups de pontos e selo de combo por cima da tarefa (só durante um turno).
    if (TASK_ORDER.includes(machine.currentName)) context.score?.render(renderer.getContext(), context.layout)
    if (context.saveFailed) {
      const ctx = renderer.getContext()
      ctx.save()
      // Fundo cobre a área do notch; o texto fica abaixo da safe area de topo.
      const top = Math.max(0, context.layout.safe?.top ?? 0)
      ctx.fillStyle = '#EFE8D6'
      ctx.fillRect(0, 0, renderer.width, top + 30)
      ctx.fillStyle = '#2B2418'
      ctx.textAlign = 'center'
      ctx.font = '12px Georgia, serif'
      ctx.fillText(tr('app.saveFailed'), renderer.width / 2, top + 20)
      ctx.restore()
    }
  },
})
const onVisibilityChange = () => {
  if (document.hidden) {
    loop.stop()
    input.endFrame()
    input.consumeClicks()
    controls.reset()
    audio.suspend()
  } else {
    // Se o navegador exigir novo gesto para retomar, volta a escutar os gestos.
    void audio.resume().then((running) => { if (!running) addUnlockListeners() })
    loop.start()
  }
}
// iOS Safari só libera AudioContext.resume() em touchend/click; os demais cobrem desktop/Android.
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown']
const unlockAudio = () => {
  void audio.unlock().then((running) => { if (running) removeUnlockListeners() })
}
function addUnlockListeners() {
  for (const name of UNLOCK_EVENTS) window.addEventListener(name, unlockAudio, { passive: true })
}
function removeUnlockListeners() {
  for (const name of UNLOCK_EVENTS) window.removeEventListener(name, unlockAudio, { passive: true })
}
addUnlockListeners()
document.addEventListener('visibilitychange', onVisibilityChange)
loop.start()
if (import.meta.hot) import.meta.hot.dispose(() => {
  loop.stop()
  input.destroy()
  renderer.destroy()
  audio.dispose()
  removeUnlockListeners()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
