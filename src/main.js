// Vida de Abelha — ponto de entrada.
// Onda 0: apenas prova que o pipeline (canvas + resize + loop) funciona.
// Onda 3 (Integração) vai reescrever este arquivo para orquestrar
// engine/, states/, systems/ etc.

const canvas = document.querySelector('#game-canvas')
const ctx = canvas.getContext('2d')

// Cor provisória de "colmeia" (dourado/âmbar suave).
const HIVE_COLOR = '#d9a441'

function resizeCanvas() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

window.addEventListener('resize', resizeCanvas)
resizeCanvas()

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = HIVE_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)
