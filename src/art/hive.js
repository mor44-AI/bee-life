// Desenho procedural do interior da colmeia (favo de células, câmara real).
//
// Ver src/data/styleGuide.js: o favo deve ler como padrão ORGÂNICO - células
// de tamanho/rotação levemente irregulares e posições com jitter - nunca um
// grid perfeito de hexágonos idênticos. Isso também é biologicamente correto
// para Meliponini (abelhas sem ferrão como a Mandaçaia): ao contrário da Apis
// mellifera, o favo de cria é um disco horizontal com células bem menos
// regulares que o hex-grid clássico de colmeia europeia.
//
// Regra de design: funções puras - drawCell/drawComb/drawQueenChamber/
// drawHiveInterior só leem os parâmetros recebidos.

import {
  seededRandom,
  seedFromString,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  polygonPoints,
  tracePath,
  INK_LINE,
} from './textureUtils.js';

// ---------------------------------------------------------------------------
// Célula individual
// ---------------------------------------------------------------------------

/**
 * Desenha uma célula de favo em um dos estados do ciclo de vida da colônia.
 * cell: { x, y, size, rotation, seed }
 * state: 'empty' | 'egg' | 'larva' | 'capped' | 'honey' | 'pollen'
 */
export function drawCell(ctx, cell, state = 'empty') {
  const { x, y, size = 14, rotation = 0, seed = 1 } = cell;
  const pts = polygonPoints(x, y, size, size, 6, { rotation, jitter: 0.06, seed });

  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts, { closed: true, smooth: false });
  const wallGrad = ctx.createRadialGradient(x, y, size * 0.1, x, y, size);
  wallGrad.addColorStop(0, '#C9A227');
  wallGrad.addColorStop(1, '#8F6E20');
  ctx.fillStyle = wallGrad;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.clip();
  drawCellContent(ctx, x, y, size, state, seed);
  drawHatching(ctx, { x: x - size, y: y - size, width: size * 2, height: size * 2 }, {
    angle: rotation + 0.4,
    lineCount: 8,
    color: '#6E5219',
    opacityRange: [0.08, 0.16],
    seed: seed + 5,
    curveAmount: 1.4,
  });
  ctx.restore();

  strokeHandDrawn(ctx, pts, {
    color: INK_LINE,
    baseWidth: 1.1,
    widthJitter: 0.3,
    closed: true,
    seed: seed + 6,
    opacity: 0.7,
  });
  ctx.restore();
}

