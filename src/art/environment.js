// Desenho procedural do cenário/ambiente (fundo de papel, luz, ciclo dia/noite).
//
// Ver src/data/styleGuide.js -> lighting.dayNightNote: o ciclo dia/noite NÃO
// troca de paleta abruptamente — a mesma paleta naturalista migra de "tons
// quentes plenos" (dia) para "saturação reduzida + leve viés azulado"
// (noite), preservando sempre o "papel" de fundo por baixo.
//
// Regra de design: funções puras — drawBackground/drawLightOverlay só leem
// os parâmetros recebidos (ctx, timeOfDay, options), nunca Date.now() nem
// nenhum outro estado global. Quem decide o instante do ciclo (TimeSystem)
// é responsabilidade de outro módulo; aqui só traduzimos esse instante em
// aparência visual.

import { styleGuide } from '../data/styleGuide.js';
import { drawPaperGrain, drawHatching, seededRandom, mixColors, withAlpha } from './textureUtils.js';

const { naturalist } = styleGuide.palettes;

// Viés azulado sutil usado para "esfriar" a paleta à noite sem trocá-la.
const NIGHT_TINT = '#2E3B52';

/**
 * Aceita timeOfDay numérico (0 = meia-noite, 0.5 = meio-dia, ciclo de 0..1)
 * ou uma palavra-chave ('day'|'morning'|'dusk'|'evening'|'night'|'dawn').
 * Retorna um fator [0,1] de "quanto de dia" tem na cena (1 = pleno dia,
 * 0 = noite fechada) — usado para interpolar tom/saturação, nunca para
 * trocar de paleta.
 */
function resolveDayFactor(timeOfDay) {
  if (typeof timeOfDay === 'number') {
    const cycle = ((timeOfDay % 1) + 1) % 1;
    const distFromNoon = Math.abs(0.5 - cycle);
    return Math.max(0, 1 - distFromNoon * 2.15);
  }
  const table = { day: 1, morning: 0.85, dawn: 0.55, dusk: 0.4, evening: 0.4, night: 0.05 };
  return table[timeOfDay] ?? 1;
}

/**
 * Desenha o fundo da cena: textura de papel (paperGrain) com a paleta
 * naturalista, migrada suavemente para tons mais frios/dessaturados à
 * noite, mais uma silhueta discreta de folhagem distante para moldurar a
 * cena (fora da colmeia).
 * options: { width, height, seed }
 */
export function drawBackground(ctx, timeOfDay, options = {}) {
  const {
    width = ctx.canvas?.width ?? 800,
    height = ctx.canvas?.height ?? 600,
    seed = 42,
  } = options;
  const dayFactor = resolveDayFactor(timeOfDay);
  const nightBias = (1 - dayFactor) * 0.4;

  const lightCream = mixColors(naturalist.paperCreamLight, NIGHT_TINT, nightBias * 0.9);
  const darkCream = mixColors(naturalist.paperCreamDark, NIGHT_TINT, nightBias);

  drawPaperGrain(ctx, width, height, {
    colorLight: lightCream,
    colorDark: darkCream,
    seed,
    noiseOpacity: [0.03, 0.06],
  });

  // Véu translúcido de "esfriamento" — preserva o papel por baixo, só reduz
  // saturação/tom conforme a noite avança (nunca uma paleta nova).
  if (dayFactor < 0.97) {
    ctx.save();
    ctx.globalAlpha = (1 - dayFactor) * 0.26;
    ctx.fillStyle = NIGHT_TINT;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  drawDistantFoliage(ctx, width, height, dayFactor, seed + 1);
}

function drawDistantFoliage(ctx, width, height, dayFactor, seed) {
  const rng = seededRandom(seed);
  const baseColor = mixColors(naturalist.leafSageShadow, NIGHT_TINT, (1 - dayFactor) * 0.5);
  const count = 5;
  ctx.save();
  ctx.globalAlpha = 0.3 + dayFactor * 0.15;
  ctx.fillStyle = baseColor;
  for (let i = 0; i < count; i++) {
    const bx = (width / count) * i + rng() * (width / count);
    const by = height * (0.72 + rng() * 0.22);
    const r = width * 0.05 + rng() * width * 0.06;
    ctx.beginPath();
    ctx.ellipse(bx, by, r, r * 0.55, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.1 + dayFactor * 0.05;
  drawHatching(ctx, { x: 0, y: height * 0.68, width, height: height * 0.32 }, {
    angle: 0,
    lineCount: 26,
    color: baseColor,
    opacityRange: [0.08, 0.16],
    seed: seed + 2,
    curveAmount: 6,
  });
  ctx.restore();
}

/**
 * Desenha o glow dourado quente de luz de fim de tarde (gradiente radial
 * suave, nunca sombra dura). Escala com dayFactor — à noite o glow
 * praticamente desaparece.
 * options: { width, height, cx, cy, radius }
 */
export function drawLightOverlay(ctx, timeOfDay, options = {}) {
  const {
    width = ctx.canvas?.width ?? 800,
    height = ctx.canvas?.height ?? 600,
    cx = width * 0.5,
    cy = height * 0.32,
    radius = Math.max(width, height) * 0.65,
  } = options;
  const dayFactor = resolveDayFactor(timeOfDay);
  if (dayFactor <= 0.03) return;

  ctx.save();
  const goldColor = mixColors(naturalist.sunGold, NIGHT_TINT, (1 - dayFactor) * 0.5);
  const haloColor = mixColors(naturalist.sunHalo, NIGHT_TINT, (1 - dayFactor) * 0.5);
  const grad = ctx.createRadialGradient(cx, cy, Math.max(1, radius * 0.05), cx, cy, radius);
  grad.addColorStop(0, withAlpha(goldColor, 0.35 * dayFactor));
  grad.addColorStop(0.5, withAlpha(haloColor, 0.16 * dayFactor));
  grad.addColorStop(1, withAlpha(haloColor, 0));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
