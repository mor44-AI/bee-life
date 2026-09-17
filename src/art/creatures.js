// Desenho procedural de outras criaturas: formiga invasora, mosca-de-forídeo
// (parasita da colmeia) e larva da traça-de-cera.
//
// CRÍTICO (ver instruções da tarefa): as tarefas de Defesa da entrada e
// Limpeza dependem do jogador reconhecer essas criaturas por reflexo visual
// rápido. As três silhuetas abaixo foram desenhadas para serem o mais
// diferentes possível entre si e da abelha (src/art/bee.js), mesmo em baixa
// resolução/à distância:
//   - Formiga: corpo rígido de 3 segmentos bem alongado, cintura MUITO
//     marcada (2 nódulos de pecíolo), SEM asas, cor escura uniforme (sem
//     faixas), antenas longas retas, 6 pernas finas e compridas, corrida
//     rasteira rápida.
//   - Mosca-de-forídeo: corpo pequeno e "corcunda" (tórax bem arqueado -
//     característica real da família Phoridae, "hunchback fly"), UM único
//     par de asas (Diptera, vs. 2 pares da abelha), olhos avermelhados
//     grandes, voo/corrida errático e nervoso, baixo rente ao favo.
//   - Larva da traça-de-cera: corpo mole tubular segmentado, pálido, SEM
//     pernas articuladas visíveis (só pequenos stubs), rastejar ondulante
//     lento - silhueta de "verme", oposta às duas anteriores.
//
// Regra de design: funções puras - cada draw* só lê a pose recebida.

import {
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  polygonPoints,
  tracePath,
  INK_LINE,
} from './textureUtils.js';

// ---------------------------------------------------------------------------
// Formiga
// ---------------------------------------------------------------------------

const ANT_COLOR = { body: '#241A10', leg: '#180F07', shine: 'rgba(239, 232, 214, 0.25)' };

/** Pose paramétrica de formiga correndo (marcha tipo tripé nas 6 pernas). */
export function createAntPose(x, y, t, options = {}) {
  const { rotation = 0, scale = 1, seed = 1 } = options;
  return { x, y, rotation, scale, seed, t, legPhase: t * 14, action: 'scurry' };
}

export function drawAnt(ctx, pose) {
  const seed = pose.seed ?? 1;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rotation || 0);
  const s = pose.scale || 1;
  ctx.scale(s, s);

  drawAntLegs(ctx, pose, seed);

  // Gáster (abdômen) - oval grande e escuro na parte de trás, SEM faixas
  // claras (ao contrário da abelha) para reforçar leitura de silhueta única.
  const gasterPts = polygonPoints(-8, 0, 5.4, 4.2, 14, { jitter: 0.05, seed: seed + 1 });
  ctx.beginPath();
  tracePath(ctx, gasterPts, { closed: true, smooth: true });
  ctx.fillStyle = ANT_COLOR.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawHatching(ctx, { x: -14, y: -5, width: 12, height: 10 }, {
    angle: 0.5, lineCount: 12, color: '#0F0A05', opacityRange: [0.15, 0.3], seed: seed + 2, curveAmount: 1.4,
  });
  ctx.fillStyle = ANT_COLOR.shine;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(-9.5, -1.5, 1.6, 0.9, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  strokeHandDrawn(ctx, gasterPts, { color: INK_LINE, baseWidth: 1.1, widthJitter: 0.3, closed: true, seed: seed + 3, opacity: 0.85 });

  // Pecíolo - 2 nódulos finos: a cintura bem mais marcada que a da abelha é
  // o principal diferenciador de silhueta a distância.
  drawPetioleNode(ctx, -3.6, 0, 1.3, seed + 4);
  drawPetioleNode(ctx, -1.8, 0, 1.05, seed + 5);

  // Tórax
  const thoraxPts = polygonPoints(1.5, 0, 3.6, 2.6, 12, { jitter: 0.04, seed: seed + 6 });
  ctx.beginPath();
  tracePath(ctx, thoraxPts, { closed: true, smooth: true });
  ctx.fillStyle = ANT_COLOR.body;
  ctx.fill();
  strokeHandDrawn(ctx, thoraxPts, { color: INK_LINE, baseWidth: 1, widthJitter: 0.25, closed: true, seed: seed + 7, opacity: 0.85 });

  drawAntHead(ctx, seed);

  ctx.restore();
}

function drawPetioleNode(ctx, cx, cy, r, seed) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = ANT_COLOR.body;
  ctx.fill();
  ctx.strokeStyle = INK_LINE;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawAntLegs(ctx, pose, seed) {
  const attach = [{ x: 3, y: 1.5 }, { x: 0.5, y: 1.8 }, { x: -2, y: 1.6 }];
  attach.forEach((hip, i) => {
    // Marcha tipo tripé: pernas 0/2 em fase, perna 1 em contrafase.
    const tripodOffset = i === 1 ? Math.PI : 0;
    const phase = (pose.legPhase || 0) + tripodOffset;
    const swing = Math.sin(phase) * 4.5;
    const knee = { x: hip.x + swing * 0.3 + 2, y: hip.y + 5 };
    const foot = { x: hip.x + swing, y: hip.y + 9 };
    strokeHandDrawn(ctx, [hip, knee, foot], {
      color: ANT_COLOR.leg, baseWidth: 0.8, widthJitter: 0.2, seed: seed + 20 + i, opacity: 0.9,
    });
  });
}

