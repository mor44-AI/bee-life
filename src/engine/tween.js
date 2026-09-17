// API pública:
//   ease(t, type = 'linear') -> number
//     Aplica uma curva de easing a t (esperado em [0,1], é clampado internamente)
//     e retorna o valor suavizado, também em [0,1].
//     Tipos suportados: 'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
//     'easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'easeInBack', 'easeOutBack',
//     'easeOutBounce'. Tipo desconhecido cai em 'linear'.
//   lerp(a, b, t) -> number
//     Interpolação linear simples entre a e b (t não é clampado aqui).
//   interpolatePose(poseA, poseB, t, easeType = 'linear') -> object
//     Recebe dois objetos "pose" (formato livre, ex. { x, y, rotation, scale }),
//     percorre a união das chaves e interpola os valores numéricos com ease(t, easeType).
//     Chaves não-numéricas usam o valor de poseA até a metade do trajeto e o de poseB
//     depois (sem interpolação real, já que não são números).

function clamp01(t) {
  if (t < 0) return 0
  if (t > 1) return 1
  return t
}

const EASINGS = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => {
    const u = t - 1
    return u * u * u + 1
  },
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  easeInBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return c3 * t * t * t - c1 * t * t
  },
  easeOutBack: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    const u = t - 1
    return 1 + c3 * u * u * u + c1 * u * u
  },

  easeOutBounce: (t) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) {
      const u = t - 1.5 / d1
      return n1 * u * u + 0.75
    }
    if (t < 2.5 / d1) {
      const u = t - 2.25 / d1
      return n1 * u * u + 0.9375
    }
    const u = t - 2.625 / d1
    return n1 * u * u + 0.984375
  },
}

export function ease(t, type = 'linear') {
  const fn = EASINGS[type] || EASINGS.linear
  return fn(clamp01(t))
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function interpolatePose(poseA = {}, poseB = {}, t, easeType = 'linear') {
  const et = ease(t, easeType)
  const result = {}
  const keys = new Set([...Object.keys(poseA), ...Object.keys(poseB)])

  for (const key of keys) {
    const a = poseA[key]
    const b = poseB[key]

    if (typeof a === 'number' && typeof b === 'number') {
      result[key] = lerp(a, b, et)
    } else if (b !== undefined) {
      result[key] = et < 0.5 && a !== undefined ? a : b
    } else {
      result[key] = a
    }
  }

  return result
}
