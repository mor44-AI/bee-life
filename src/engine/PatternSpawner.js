// API pública:
//   create({ pattern = 'file', spawnRate = 1, path, spawnPoint, fleeFrom, speed = 40,
//            bounds = null, maxEntities = 20, flee = true, onExit = null })
//     -> spawner (também default export)
//     pattern: 'file' (entidades seguem em fila um caminho/linha definido por `path`,
//       um array de pontos { x, y }; ao chegar no fim do caminho a entidade é removida)
//       ou 'erratic' (random-walk com viés de fuga a partir de `fleeFrom`/`spawnPoint`,
//       útil para simular fuga do jogador; respeita `bounds` se fornecido).
//     spawnRate: entidades spawnadas por segundo (0 = só spawn manual).
//     flee (só 'erratic'): true (padrão) = viés de fuga de fleeFrom; false = passeio
//       aleatório suave (direção que vira aos poucos), sem fuga, rebatendo em `bounds`.
//     onExit(entity, spawner): chamado quando uma entidade 'file' chega ao FIM do
//       caminho e é removida (antes sumia em silêncio). Também editável via
//       spawner.onExit. NÃO é chamado para entidades capturadas por checkCapture.
//     Velocidade por entidade: se entity.speed existir, substitui `speed` para ela.
//   spawner.spawn(props = {}) -> entity
//     Spawn manual imediato (ignora spawnRate e maxEntities). A entidade nasce no
//     início do caminho ('file') ou em spawnPoint ('erratic'); `props` sobrescreve
//     campos (ex. { x, y, speed, kind }). Retorna a entidade inserida em .entities.
//   spawner.update(dt) -> void
//     Spawna novas entidades conforme spawnRate e avança o movimento de todas.
//   spawner.entities -> Array<{ id, x, y, ... }> (entidades vivas)
//   spawner.checkCapture(playerPos, radius) -> Array<entity>
//     Retorna as entidades cujo centro está a `radius` ou menos de playerPos, e as
//     remove de .entities (efeito colateral: captura consome a entidade).

let nextId = 1

export function create({
  pattern = 'file',
  spawnRate = 1,
  path = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  spawnPoint = null,
  fleeFrom = null,
  speed = 40,
  bounds = null,
  maxEntities = 20,
  flee = true,
  onExit = null,
} = {}) {
  const origin = spawnPoint || path[0] || { x: 0, y: 0 }
  const fleePoint = fleeFrom || origin

  function spawnEntity(props = {}) {
    const start = (pattern === 'erratic' ? origin : path[0]) || { x: 0, y: 0 }
    return {
      id: nextId++,
      x: start.x,
      y: start.y,
      _pathIndex: 0,
      _done: false,
      _heading: Math.random() * Math.PI * 2,
      ...props,
    }
  }

  function stepFile(entity, dt) {
    const target = path[entity._pathIndex + 1]
    if (!target) {
      entity._done = true
      return
    }

    const dx = target.x - entity.x
    const dy = target.y - entity.y
    const dist = Math.hypot(dx, dy)
    const step = (entity.speed ?? speed) * dt

    if (dist <= step) {
      entity.x = target.x
      entity.y = target.y
      entity._pathIndex += 1
      if (entity._pathIndex >= path.length - 1) entity._done = true
    } else {
      entity.x += (dx / dist) * step
      entity.y += (dy / dist) * step
    }
  }

  function stepWander(entity, dt) {
    const v = entity.speed ?? speed
    entity._heading = (entity._heading ?? Math.random() * Math.PI * 2) + (Math.random() * 2 - 1) * 3.2 * dt
    entity.x += Math.cos(entity._heading) * v * dt
    entity.y += Math.sin(entity._heading) * v * dt
    if (bounds) {
      if (entity.x < bounds.x || entity.x > bounds.x + bounds.width) {
        entity._heading = Math.PI - entity._heading
        entity.x = Math.min(Math.max(entity.x, bounds.x), bounds.x + bounds.width)
      }
      if (entity.y < bounds.y || entity.y > bounds.y + bounds.height) {
        entity._heading = -entity._heading
        entity.y = Math.min(Math.max(entity.y, bounds.y), bounds.y + bounds.height)
      }
    }
  }

  function stepErratic(entity, dt) {
    if (!spawner.flee) {
      stepWander(entity, dt)
      return
    }
    const v = entity.speed ?? speed
    const dx = entity.x - fleePoint.x
    const dy = entity.y - fleePoint.y
    const distFromFlee = Math.hypot(dx, dy) || 1
    const fleeX = dx / distFromFlee
    const fleeY = dy / distFromFlee

    // Mistura direção de fuga com ruído aleatório para um movimento errático,
    // não uma linha reta previsível.
    const jitterAngle = Math.random() * Math.PI * 2
    const jitterStrength = 0.6
    const dirX = fleeX * (1 - jitterStrength) + Math.cos(jitterAngle) * jitterStrength
    const dirY = fleeY * (1 - jitterStrength) + Math.sin(jitterAngle) * jitterStrength
    const len = Math.hypot(dirX, dirY) || 1

    entity.x += (dirX / len) * v * dt
    entity.y += (dirY / len) * v * dt

    if (bounds) {
      entity.x = Math.min(Math.max(entity.x, bounds.x), bounds.x + bounds.width)
      entity.y = Math.min(Math.max(entity.y, bounds.y), bounds.y + bounds.height)
    }
  }

  const spawner = {
    entities: [],
    pattern,
    spawnRate,
    flee,
    onExit,
    _timeSinceSpawn: 0,

    spawn(props = {}) {
      const entity = spawnEntity(props)
      this.entities.push(entity)
      return entity
    },

    update(dt) {
      this._timeSinceSpawn += dt
      const interval = this.spawnRate > 0 ? 1 / this.spawnRate : Infinity

      while (this._timeSinceSpawn >= interval && this.entities.length < maxEntities) {
        this._timeSinceSpawn -= interval
        this.entities.push(spawnEntity())
      }

      for (const entity of this.entities) {
        if (this.pattern === 'erratic') {
          stepErratic(entity, dt)
        } else {
          stepFile(entity, dt)
        }
      }

      const exited = []
      this.entities = this.entities.filter((e) => {
        if (e._done) exited.push(e)
        return !e._done
      })
      if (typeof this.onExit === 'function') {
        for (const e of exited) this.onExit(e, this)
      }
    },

    checkCapture(playerPos, radius) {
      const captured = []
      this.entities = this.entities.filter((entity) => {
        const dx = entity.x - playerPos.x
        const dy = entity.y - playerPos.y
        const hit = dx * dx + dy * dy <= radius * radius
        if (hit) captured.push(entity)
        return !hit
      })
      return captured
    },
  }

  return spawner
}

export default create