function drawAntHead(ctx, seed) {
  ctx.save();
  ctx.translate(6.5, 0);

  // Antenas longas e retas (bem mais compridas que as da abelha).
  strokeHandDrawn(ctx, [{ x: 0, y: -1.5 }, { x: 3, y: -5 }, { x: 7, y: -4 }], {
    color: ANT_COLOR.leg, baseWidth: 0.6, widthJitter: 0.15, seed: seed + 30, opacity: 0.9,
  });
  strokeHandDrawn(ctx, [{ x: 0, y: -1 }, { x: 3.5, y: -4 }, { x: 7.5, y: -2.5 }], {
    color: ANT_COLOR.leg, baseWidth: 0.6, widthJitter: 0.15, seed: seed + 31, opacity: 0.9,
  });
  // Mandíbulas.
  strokeHandDrawn(ctx, [{ x: 2.8, y: 1 }, { x: 5, y: 2.2 }], {
    color: ANT_COLOR.leg, baseWidth: 0.9, widthJitter: 0.1, seed: seed + 32, opacity: 0.9,
  });
  strokeHandDrawn(ctx, [{ x: 2.8, y: -1 }, { x: 5, y: -2.2 }], {
    color: ANT_COLOR.leg, baseWidth: 0.9, widthJitter: 0.1, seed: seed + 33, opacity: 0.9,
  });

  const headPts = polygonPoints(0, 0, 2.8, 2.6, 12, { jitter: 0.05, seed: seed + 34 });
  ctx.beginPath();
  tracePath(ctx, headPts, { closed: true, smooth: true });
  ctx.fillStyle = ANT_COLOR.body;
  ctx.fill();
  strokeHandDrawn(ctx, headPts, { color: INK_LINE, baseWidth: 0.9, widthJitter: 0.2, closed: true, seed: seed + 35, opacity: 0.85 });

  ctx.beginPath();
  ctx.ellipse(0.6, -1, 0.6, 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#100C08';
  ctx.fill();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mosca-de-forídeo
// ---------------------------------------------------------------------------

const FLY_COLOR = { body: '#4A2A22', wing: 'rgba(230, 225, 210, 0.3)', eye: '#7A1F1F' };

/** Pose paramétrica de mosca-de-forídeo - movimento errático, nervoso, rente ao favo. */
export function createPhoridFlyPose(x, y, t, options = {}) {
  const { rotation = 0, scale = 1, seed = 1 } = options;
  return {
    x,
    y,
    rotation,
    scale,
    seed,
    t,
    wingAngle: Math.sin(t * 40) * 0.8,
    legPhase: t * 20,
    hover: Math.sin(t * 9) * 1.2,
    action: 'dart',
  };
}

export function drawPhoridFly(ctx, pose) {
  const seed = pose.seed ?? 1;
  ctx.save();
  ctx.translate(pose.x, pose.y + (pose.hover || 0));
  ctx.rotate(pose.rotation || 0);
  const s = pose.scale || 1;
  ctx.scale(s, s);

  // Par ÚNICO de asas (Diptera) - diferenciador anatômico direto vs. os 2
  // pares de asas da abelha.
  drawFlyWing(ctx, pose, 1);
  drawFlyWing(ctx, pose, -1);

  drawFlyLegs(ctx, pose, seed);

  // Corpo curto e corcunda - tórax bem arqueado ("hunchback fly", traço
  // real da família Phoridae), silhueta compacta e arredondada, sem faixas.
  const bodyPts = polygonPoints(0, -0.5, 4.2, 3.6, 14, { jitter: 0.05, seed: seed + 1 });
  bodyPts.forEach((p) => {
    if (p.y < -1) p.y -= 1.6;
  });
  ctx.beginPath();
  tracePath(ctx, bodyPts, { closed: true, smooth: true });
  ctx.fillStyle = FLY_COLOR.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawStipple(ctx, { x: -5, y: -6, width: 10, height: 10 }, {
    color: '#2E1810', count: 40, seed: seed + 2, radius: [0.3, 0.7], opacity: [0.15, 0.3],
  });
  ctx.restore();
  strokeHandDrawn(ctx, bodyPts, { color: INK_LINE, baseWidth: 0.9, widthJitter: 0.25, closed: true, seed: seed + 3, opacity: 0.85 });

  // Cabeça pequena com olhos avermelhados grandes (traço real, mas mantido
  // proporcional ao corpo minúsculo - não é um mascote de olhos gigantes).
  ctx.save();
  ctx.translate(3.6, -0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.9, 1.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = FLY_COLOR.body;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0.3, -0.2, 1.5, 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = FLY_COLOR.eye;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(-0.1, -0.6, 0.4, 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 232, 214, 0.5)';
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawFlyWing(ctx, pose, side) {
  ctx.save();
  ctx.translate(0, -1.5);
  ctx.scale(1, side);
  ctx.rotate(-0.5 - (pose.wingAngle || 0));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(5, -3.5, 8.5, -0.5);
  ctx.quadraticCurveTo(5, 1.2, 0, 0);
  ctx.closePath();
  ctx.fillStyle = FLY_COLOR.wing;
  ctx.fill();
  ctx.strokeStyle = 'rgba(43, 36, 24, 0.3)';
  ctx.lineWidth = 0.4;
  ctx.stroke();
  ctx.restore();
}

function drawFlyLegs(ctx, pose, seed) {
  const attach = [{ x: 1.5, y: 2 }, { x: 0, y: 2.2 }, { x: -1.8, y: 2 }];
  attach.forEach((hip, i) => {
    const phase = (pose.legPhase || 0) + i * 2;
    const swing = Math.sin(phase) * 1.6;
    strokeHandDrawn(ctx, [
      { x: hip.x, y: hip.y },
      { x: hip.x + swing * 0.4, y: hip.y + 2 },
      { x: hip.x + swing, y: hip.y + 3.6 },
    ], { color: '#2E1810', baseWidth: 0.5, widthJitter: 0.15, seed: seed + 40 + i, opacity: 0.85 });
  });
}

// ---------------------------------------------------------------------------
// Larva da traça-de-cera
// ---------------------------------------------------------------------------

const LARVA_COLOR = { body: '#E7DFC4', shadow: '#C7BE9E', head: '#9C8F63' };

/** Pose paramétrica de larva rastejando (ondulação lenta do corpo mole). */
export function createWaxMothLarvaPose(x, y, t, options = {}) {
  const { rotation = 0, scale = 1, seed = 1, segments = 7 } = options;
  return { x, y, rotation, scale, seed, t, segments, undulate: t * 3, action: 'crawl' };
}

export function drawWaxMothLarva(ctx, pose) {
  const seed = pose.seed ?? 1;
  const segments = pose.segments ?? 7;
  const segLen = 3.4;

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rotation || 0);
  const s = pose.scale || 1;
  ctx.scale(s, s);

  // Espinha central ondulante - corpo mole tubular, SEM segmentação rígida
  // de exoesqueleto (oposto à formiga) e SEM asas (oposto à mosca).
  const spine = [];
  for (let i = 0; i < segments; i++) {
    const px = ((segments - 1) / 2) * segLen - i * segLen;
    const wave = Math.sin((pose.undulate || 0) - i * 0.9) * 1.3;
    spine.push({ x: px, y: wave });
  }

  const top = [];
  const bottom = [];
  spine.forEach((p, i) => {
    const mid = (segments - 1) / 2;
    const taper = 1 - Math.pow(Math.abs(i - mid) / (mid + 0.6), 1.6);
    const r = 2.6 * Math.max(0.35, taper);
    top.push({ x: p.x, y: p.y - r });
    bottom.push({ x: p.x, y: p.y + r });
  });
  const outline = top.concat(bottom.reverse());

  ctx.beginPath();
  tracePath(ctx, outline, { closed: true, smooth: true });
  ctx.fillStyle = LARVA_COLOR.body;
  ctx.fill();

  ctx.save();
  ctx.clip();
  spine.forEach((p, i) => {
    if (i === 0) return;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2.6);
    ctx.lineTo(p.x, p.y + 2.6);
    ctx.strokeStyle = LARVA_COLOR.shadow;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  drawHatching(ctx, { x: (-segments * segLen) / 2, y: -4, width: segments * segLen, height: 8 }, {
    angle: 0.1, lineCount: 14, color: LARVA_COLOR.shadow, opacityRange: [0.1, 0.2], seed: seed + 1, curveAmount: 1,
  });
  drawStipple(ctx, { x: (-segments * segLen) / 2, y: 0, width: segments * segLen, height: 4 }, {
    color: LARVA_COLOR.shadow, count: 30, seed: seed + 2, radius: [0.3, 0.7], opacity: [0.1, 0.2], densityBias: (u, v) => v,
  });
  ctx.restore();

  strokeHandDrawn(ctx, outline, { color: INK_LINE, baseWidth: 0.9, widthJitter: 0.3, closed: true, seed: seed + 3, opacity: 0.65 });

  // Cabecinha discreta e escura na ponta da frente.
  const headPos = spine[0];
  ctx.beginPath();
  ctx.ellipse(headPos.x + 1.6, headPos.y, 1.3, 1.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = LARVA_COLOR.head;
  ctx.fill();
  ctx.strokeStyle = INK_LINE;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Pequenos pró-pés (stubs) - não pernas articuladas - reforça a leitura
  // "corpo mole de verme", nunca pernas finas e rígidas como formiga/mosca.
  for (let i = 1; i < segments - 1; i += 2) {
    const p = spine[i];
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2.4, 0.7, 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = LARVA_COLOR.shadow;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
