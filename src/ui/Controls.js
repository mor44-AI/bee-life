// Controls - camada de controles unificada (celular E PC). As tarefas devem ler
// ESTE objeto em vez de ler InputManager direto: o mesmo código de tarefa funciona
// com dedo (seguir o dedo + botões virtuais na zona do polegar) e com teclado/mouse.
//
// API pública:
//   createControls(input, opts = {}) -> controls   (também default export)
//     input: InputManager (precisa de getPointers/getFrameEvents/wasKeyPressed e de
//            input.endFrame() chamado pelo loop DEPOIS de controls.update + estados).
//     opts (todos opcionais; também aceitos em controls.configure(opts)):
//       showAction = true        botão Ação (tecla: Espaço ou Enter)
//       showSpecial = true       botão Especial (teclas: E ou Shift)
//       showDirections = false   4 botões direcionais em arco/cruz (teclas: setas).
//                                Quando true, as SETAS viram direções e só WASD move.
//       meter = null             SpecialMeter (engine/SpecialMeter.js): o botão mostra a
//                                carga em arco e pulsa em accentPink quando pronto.
//                                Controls NÃO chama meter.update/activate - a tarefa faz.
//       actionLabel = 'AÇÃO', specialLabel = 'ESPECIAL'
//       touchOffsetY = 64        no toque, o alvo de movimento fica N px (× uiScale
//                                limitado) ACIMA do dedo, para o dedo não cobrir a abelha.
//       mouseOffsetY = 0
//       tapMaxTime = 0.28, tapMaxDist = 16   limites de um "toque curto" (pointerTap).
//       showTouchGuide = true    render desenha um anel no alvo do dedo.
//
//   controls.update(dt, layout) -> void
//     Chamado pelo loop (harness/main) UMA vez por frame ANTES de machine.update.
//     layout = getLayout(...) de src/ui/layout.js (context.layout).
//
//   ESTADO DO FRAME (leia depois de update):
//     controls.move -> null | { targetX, targetY, pointerX, pointerY, source: 'touch'|'mouse'|'pen' }
//                        | { vx, vy, source: 'keyboard' }
//       - ponteiro (dedo/mouse pressionado no campo, fora dos botões): alvo absoluto
//         para a abelha SEGUIR (com offset para cima no toque), já limitado ao
//         layout.playfield. A tarefa decide a velocidade de perseguição.
//       - teclado (WASD; + setas se showDirections=false): vetor -1..1 (magnitude <= 1).
//       - teclado tem prioridade sobre ponteiro. null = sem comando de movimento.
//     controls.actionPressed   -> boolean (borda: só no frame em que apertou)
//     controls.actionDown      -> boolean (segurando)
//     controls.specialPressed  -> boolean (borda)
//     controls.directionPressed -> 'up'|'down'|'left'|'right'|null (borda; setas ou botões)
//     controls.pointerTap -> null | { x, y, pointerType }
//       toque/clique CURTO (<= tapMaxTime, <= tapMaxDist) iniciado dentro do playfield
//       e fora dos botões - coordenadas do dedo (SEM offset). Ex.: "tocar no inimigo".
//       Obs.: durante o toque a abelha também recebe `move` (seguir); a tarefa pode
//       ignorar isso se o tap for o gesto principal.
//     controls.fieldPointer -> null | { x, y } posição crua do ponteiro que move.
//     controls.isTouch -> boolean (último input foi toque/caneta)
//
//   controls.render(ctx, layout) -> void
//     Desenha os botões (e o guia do dedo). A TAREFA chama no fim do seu render()
//     (telas que não usam controles simplesmente não chamam). Estilo: instrumento
//     técnico do styleGuide (arcos finos, marcas de escala, contorno marrom quente;
//     accentPink só no especial pronto). No PC (isTouch=false) os botões ficam menores
//     e mostram a tecla, mas continuam clicáveis.
//   controls.configure(opts) -> controls   mescla opções (use no enter da tarefa).
//   controls.setMeter(meter) -> controls
//   controls.reset() -> void
//     Volta às opções padrão, solta o meter e esquece ponteiros em andamento (um dedo
//     que já estava na tela não vira movimento fantasma). O harness chama em goTo().
//   controls.getButtons(layout?) -> Array<{ name: 'action'|'special'|'up'|'down'|'left'|'right', x, y, r }>
//     Geometria atual dos botões visíveis (para a tarefa não pôr nada importante embaixo).

