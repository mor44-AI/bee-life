// Utilitários procedurais compartilhados por bee.js, hive.js, environment.js
// e creatures.js — implementam as técnicas descritas em
// src/data/styleGuide.js (proceduralTexture.hatching / .stipple / .paperGrain)
// e as convenções de linework (traço de mão, cor de contorno quente).
//
// Regra de design do projeto: funções puras. Recebem ctx + parâmetros,
// nunca leem estado global, nunca guardam estado entre chamadas (exceto o
// PRNG determinístico local a cada chamada, que é sempre recriado a partir
// de uma seed explícita — não há Math.random() em lugar nenhum deste
// arquivo, para que a textura de uma entidade não "pisque" entre frames).

import { styleGuide } from '../data/styleGuide.js';

const { naturalist } = styleGuide.palettes;

export const INK_LINE = naturalist.inkLine;

// ---------------------------------------------------------------------------
// PRNG determinístico
// ---------------------------------------------------------------------------

/**
 * PRNG determinístico (mulberry32). Mesma seed => mesma sequência sempre,
 * o que mantém hachura/estipulagem estáveis por entidade entre frames.
 */
export function seededRandom(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Converte uma string (ex.: id de entidade) numa seed numérica estável. */
export function seedFromString(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const c = String(hex).replace('#', '');
  const full = c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

/** Clareia (amount > 0) ou escurece (amount < 0) uma cor hex, amount em [-1, 1]. */
export function shade(hexColor, amount) {
  const { r, g, b } = hexToRgb(hexColor);
  const mix = (channel) => {
    const target = amount >= 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  };
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Interpola linearmente entre duas cores hex, t em [0, 1]. */
export function mixColors(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bch = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

/** Converte hex (ou já 'rgb(...)') para uma string rgba com a opacidade dada. */
export function withAlpha(color, alpha = 1) {
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Geometria orgânica (linhas de mão, polígonos irregulares, caminhos suaves)
// ---------------------------------------------------------------------------

/**
 * Gera pontos ao redor de uma elipse com jitter opcional — usado tanto para
 * silhuetas "orgânicas" (blobs de corpo, jitter baixo, muitos lados) quanto
 * para células de favo hexagonais (sides=6, jitter baixo).
 */
export function polygonPoints(cx, cy, rx, ry, sides, opts = {}) {
  const { rotation = 0, jitter = 0, seed = 1 } = opts;
  const rng = seededRandom(seed);
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const jr = 1 + (rng() - 0.5) * 2 * jitter;
    pts.push({ x: cx + Math.cos(a) * rx * jr, y: cy + Math.sin(a) * ry * jr });
  }
  return pts;
}

/**
 * Traça (moveTo/lineTo ou curva suave via pontos médios) um caminho a partir
 * de uma lista de pontos, no ctx.path corrente — não faz fill/stroke, para
 * o caller poder aplicar clip/fill/stroke como quiser.
 */
export function tracePath(ctx, points, opts = {}) {
  const { closed = false, smooth = true } = opts;
  if (points.length < 2) return;
  const n = points.length;
  if (!smooth) {
    ctx.moveTo(points[0].x, points[0].y);
    const end = closed ? n : n - 1;
    for (let i = 1; i <= end; i++) {
      const p = points[i % n];
      ctx.lineTo(p.x, p.y);
    }
    if (closed) ctx.closePath();
    return;
  }
  // Curva suave passando pelos pontos médios entre vértices consecutivos —
  // evita curvas bezier perfeitamente simétricas (cornerStyle do styleGuide).
  const start = closed
    ? { x: (points[n - 1].x + points[0].x) / 2, y: (points[n - 1].y + points[0].y) / 2 }
    : points[0];
  ctx.moveTo(start.x, start.y);
  const end = closed ? n : n - 1;
  for (let i = 1; i <= end; i++) {
    const p0 = points[i - 1];
    const p1 = points[i % n];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  if (closed) ctx.closePath();
}

/**
 * Contorna um caminho com um traço "de mão": espessura variando levemente
 * segmento a segmento (nunca uniforme), cor quente (nunca preto puro por
 * padrão). points: [{x, y}, ...].
 */
export function strokeHandDrawn(ctx, points, opts = {}) {
  const {
    color = INK_LINE,
    baseWidth = 1.5,
    widthJitter = 0.4,
    closed = false,
    seed = 1,
    opacity = 1,
  } = opts;
  if (points.length < 2) return;
  const rng = seededRandom(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const segs = closed ? points.length : points.length - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    ctx.lineWidth = Math.max(0.35, baseWidth + (rng() - 0.5) * 2 * widthJitter);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Texturas proceduais (styleGuide.proceduralTexture)
// ---------------------------------------------------------------------------

/**
 * Hachura: dezenas de linhas curvas finas e paralelas de baixa opacidade.
 * O caller deve ter definido um clip (ctx.save(); path; ctx.clip();) para
 * a forma antes de chamar — a função só preenche o bounding box com a
 * família de linhas, cortadas naturalmente pela silhueta pelo clip ativo.
 */
export function drawHatching(ctx, bounds, opts = {}) {
  const {
    angle = 0,
    lineCount = 24,
    color = INK_LINE,
    opacityRange = [0.15, 0.3],
    seed = 1,
    curveAmount = 4,
    segments = 5,
  } = opts;
  const { x, y, width, height } = bounds;
  const rng = seededRandom(seed);
  const diag = Math.sqrt(width * width + height * height);
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  for (let i = 0; i < lineCount; i++) {
    const t = lineCount === 1 ? 0.5 : i / (lineCount - 1);
    const offset = (t - 0.5) * diag + (rng() - 0.5) * (diag / lineCount) * 1.6;
    const len = diag * (0.7 + rng() * 0.3);
    const startX = -len / 2;
    const endX = len / 2;
    const opacity = opacityRange[0] + rng() * (opacityRange[1] - opacityRange[0]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 0.5 + rng() * 0.5;
    ctx.beginPath();
    ctx.moveTo(startX, offset);
    for (let s = 1; s <= segments; s++) {
      const sx = startX + (endX - startX) * (s / segments);
      const wob = Math.sin((s / segments) * Math.PI * (1 + rng())) * curveAmount * (rng() * 0.6 + 0.4);
      ctx.lineTo(sx, offset + wob);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Estipulagem: campo de pontos pequenos, opacidade/densidade variável,
 * posições pseudo-aleatórias com seed fixa. densityBias(u, v) recebe
 * coordenadas normalizadas [0,1] dentro de bounds e retorna um peso [0,1]
 * (usado para concentrar a "sombra" numa região, ex.: mais denso embaixo).
 */
export function drawStipple(ctx, bounds, opts = {}) {
  const {
    color = INK_LINE,
    count = 150,
    seed = 2,
    radius = [0.4, 1.1],
    opacity = [0.08, 0.22],
    densityBias = () => 1,
  } = opts;
  const { x, y, width, height } = bounds;
  const rng = seededRandom(seed);
  ctx.save();
  ctx.fillStyle = color;
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 5;
  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const u = rng();
    const v = rng();
    const weight = densityBias(u, v);
    if (rng() > weight) continue;
    const px = x + u * width;
    const py = y + v * height;
    const r = radius[0] + rng() * (radius[1] - radius[0]);
    ctx.globalAlpha = opacity[0] + rng() * (opacity[1] - opacity[0]);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    placed++;
  }
  ctx.restore();
}

/**
 * Textura de "papel": duas cores de creme em faixas diagonais largas,
 * sobrepostas com um campo de ruído de opacidade muito baixa.
 */
export function drawPaperGrain(ctx, width, height, opts = {}) {
  const {
    colorLight = naturalist.paperCreamLight,
    colorDark = naturalist.paperCreamDark,
    bandWidth = 52,
    bandJitter = 12,
    seed = 7,
    noiseOpacity = [0.03, 0.06],
    noiseCount = 900,
    noiseColor = naturalist.inkLine,
  } = opts;
  const rng = seededRandom(seed);
  ctx.save();
  ctx.fillStyle = colorLight;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.translate(-width, -height);
  const diagLen = (width + height) * 2.6;
  let cursor = -diagLen / 2;
  ctx.fillStyle = colorDark;
  while (cursor < diagLen / 2) {
    const w = Math.max(8, bandWidth + (rng() - 0.5) * bandJitter);
    ctx.globalAlpha = 0.45 + rng() * 0.15;
    ctx.fillRect(cursor, -diagLen, w, diagLen * 2);
    cursor += w * 2;
  }
  ctx.restore();

  ctx.fillStyle = noiseColor;
  for (let i = 0; i < noiseCount; i++) {
    const px = rng() * width;
    const py = rng() * height;
    const r = 0.5 + rng() * 1.1;
    ctx.globalAlpha = noiseOpacity[0] + rng() * (noiseOpacity[1] - noiseOpacity[0]);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