function drawCellContent(ctx, x, y, size, state, seed) {
  switch (state) {
    case 'egg': {
      ctx.save();
      ctx.fillStyle = '#F0EAD8';
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.ellipse(x, y + size * 0.15, size * 0.14, size * 0.3, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'larva': {
      // Poça de geleia nutritiva no fundo da célula.
      ctx.save();
      ctx.fillStyle = '#E9C96B';
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.ellipse(x, y + size * 0.32, size * 0.55, size * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Larva enrolada em "C" - construída como uma faixa de espessura
      // VARIÁVEL (afunilando nas pontas), não um traço de largura
      // constante com pontas arredondadas - isso lia como a letra "C"
      // tipográfica em vez de uma larva orgânica.
      const segs = 9;
      const rMid = size * 0.3;
      const startA = 0.1;
      const endA = Math.PI * 1.6;
      const spine = [];
      for (let i = 0; i <= segs; i++) {
        const a = startA + (endA - startA) * (i / segs);
        spine.push({ x: x + Math.cos(a) * rMid, y: y + Math.sin(a) * rMid, nx: Math.cos(a), ny: Math.sin(a) });
      }
      const outer = [];
      const inner = [];
      spine.forEach((p, i) => {
        const taper = Math.sin((i / segs) * Math.PI); // 0 nas pontas, 1 no meio
        const half = size * 0.16 * (0.18 + 0.82 * taper);
        outer.push({ x: p.x + p.nx * half, y: p.y + p.ny * half });
        inner.push({ x: p.x - p.nx * half, y: p.y - p.ny * half });
      });
      const larvaOutline = outer.concat(inner.reverse());
      ctx.beginPath();
      tracePath(ctx, larvaOutline, { closed: true, smooth: true });
      ctx.fillStyle = '#F0EAD8';
      ctx.fill();
      ctx.strokeStyle = '#C7BE9E';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      break;
    }
    case 'capped': {
      ctx.save();
      ctx.fillStyle = '#B99444';
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.82, size * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawStipple(ctx, { x: x - size, y: y - size, width: size * 2, height: size * 2 }, {
        color: '#7A5E22',
        count: 25,
        seed: seed + 8,
        radius: [0.4, 1],
        opacity: [0.1, 0.22],
      });
      break;
    }
    case 'honey': {
      ctx.save();
      const grad = ctx.createRadialGradient(
        x - size * 0.2, y - size * 0.2, 1,
        x, y, size,
      );
      grad.addColorStop(0, '#F5C542');
      grad.addColorStop(1, '#C9861F');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.85, size * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(247, 223, 160, 0.55)';
      ctx.beginPath();
      ctx.ellipse(x - size * 0.25, y - size * 0.25, size * 0.18, size * 0.1, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'pollen': {
      drawStipple(ctx, { x: x - size, y: y - size, width: size * 2, height: size * 2 }, {
        color: '#C9A227',
        count: 90,
        seed: seed + 9,
        radius: [0.6, 1.6],
        opacity: [0.45, 0.8],
      });
      drawStipple(ctx, { x: x - size, y: y - size, width: size * 2, height: size * 2 }, {
        color: '#8A5A22',
        count: 40,
        seed: seed + 10,
        radius: [0.4, 1],
        opacity: [0.3, 0.5],
      });
      break;
    }
    case 'empty':
    default: {
      drawStipple(ctx, { x: x - size, y: y - size * 0.2, width: size * 2, height: size * 1.2 }, {
        color: '#6E5219',
        count: 18,
        seed: seed + 7,
        radius: [0.4, 0.9],
        opacity: [0.08, 0.15],
        densityBias: (u, v) => v,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Favo completo
// ---------------------------------------------------------------------------

/**
 * Desenha um painel de favo em disposição hexagonal com jitter orgânico de
 * posição/tamanho/rotação por célula.
 * comb: {
 *   x, y, cols, rows, cellSize, seed, rotation,
 *   getState(col, row) -> string  // estado de cada célula, default 'empty'
 * }
 */
export function drawComb(ctx, comb = {}) {
  const {
    x = 0,
    y = 0,
    cols = 6,
    rows = 5,
    cellSize = 14,
    seed = 1,
    rotation = 0,
    getState = () => 'empty',
  } = comb;

  const rng = seededRandom(seed);
  const hexW = cellSize * 2;
  const hexH = Math.sqrt(3) * cellSize;
  const horiz = hexW * 0.75;
  const vert = hexH;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const jitterX = (rng() - 0.5) * cellSize * 0.14;
      const jitterY = (rng() - 0.5) * cellSize * 0.14;
      const cx = x + col * horiz + jitterX;
      const cy = y + row * vert + (col % 2 ? vert / 2 : 0) + jitterY;
      const sizeJ = cellSize * (0.92 + rng() * 0.14);
      const rot = rotation + (rng() - 0.5) * 0.14;
      const cellSeed = seedFromString(`${seed}-${col}-${row}`);
      const state = getState(col, row);
      drawCell(ctx, { x: cx, y: cy, size: sizeJ, rotation: rot, seed: cellSeed }, state);
    }
  }
}

// ---------------------------------------------------------------------------
// Câmara real
// ---------------------------------------------------------------------------

/**
 * Desenha a arquitetura da câmara real: uma célula bem maior e alongada,
 * de parede mais grossa, cercada por uma pequena "coroa" de células
 * seladas (guarda). Não desenha a rainha em si - isso é responsabilidade
 * de quem chama (reaproveitando drawBeeBody com um pose/colorVariant
 * próprios da rainha).
 * chamber: { x, y, width, height, seed, rotation }
 */
export function drawQueenChamber(ctx, chamber = {}) {
  const { x = 0, y = 0, width = 90, height = 60, seed = 1, rotation = 0 } = chamber;
  const rng = seededRandom(seed);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const pts = polygonPoints(0, 0, width / 2, height / 2, 18, { jitter: 0.08, seed });
  ctx.beginPath();
  tracePath(ctx, pts, { closed: true, smooth: true });
  const grad = ctx.createRadialGradient(0, -height * 0.1, 2, 0, 0, width * 0.65);
  grad.addColorStop(0, '#D9B34E');
  grad.addColorStop(1, '#8A6626');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.save();
  ctx.clip();
  drawHatching(ctx, { x: -width / 2, y: -height / 2, width, height }, {
    angle: 0.3,
    lineCount: 30,
    color: '#5C4419',
    opacityRange: [0.12, 0.24],
    seed: seed + 3,
    curveAmount: 3,
  });
  drawStipple(ctx, { x: -width / 2, y: -height / 2, width, height }, {
    color: '#3B2C10',
    count: 90,
    seed: seed + 4,
    radius: [0.4, 1.1],
    opacity: [0.08, 0.18],
    densityBias: (u, v) => v,
  });
  ctx.restore();

  strokeHandDrawn(ctx, pts, {
    color: INK_LINE,
    baseWidth: 2,
    widthJitter: 0.6,
    closed: true,
    seed: seed + 5,
    opacity: 0.9,
  });

  const guardCount = 6;
  for (let i = 0; i < guardCount; i++) {
    const a = (i / guardCount) * Math.PI * 2 + rng() * 0.2;
    const gx = Math.cos(a) * (width / 2 + 18);
    const gy = Math.sin(a) * (height / 2 + 14);
    drawCell(ctx, { x: gx, y: gy, size: 9, rotation: a, seed: seed + 10 + i }, 'capped');
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Composição completa do interior
// ---------------------------------------------------------------------------

/**
 * Desenha o interior da colmeia: parede/fundo escuro e quente com grão
 * sutil, seguido dos favos e da câmara real fornecidos em layout.
 * layout: {
 *   width, height, backgroundSeed,
 *   combs: [comb, ...],       // ver drawComb
 *   queenChamber: chamber|null // ver drawQueenChamber
 * }
 */
export function drawHiveInterior(ctx, layout = {}) {
  const {
    width = ctx.canvas?.width ?? 480,
    height = ctx.canvas?.height ?? 320,
    backgroundSeed = 1,
    combs = [],
    queenChamber = null,
  } = layout;

  ctx.save();
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#3B2C1C');
  grad.addColorStop(1, '#241A10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  drawStipple(ctx, { x: 0, y: 0, width, height }, {
    color: '#1A1208',
    count: 260,
    seed: backgroundSeed,
    radius: [0.5, 1.6],
    opacity: [0.05, 0.14],
  });
  drawHatching(ctx, { x: 0, y: 0, width, height }, {
    angle: 1.4,
    lineCount: 40,
    color: '#1A1208',
    opacityRange: [0.05, 0.12],
    seed: backgroundSeed + 1,
    curveAmount: 8,
  });
  ctx.restore();

  combs.forEach((comb) => drawComb(ctx, comb));
  if (queenChamber) drawQueenChamber(ctx, queenChamber);
}