import { styleGuide } from '../data/styleGuide.js'
import { MIN_TOUCH, pointInRect } from './layout.js'

const P = styleGuide.palettes.naturalist
const INK = P.inkLine
const PINK = P.accentPink
const GOLD = P.caterpillarGold

const DIRS = ['up', 'down', 'left', 'right']
const KEYS = {
  action: ['Space', 'Enter', 'NumpadEnter'],
  special: ['KeyE', 'ShiftLeft', 'ShiftRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
}

const DEFAULTS = {
  showAction: true,
  showSpecial: true,
  showDirections: false,
  meter: null,
  actionLabel: 'AÇÃO',
  specialLabel: 'ESPECIAL',
  touchOffsetY: 64,
  mouseOffsetY: 0,
  tapMaxTime: 0.28,
  tapMaxDist: 16,
  showTouchGuide: true,
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function createControls(input, opts = {}) {
  const controls = {
    input,
    options: { ...DEFAULTS, ...opts },
    layout: null,

    move: null,
    actionPressed: false,
    actionDown: false,
    specialPressed: false,
    directionPressed: null,
    pointerTap: null,
    fieldPointer: null,
    isTouch: input && input.lastInputType ? input.lastInputType === 'touch' || input.lastInputType === 'pen' : false,

    _owners: new Map(), // pointerId -> { kind: 'button'|'field'|'dead', name }
    _movePointerId: null,
    _held: new Set(), // nomes de botões pressionados por ponteiro
    _time: 0,

    configure(o = {}) {
      Object.assign(this.options, o)
      return this
    },

    setMeter(meter) {
      this.options.meter = meter || null
      return this
    },

    reset() {
      this.options = { ...DEFAULTS }
      this._owners.clear()
      this._held.clear()
      this._movePointerId = null
      this.move = null
      this.actionPressed = false
      this.actionDown = false
      this.specialPressed = false
      this.directionPressed = null
      this.pointerTap = null
      this.fieldPointer = null
    },

    getButtons(layout = this.layout) {
      if (!layout) return []
      const o = this.options
      const u = clamp(layout.uiScale || 1, 0.9, 1.25)
      const k = this.isTouch ? 1 : 0.72
      const minR = this.isTouch ? MIN_TOUCH / 2 : 0
      const rA = Math.max(minR, 40 * u * k)
      const rS = Math.max(minR, 33 * u * k)
      const rD = Math.max(minR, 29 * u * k)
      const pad = 16 * u
      const hint = this.isTouch ? 0 : 14 // espaço para o texto da tecla embaixo
      const buttons = []

      const TR = layout.thumbRight
      const ax = TR.x + TR.w - pad - rA
      const ay = TR.y + TR.h - pad - rA - hint
      if (o.showAction) buttons.push({ name: 'action', x: ax, y: ay, r: rA })
      if (o.showSpecial) {
        const roomy = TR.w >= rA * 2 + rS * 2 + pad * 2 + 14
        const ang = ((roomy ? 215 : 262) * Math.PI) / 180
        const dist = rA + rS + 12 + (roomy ? 0 : hint)
        let sx = (o.showAction ? ax : TR.x + TR.w - pad - rS) + Math.cos(ang) * (o.showAction ? dist : 0)
        let sy = (o.showAction ? ay : TR.y + TR.h - pad - rS - hint) + Math.sin(ang) * (o.showAction ? dist : 0)
        sx = Math.max(sx, TR.x + rS + 4)
        buttons.push({ name: 'special', x: sx, y: sy, r: rS })
      }
      if (o.showDirections) {
        const TL = layout.thumbLeft
        const d = rD * 1.48
        const span = d + rD
        const cx = layout.orientation === 'portrait' ? TL.x + pad + span : TL.x + TL.w / 2
        const cy = TL.y + TL.h - pad - span - hint
        buttons.push({ name: 'up', x: cx, y: cy - d, r: rD, cx, cy, d })
        buttons.push({ name: 'down', x: cx, y: cy + d, r: rD, cx, cy, d })
        buttons.push({ name: 'left', x: cx - d, y: cy, r: rD, cx, cy, d })
        buttons.push({ name: 'right', x: cx + d, y: cy, r: rD, cx, cy, d })
      }
      return buttons
    },

    _hit(x, y, buttons, extra = 1) {
      let best = null
      let bestD = Infinity
      for (const b of buttons) {
        const slop = Math.max(0, MIN_TOUCH / 2 - b.r) + 6
        const d = Math.hypot(x - b.x, y - b.y)
        if (d <= (b.r + slop) * extra && d < bestD) {
          best = b
          bestD = d
        }
      }
      return best
    },

    _press(name) {
      if (name === 'action') this.actionPressed = true
      else if (name === 'special') this.specialPressed = true
      else if (DIRS.includes(name)) this.directionPressed = name
    },

    update(dt, layout) {
      if (layout) this.layout = layout
      layout = this.layout
      this._time += dt || 0

      this.actionPressed = false
      this.specialPressed = false
      this.directionPressed = null
      this.pointerTap = null
      this.move = null
      this.fieldPointer = null

      const inp = this.input
      if (!inp || !layout) return
      const o = this.options

      const lt = inp.lastInputType
      if (lt === 'touch' || lt === 'pen') this.isTouch = true
      else if (lt === 'mouse' || lt === 'keyboard') this.isTouch = false

      const buttons = this.getButtons(layout)
      const events = typeof inp.getFrameEvents === 'function' ? inp.getFrameEvents() : []

      for (const ev of events) {
        if (ev.type === 'down') {
          const b = this._hit(ev.x, ev.y, buttons)
          if (b) {
            this._owners.set(ev.id, { kind: 'button', name: b.name })
            this._held.add(b.name)
            this._press(b.name)
          } else if (this._hit(ev.x, ev.y, buttons, 1.6) && !pointInRect(ev.x, ev.y, layout.playfield)) {
            // quase-acerto de botão fora do campo: não move a abelha
            this._owners.set(ev.id, { kind: 'dead' })
          } else {
            this._owners.set(ev.id, { kind: 'field' })
            if (this._movePointerId == null) this._movePointerId = ev.id
          }
        } else {
          const owner = this._owners.get(ev.id)
          if (!owner) continue
          this._owners.delete(ev.id)
          if (owner.kind === 'button') {
            const still = [...this._owners.values()].some((w) => w.kind === 'button' && w.name === owner.name)
            if (!still) this._held.delete(owner.name)
          } else if (owner.kind === 'field') {
            if (ev.type === 'up') {
              const dur = ev.time - ev.startTime
              const dist = Math.hypot(ev.x - ev.startX, ev.y - ev.startY)
              if (dur <= o.tapMaxTime && dist <= o.tapMaxDist && pointInRect(ev.startX, ev.startY, layout.playfield)) {
                this.pointerTap = { x: ev.startX, y: ev.startY, pointerType: ev.pointerType }
              }
            }
            if (this._movePointerId === ev.id) this._movePointerId = null
          }
        }
      }

      // teclado: bordas
      const pressed = (list) => typeof inp.wasKeyPressed === 'function' && list.some((c) => inp.wasKeyPressed(c))
      const down = (list) => list.some((c) => inp.isKeyDown(c))
      if (o.showAction !== false && pressed(KEYS.action)) this.actionPressed = true
      if (pressed(KEYS.special)) this.specialPressed = true
      for (const dir of DIRS) if (pressed(KEYS[dir])) this.directionPressed = dir
      this.actionDown = this._held.has('action') || down(KEYS.action)

      // movimento: teclado tem prioridade
      let vx = 0
      let vy = 0
      if (inp.isKeyDown('KeyA')) vx -= 1
      if (inp.isKeyDown('KeyD')) vx += 1
      if (inp.isKeyDown('KeyW')) vy -= 1
      if (inp.isKeyDown('KeyS')) vy += 1
      if (!o.showDirections) {
        if (inp.isKeyDown('ArrowLeft')) vx -= 1
        if (inp.isKeyDown('ArrowRight')) vx += 1
        if (inp.isKeyDown('ArrowUp')) vy -= 1
        if (inp.isKeyDown('ArrowDown')) vy += 1
      }
      if (vx || vy) {
        const m = Math.hypot(vx, vy)
        this.move = { vx: m > 1 ? vx / m : vx, vy: m > 1 ? vy / m : vy, source: 'keyboard' }
        return
      }

      const pointers = typeof inp.getPointers === 'function' ? inp.getPointers() : []
      let ptr = this._movePointerId != null ? pointers.find((p) => p.id === this._movePointerId) : null
      if (!ptr) {
        // o dedo que movia saiu: adota outro dedo de campo ainda pressionado
        this._movePointerId = null
        ptr = pointers.find((p) => this._owners.get(p.id)?.kind === 'field') || null
        if (ptr) this._movePointerId = ptr.id
      }
      if (ptr) {
        const pf = layout.playfield
        const isMouse = ptr.pointerType === 'mouse'
        const off = isMouse ? o.mouseOffsetY : o.touchOffsetY * clamp(layout.uiScale || 1, 0.9, 1.2)
        this.fieldPointer = { x: ptr.x, y: ptr.y }
        this.move = {
          targetX: clamp(ptr.x, pf.x, pf.x + pf.w),
          targetY: clamp(ptr.y - off, pf.y, pf.y + pf.h),
          pointerX: ptr.x,
          pointerY: ptr.y,
          source: ptr.pointerType,
        }
      }
    },

    render(ctx, layout) {
      if (layout) this.layout = layout
      layout = this.layout
      if (!ctx || !layout) return
      const o = this.options
      const buttons = this.getButtons(layout)
      const u = clamp(layout.uiScale || 1, 0.9, 1.25)
      const t = this._time

      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // guia do dedo: anel no alvo + linha pontilhada até o dedo
      if (o.showTouchGuide && this.move && this.move.targetX != null && this.move.source !== 'mouse') {
        const m = this.move
        ctx.strokeStyle = rgba(INK, 0.35)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(m.pointerX, m.pointerY)
        ctx.lineTo(m.targetX, m.targetY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(m.targetX, m.targetY, 14 * u, 0, Math.PI * 2)
        ctx.stroke()
        tickRing(ctx, m.targetX, m.targetY, 14 * u, 18 * u, 8, 0.3)
      }

      const dirs = buttons.filter((b) => DIRS.includes(b.name))
      if (dirs.length) {
        const { cx, cy, d } = dirs[0]
        ctx.strokeStyle = rgba(INK, 0.22)
        ctx.lineWidth = 1
        ctx.setLineDash([2, 5])
        ctx.beginPath()
        ctx.arc(cx, cy, d, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        for (const b of dirs) drawDirection(ctx, b, this._held.has(b.name), this.isTouch)
        if (!this.isTouch) hintText(ctx, 'setas', cx, cy + d + dirs[0].r + 11, u)
      }

      for (const b of buttons) {
        if (b.name === 'special') drawSpecial(ctx, b, o, this._held.has('special'), this.isTouch, t, u)
        if (b.name === 'action') drawAction(ctx, b, o, this._held.has('action') || this.actionDown, this.isTouch, u)
      }
      ctx.restore()
    },
  }
  return controls
}

// ---------------------------------------------------------------------------
// desenho (instrumento técnico)
// ---------------------------------------------------------------------------

function tickRing(ctx, x, y, r0, r1, count, alpha, from = 0, to = Math.PI * 2) {
  ctx.strokeStyle = rgba(INK, alpha)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / count - Math.PI / 2
    const long = i % 3 === 0
    const ri = long ? r0 - (r1 - r0) * 0.6 : r0
    ctx.moveTo(x + Math.cos(a) * ri, y + Math.sin(a) * ri)
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
  }
  ctx.stroke()
}

function dial(ctx, b, pressed, isTouch) {
  const r = b.r * (pressed ? 0.94 : 1)
  ctx.fillStyle = pressed ? rgba(P.paperCreamDark, 0.92) : rgba(P.paperCreamLight, isTouch ? 0.72 : 0.6)
  ctx.beginPath()
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rgba(INK, pressed ? 0.95 : 0.8)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.strokeStyle = rgba(INK, 0.28)
  ctx.lineWidth = 0.75
  ctx.beginPath()
  ctx.arc(b.x, b.y, r * 0.74, 0, Math.PI * 2)
  ctx.stroke()
  tickRing(ctx, b.x, b.y, r * 0.8, r * 0.9, 24, 0.3)
  return r
}

function hintText(ctx, text, x, y, u) {
  ctx.font = `${Math.round(10 * u)}px Georgia, serif`
  ctx.fillStyle = rgba(INK, 0.7)
  ctx.fillText(text, x, y)
}

function drawAction(ctx, b, o, pressed, isTouch, u) {
  const r = dial(ctx, b, pressed, isTouch)
  // glifo: célula de favo (hexágono) - o "fazer" da operária
  const hr = r * 0.26
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    const px = b.x + Math.cos(a) * hr
    const py = b.y - r * 0.08 + Math.sin(a) * hr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = rgba(GOLD, pressed ? 0.75 : 0.5)
  ctx.fill()
  ctx.strokeStyle = rgba(INK, 0.85)
  ctx.lineWidth = 1.2
  ctx.stroke()
  if (r > 24) {
    ctx.font = `600 ${Math.round(clamp(r * 0.2, 8, 12))}px Georgia, serif`
    ctx.fillStyle = rgba(INK, 0.85)
    ctx.fillText(o.actionLabel, b.x, b.y + r * 0.45)
  }
  if (!isTouch) hintText(ctx, 'Espaço', b.x, b.y + b.r + 11, u)
}

function drawSpecial(ctx, b, o, pressed, isTouch, t, u) {
  const m = o.meter
  const ready = !!m && m.isReady
  const active = !!m && m.isActive
  const charge = m ? m.charge : 0

  if (ready) {
    // pulso: anéis finos em accentPink expandindo
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.9 + i * 0.5) % 1
      ctx.strokeStyle = rgba(PINK, 0.55 * (1 - ph))
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r + 3 + ph * 14 * u, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  if (active) {
    const g = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 1.6)
    g.addColorStop(0, rgba(P.sunHalo, 0.55))
    g.addColorStop(1, rgba(P.sunHalo, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r * 1.6, 0, Math.PI * 2)
    ctx.fill()
  }

  const r = dial(ctx, b, pressed, isTouch)

  // arco de carga (transferidor): trilho + preenchido
  const ar = r * 0.87
  const start = -Math.PI / 2
  ctx.lineCap = 'round'
  ctx.strokeStyle = rgba(INK, 0.12)
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.arc(b.x, b.y, ar, 0, Math.PI * 2)
  ctx.stroke()
  let frac = charge
  let color = rgba(INK, 0.7)
  if (ready) {
    frac = 1
    color = PINK
  } else if (active) {
    frac = 1 - m.activeProgress
    color = rgba(GOLD, 0.95)
  }
  if (frac > 0.001) {
    ctx.strokeStyle = color
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(b.x, b.y, ar, start, start + frac * Math.PI * 2)
    ctx.stroke()
    // agulha na ponta do arco
    const a = start + frac * Math.PI * 2
    ctx.strokeStyle = ready ? PINK : rgba(INK, 0.8)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(b.x + Math.cos(a) * r * 0.66, b.y + Math.sin(a) * r * 0.66)
    ctx.lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r)
    ctx.stroke()
  }
  ctx.lineCap = 'butt'

  // glifo: sol/estrela de 8 raios
  const gy = b.y - r * 0.08
  const g0 = r * 0.1
  const g1 = r * (ready ? 0.32 : 0.27)
  ctx.strokeStyle = ready ? PINK : rgba(INK, m && !active ? 0.55 + charge * 0.3 : 0.85)
  ctx.lineWidth = ready ? 1.8 : 1.3
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i + (active ? t * 2 : 0)
    const len = i % 2 ? g1 * 0.65 : g1
    ctx.moveTo(b.x + Math.cos(a) * g0, gy + Math.sin(a) * g0)
    ctx.lineTo(b.x + Math.cos(a) * len, gy + Math.sin(a) * len)
  }
  ctx.stroke()

  if (r > 20) {
    let label = o.specialLabel
    if (m) label = ready ? 'PRONTO' : active ? 'ATIVO' : `${Math.floor(charge * 100)}%`
    ctx.font = `600 ${Math.round(clamp(r * 0.22, 8, 12))}px Georgia, serif`
    ctx.fillStyle = ready ? PINK : rgba(INK, 0.85)
    ctx.fillText(label, b.x, b.y + r * 0.47)
  }
  if (!isTouch) hintText(ctx, 'E / Shift', b.x, b.y + b.r + 11, u)
}

function drawDirection(ctx, b, pressed, isTouch) {
  const r = dial(ctx, b, pressed, isTouch)
  const ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[b.name]
  const s = r * 0.34
  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.moveTo(s, 0)
  ctx.lineTo(-s * 0.6, -s * 0.8)
  ctx.lineTo(-s * 0.6, s * 0.8)
  ctx.closePath()
  ctx.fillStyle = rgba(INK, pressed ? 0.9 : 0.7)
  ctx.fill()
  ctx.restore()
}

export default createControls
