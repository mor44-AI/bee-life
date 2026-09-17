// API pública:
//   create({ bounds, obstacles = [], speed = 100 }) -> controller (também default export)
//     bounds: { x, y, width, height } | null — retângulo que limita a área navegável
//       (posição é clampada às bordas). Se null, movimento é livre/ilimitado.
//     obstacles: lista de formas simples a colidir — círculo { x, y, radius } ou
//       retângulo { x, y, width, height }. Ao colidir, o movimento daquele frame é
//       bloqueado (posição não avança) e .collided vira true.
//     speed: velocidade base (unidades/segundo).
//   controller.update(dt, inputVector = { x, y }) -> void
//     inputVector é um vetor de direção (não precisa estar normalizado; se sua
//     magnitude for > 1, é normalizado internamente — magnitudes <= 1 são respeitadas
//     como estão, útil para input analógico).
//   controller.position -> { x, y } (atualizado por update)
//   controller.collided -> boolean (true apenas no frame em que uma colisão bloqueou o movimento)
//   controller.setSpeedMultiplier(multiplier) -> void
//     Multiplica a velocidade base dinamicamente (ex. carregar um item pesado = 0.5).
//   controller.setPosition(x, y) -> void
//     Reposiciona diretamente (ex. inicialização, teleporte).

function shapeContainsPoint(shape, x, y) {
  if (shape.radius != null) {
    const dx = x - shape.x
    const dy = y - shape.y
    return dx * dx + dy * dy <= shape.radius * shape.radius
  }
  return (
    x >= shape.x &&
    x <= shape.x + shape.width &&
    y >= shape.y &&
    y <= shape.y + shape.height
  )
}

export function create({ bounds = null, obstacles = [], speed = 100 } = {}) {
  const startX = bounds ? bounds.x + bounds.width / 2 : 0
  const startY = bounds ? bounds.y + bounds.height / 2 : 0

  const controller = {
    position: { x: startX, y: startY },
    collided: false,
    speed,
    _speedMultiplier: 1,

    setSpeedMultiplier(multiplier) {
      this._speedMultiplier = multiplier
    },

    setPosition(x, y) {
      this.position = { x, y }
    },

    update(dt, inputVector = { x: 0, y: 0 }) {
      this.collided = false

      const ix = inputVector.x || 0
      const iy = inputVector.y || 0
      const mag = Math.hypot(ix, iy)
      const dirX = mag > 1 ? ix / mag : ix
      const dirY = mag > 1 ? iy / mag : iy

      const velocity = this.speed * this._speedMultiplier
      let nextX = this.position.x + dirX * velocity * dt
      let nextY = this.position.y + dirY * velocity * dt

      if (bounds) {
        nextX = Math.min(Math.max(nextX, bounds.x), bounds.x + bounds.width)
        nextY = Math.min(Math.max(nextY, bounds.y), bounds.y + bounds.height)
      }

      for (const obstacle of obstacles) {
        if (shapeContainsPoint(obstacle, nextX, nextY)) {
          this.collided = true
          return
        }
      }

      this.position = { x: nextX, y: nextY }
    },
  }

  return controller
}

export default create
