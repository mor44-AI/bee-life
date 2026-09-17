// API pública:
//   create({ pattern = 'file', spawnRate = 1, path, spawnPoint, fleeFrom, speed = 40,
//            bounds = null, maxEntities = 20 }) -> spawner (também default export)
//     pattern: 'file' (entidades seguem em fila um caminho/linha definido por `path`,
//       um array de pontos { x, y }; ao chegar no fim do caminho a entidade é removida)
//       ou 'erratic' (random-walk com viés de fuga a partir de `fleeFrom`/`spawnPoint`,
//       útil para simular fuga do jogador; respeita `bounds` se fornecido).
//     spawnRate: entidades spawnadas por segundo.
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
} = {}) {
  const origin = spawnPoint || path[0] || { x: 0, y: 0 }
  const fleePoint = fleeFrom || origin

  function spawnEntity() {
    const start = pattern === 'erratic' ? origin : path[0]
    return {
      id: nextId++,
      x: start.x,
      y: start.y,
      _pathIndex: 0,
      _done: false,
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
    const step = speed * dt

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

  function stepErratic(entity, dt) {
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

    entity.x += (dirX / len) * speed * dt
    entity.y += (dirY / len) * speed * dt

    if (bounds) {
      entity.x = Math.min(Math.max(entity.x, bounds.x), bounds.x + bounds.width)
      entity.y = Math.min(Math.max(entity.y, bounds.y), bounds.y + bounds.height)
    }
  }

  const spawner = {
    entities: [],
    pattern,
    spawnRate,
    _timeSinceSpawn: 0,

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

      this.entities = this.entities.filter((e) => !e._done)
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
