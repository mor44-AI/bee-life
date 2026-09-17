// Desenho procedural da abelha (Mandaçaia / Melipona quadrifasciata).
//
// Ver src/data/styleGuide.js -> beeDesignNote: a abelha precisa ler como
// ilustração naturalista elegante e anatomicamente plausível (cabeça, tórax
// e abdômen distintos, asas translúcidas com nervura fina) - nunca como
// mascote de cartoon (nada de cabeça gigante / olhos enormes). O charme vem
// da animação fluida e da textura de hachura, não de proporções exageradas.
//
// Regra de design: funções puras. drawBeeBody(ctx, pose) só lê `pose` - não
// há estado global nem side-effects fora do desenho. As funções create*Pose
// são fábricas de pose (também puras: recebem x, y, t e devolvem um objeto
// pose nunca compartilhado por referência entre chamadas). A interpolação
// *entre* poses nomeadas (ex.: idle -> voo) é responsabilidade do chamador,
// via engine/tween.js#interpolatePose - este módulo não depende de tween.js
// internamente, só sabe desenhar uma pose e gerar poses paramétricas por t.

import {
  seededRandom,
  strokeHandDrawn,
  drawHatching,
  drawStipple,
  tracePath,
  shade,
  INK_LINE,
} from './textureUtils.js';

// ---------------------------------------------------------------------------
// Paleta por variante de idade - abelhas jovens (recém-emergidas) são mais
// claras/menos melanizadas; abelhas mais velhas têm a cutícula mais escura
// (fato biológico real, confirmado nesta sessão de design).
// ---------------------------------------------------------------------------

const BEE_BASE_COLORS = {
  young: { body: '#7A5C3B', band: '#F2ECDC', legs: '#5A4530', eye: '#2E2216' },
  adult: { body: '#4A3826', band: '#E3DAC0', legs: '#2B2418', eye: '#1A1410' },
  old: { body: '#332617', band: '#C9A227', legs: '#1A1410', eye: '#100C08' },
};

function getBeeColors(colorVariant) {
  const base = BEE_BASE_COLORS[colorVariant] || BEE_BASE_COLORS.adult;
  return {
    body: base.body,
    bodyShadow: shade(base.body, -0.16),
    band: base.band,
    bandShadow: shade(base.band, -0.14),
    wing: 'rgba(240, 231, 205, 0.42)',
    wingVein: 'rgba(43, 36, 24, 0.3)',
    legs: base.legs,
    eye: base.eye,
  };
}

// ---------------------------------------------------------------------------
// Fábricas de pose
// ---------------------------------------------------------------------------

/**
 * Pose base "parada": abelha pousada, respiração sutil (abdômen pulsando
 * lentamente), asas dobradas sobre o corpo. Serve como pose de referência e
 * também como estado de repouso entre tarefas.
 */
export function createIdlePose(x, y, options = {}) {
  const { t = 0, colorVariant = 'adult', scale = 1, rotation = 0, seed = 1 } = options;
  return {
    x,
    y,
    rotation,
    scale,
    colorVariant,
    seed,
    wingAngle: 0.05 + Math.sin(t * 0.9) * 0.02,
    legPhase: t * 0.3,
    breathPhase: Math.sin(t * 1.6),
    headTilt: Math.sin(t * 0.5) * 0.04,
    abdomenTilt: 0,
    mouthOpen: 0,
    carrying: null,
    grounded: true,
    action: 'idle',
  };
}

/** Pose de voo: batida de asa rápida e ampla, pernas recolhidas, leve inclinação para cima. */
export function createFlightPose(x, y, t, options = {}) {
  const {
    colorVariant = 'adult',
    scale = 1,
    rotation = 0,
    seed = 1,
    flapSpeed = 26,
    flapAmount = 0.9,
  } = options;
  return {
    x,
    y,
    rotation,
    scale,
    colorVariant,
    seed,
    wingAngle: flapAmount * Math.sin(t * flapSpeed),
    legPhase: t * 2,
    breathPhase: Math.sin(t * 3) * 0.5,
    headTilt: -0.08,
    abdomenTilt: -0.05 + Math.sin(t * flapSpeed * 0.5) * 0.05,
    mouthOpen: 0,
    carrying: null,
    grounded: false,
    action: 'flight',
  };
}

/**
 * Pose "carregando": abdômen um pouco mais baixo (peso da carga), carga
 * (pólen/néctar) visível na perna traseira. Pode ser voando (padrão, volta
 * pra colmeia) ou no chão (grounded: true).
 */
export function createCarryingPose(x, y, t, options = {}) {
  const {
    colorVariant = 'adult',
    scale = 1,
    rotation = 0,
    seed = 1,
    cargo = 'pollen',
    amount = 1,
    grounded = false,
  } = options;
  const flap = grounded ? 0.15 + Math.sin(t * 10) * 0.05 : 0.55 * Math.sin(t * 18);
  return {
    x,
    y,
    rotation,
    scale,
    colorVariant,
    seed,
    wingAngle: flap,
    legPhase: t * (grounded ? 1.6 : 1.2),
    breathPhase: Math.sin(t * 2) * 0.4,
    headTilt: 0.05,
    abdomenTilt: 0.12,
    mouthOpen: 0,
    carrying: { type: cargo, amount },
    grounded,
    action: 'carrying',
  };
}

/**
 * Pose de regurgitação: cabeça baixa voltada para outra abelha/célula,
 * probóscide estendida (mouthOpen), leve pulsação do abdômen simulando o
 * gesto de "empurrar" o alimento para cima.
 */
export function createRegurgitatePose(x, y, t, options = {}) {
  const { colorVariant = 'adult', scale = 1, rotation = 0, seed = 1 } = options;
  const pulse = (Math.sin(t * 4) + 1) / 2;
  return {
    x,
    y,
    rotation,
    scale,
    colorVariant,
    seed,
    wingAngle: 0.05,
    legPhase: t * 0.4,
    breathPhase: pulse * 0.6,
    headTilt: 0.45 + pulse * 0.05,
    abdomenTilt: -0.06 - pulse * 0.05,
    mouthOpen: 0.4 + pulse * 0.6,
    carrying: null,
    grounded: true,
    action: 'regurgitate',
  };
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/**
 * Desenha o corpo completo da abelha a partir de uma pose. Pura: só lê
 * `pose`, nunca lê estado global. Campos esperados em pose (todos com
 * default razoável se ausentes): x, y, rotation, scale, colorVariant, seed,
 * wingAngle, legPhase, breathPhase, headTilt, abdomenTilt, mouthOpen,
 * carrying, grounded.
 */
export function drawBeeBody(ctx, pose) {
  const colors = getBeeColors(pose.colorVariant);
  const seed = pose.seed ?? 1;

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rotation || 0);
  const s = pose.scale || 1;
  ctx.scale(s, s);

  // VISTA DE CIMA (dorsal), coerente com o jogo top-down: eixo +x = frente
  // (cabeça), y = lateral. O corpo é simétrico em y, então:
  //  - pernas: 3 pares, UM de cada lado, saindo das laterais do tórax
  //    (desenhadas antes do corpo, que cobre os quadris);
  //  - corpo: cabeça, tórax e abdômen como UMA silhueta contínua (ver
  //    buildBodySilhouette) - três blobs com contorno próprio leriam como
  //    "conta de colar"/mascote, o que styleGuide.beeDesignNote proíbe;
  //  - asas: nascem do dorso do tórax e apontam para TRÁS, deitadas sobre o
  //    abdômen (translúcidas, desenhadas por cima do corpo); ao bater, abrem
  //    para os lados;
  //  - cabeça: dois olhos compostos nas laterais, antenas geniculadas
  //    espelhadas para a frente, probóscide para a frente.
  drawLegs(ctx, pose, colors, seed);
  drawBodySilhouette(ctx, pose, colors, seed);
  drawWingPair(ctx, pose, colors);
  drawHeadDetails(ctx, pose, colors, seed);

  ctx.restore();
}

function drawSingleWing(ctx, colors, length, width) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.5, -width * 1.4, length, -width * 0.2);
  ctx.quadraticCurveTo(length * 0.6, width * 0.6, 0, 0);
  ctx.closePath();
  ctx.fillStyle = colors.wing;
  ctx.fill();
  ctx.strokeStyle = colors.wingVein;
  ctx.lineWidth = 0.6;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.5, -width * 0.5, length * 0.85, -width * 0.1);
  ctx.moveTo(length * 0.2, -width * 0.15);
  ctx.lineTo(length * 0.55, width * 0.2);
  ctx.strokeStyle = colors.wingVein;
  ctx.lineWidth = 0.45;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Raiz das asas: dorso do tórax (BODY_PROFILE: tórax mais largo perto de x=3.5). */
const WING_ROOT = { fore: { x: 3.4, y: 2.2 }, hind: { x: 1.4, y: 2.4 } };

function drawWingPair(ctx, pose, colors) {
  // wingAngle ~0 = asas fechadas sobre o abdômen; |wingAngle| até ~1 = abertas
  // para os lados (batida). Com vista de cima, a batida aparece como abertura
  // lateral + leve encurtamento (asa inclinada em relação à câmera).
  const flap = Math.min(1, Math.abs(pose.wingAngle || 0));
  const spread = 0.12 + flap * 1.15;
  const foreshorten = 1 - flap * 0.22;

  [1, -1].forEach((side) => {
    // asa traseira (menor, por baixo)
    ctx.save();
    ctx.translate(WING_ROOT.hind.x, WING_ROOT.hind.y * side);
    ctx.rotate(Math.PI - side * (spread + 0.16));
    ctx.scale(foreshorten, side);
    drawSingleWing(ctx, colors, 10.5, 3.6);
    ctx.restore();

    // asa dianteira (maior, por cima), bordo de ataque para fora
    ctx.save();
    ctx.translate(WING_ROOT.fore.x, WING_ROOT.fore.y * side);
    ctx.rotate(Math.PI - side * spread);
    ctx.scale(foreshorten, side);
    drawSingleWing(ctx, colors, 16, 4.6);
    ctx.restore();
  });
}

// Quadris nas laterais do tórax (frente -> trás) e forma de cada perna em
// vista de cima: [joelho, pé] relativos ao quadril, para o lado +y.
const LEG_HIPS = [5.2, 3.2, 1.2];
const LEG_SHAPES = [
  { knee: { x: 3.2, y: 5.4 }, foot: { x: 7, y: 8.6 } }, // dianteira: para a frente
  { knee: { x: 0.4, y: 6.6 }, foot: { x: -1.6, y: 11 } }, // média: para o lado
  { knee: { x: -3.2, y: 6.2 }, foot: { x: -9, y: 9.6 } }, // traseira: para trás (corbícula)
];

function drawLegs(ctx, pose, colors, seed) {
  const grounded = pose.grounded !== false;
  [1, -1].forEach((side, si) => {
    LEG_SHAPES.forEach((shape, i) => {
      // Marcha em tripé: pernas 0 e 2 de um lado andam em fase com a 1 do outro.
      const phase = (pose.legPhase || 0) + (i % 2 === si ? 0 : Math.PI);
      const swing = grounded ? Math.sin(phase) * 1.9 : Math.sin(phase) * 0.4;
      const tuck = grounded ? 1 : 0.55; // em voo as pernas ficam recolhidas junto ao corpo
      const back = grounded ? 0 : 2.5;
      const hip = { x: LEG_HIPS[i], y: 3.4 * side };
      const knee = {
        x: hip.x + shape.knee.x * (grounded ? 1 : 0.7) + swing * 0.5 - back * 0.5,
        y: hip.y + shape.knee.y * tuck * side,
      };
      const foot = {
        x: hip.x + shape.foot.x * (grounded ? 1 : 0.6) + swing - back,
        y: hip.y + shape.foot.y * tuck * side,
      };
      strokeHandDrawn(ctx, [hip, knee, foot], {
        color: colors.legs,
        baseWidth: 1.1,
        widthJitter: 0.3,
        seed: seed + i + si * 7,
        opacity: 0.9,
      });

      if (i !== 2 || !pose.carrying) return;
      // Carga na tíbia traseira (entre joelho e pé), dos dois lados.
      const amount = pose.carrying.amount ?? 1;
      const cx = (knee.x + foot.x) / 2;
      const cy = (knee.y + foot.y) / 2;
      ctx.save();
      if (pose.carrying.type === 'pollen') {
        ctx.fillStyle = '#C9A227';
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 2.6 * amount, 1.9 * amount, 0.5 * side, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colors.bodyShadow;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
      } else if (pose.carrying.type === 'nectar') {
        ctx.fillStyle = 'rgba(245, 197, 66, 0.55)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 2 * amount, 2.2 * amount, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  });
}

// ---------------------------------------------------------------------------
// Silhueta do corpo - UM contorno contínuo cobrindo abdômen + tórax +
// cabeça, construído por uma função de "meia-largura" ao longo do eixo
// longitudinal. Isso é o que dá a leitura de inseto real (perfil único e
// fluido) em vez de três blobs com contorno cada um (que leria como
// "conta de colar"/mascote - ver aviso em styleGuide.beeDesignNote).
// x cresce para a frente (cabeça em +x, ponta do abdômen em -x).
// ---------------------------------------------------------------------------

const BODY_PROFILE = [
  { x: -19.5, r: 0.7 },
  { x: -16, r: 4.8 },
  { x: -11, r: 7.2 },
  { x: -7, r: 6.7 },
  { x: -3.5, r: 4.9 },
  { x: -1, r: 3.1 }, // cintura (propódeo) - moderada, Meliponini não é "cintura de vespa"
  { x: 1.5, r: 4.7 },
  { x: 3.5, r: 6.7 }, // tórax mais largo
  { x: 6, r: 5.5 },
  { x: 8, r: 3.4 }, // pescoço, mais estreito
  { x: 10.5, r: 4.6 }, // cabeça
  { x: 12.6, r: 3.4 },
  { x: 13.9, r: 1.1 }, // frente da cabeça arredondada, não em bico
];

function bodyHalfWidth(x) {
  if (x <= BODY_PROFILE[0].x) return BODY_PROFILE[0].r;
  for (let i = 0; i < BODY_PROFILE.length - 1; i++) {
    const a = BODY_PROFILE[i];
    const b = BODY_PROFILE[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.r + (b.r - a.r) * t;
    }
  }
  return BODY_PROFILE[BODY_PROFILE.length - 1].r;
}

/** Pivô aproximado onde o abdômen se articula com o tórax (propódeo). */
const ABDOMEN_PIVOT_X = -1;

function buildBodyOutline(pose, seed) {
  const rng = seededRandom(seed);
  const breathPhase = pose.breathPhase || 0;
  const abdomenTilt = pose.abdomenTilt || 0;
  const top = [];
  const bottom = [];
  BODY_PROFILE.forEach(({ x, r }) => {
    let rr = r;
    let yOff = 0;
    if (x < ABDOMEN_PIVOT_X) {
      // Respiração: pulso sutil só no abdômen (é lá que insetos "respiram"
      // visivelmente). Abdomen tilt: aproximação de pequena rotação em
      // torno do pivô, só deslocando y (ângulos usados aqui são pequenos).
      rr *= 1 + breathPhase * 0.05;
      yOff = (x - ABDOMEN_PIVOT_X) * Math.sin(abdomenTilt);
    }
    const jr = rr * (1 + (rng() - 0.5) * 0.05);
    top.push({ x, y: -jr + yOff });
    bottom.push({ x, y: jr + yOff });
  });
  return top.concat(bottom.reverse());
}

function drawAbdomenBands(ctx, colors) {
  // Faixas como "anéis" que envolvem o abdômen que afunila - topo/base quase
  // retos (acompanhando a borda do corpo naquele x), só com as pontas
  // arredondadas, para ler como tergito/banda e não como uma folha/gota.
  const bandXs = [-4.5, -8, -11.5, -14.5];
  const halfW = 0.95;
  bandXs.forEach((bx, i) => {
    const r = bodyHalfWidth(bx) * 0.92;
    const capInset = Math.min(r * 0.5, 0.7);
    ctx.beginPath();
    ctx.moveTo(bx - halfW, -r + capInset);
    ctx.quadraticCurveTo(bx - halfW, -r, bx, -r);
    ctx.quadraticCurveTo(bx + halfW, -r, bx + halfW, -r + capInset);
    ctx.lineTo(bx + halfW, r - capInset);
    ctx.quadraticCurveTo(bx + halfW, r, bx, r);
    ctx.quadraticCurveTo(bx - halfW, r, bx - halfW, r - capInset);
    ctx.closePath();
    ctx.fillStyle = colors.band;
    ctx.globalAlpha = 0.55 - i * 0.02;
    ctx.fill();
    ctx.strokeStyle = colors.bandShadow;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 0.35;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

/** Vincas discretas (não círculos fechados) sugerindo as junções entre
 * segmentos, sem desenhar um contorno completo por segmento. */
function drawSegmentCreases(ctx, colors) {
  [-1, 8].forEach((cx) => {
    const r = bodyHalfWidth(cx) * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx, -r);
    ctx.quadraticCurveTo(cx + 0.7, 0, cx, r);
    ctx.strokeStyle = colors.bodyShadow;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function drawBodySilhouette(ctx, pose, colors, seed) {
  const outline = buildBodyOutline(pose, seed);

  ctx.beginPath();
  tracePath(ctx, outline, { closed: true, smooth: true });
  ctx.fillStyle = colors.body;
  ctx.fill();

  ctx.save();
  ctx.clip();
  drawAbdomenBands(ctx, colors);
  drawSegmentCreases(ctx, colors);
  drawHatching(ctx, { x: -20, y: -8, width: 36, height: 16 }, {
    angle: 0.15,
    lineCount: 34,
    color: colors.bodyShadow,
    opacityRange: [0.1, 0.2],
    seed: seed + 10,
    curveAmount: 2,
  });
  drawStipple(ctx, { x: -19.5, y: -7.6, width: 12, height: 15.2 }, {
    color: colors.bodyShadow,
    count: 60,
    seed: seed + 11,
    radius: [0.3, 0.8],
    opacity: [0.06, 0.16],
    densityBias: (u) => 1 - u,
  });
  // Sombra suave de contato sob o tórax/cabeça (embaixo = valores maiores de y).
  drawStipple(ctx, { x: -2, y: 1, width: 16, height: 5 }, {
    color: colors.bodyShadow,
    count: 30,
    seed: seed + 13,
    radius: [0.3, 0.7],
    opacity: [0.06, 0.14],
  });
  ctx.restore();

  strokeHandDrawn(ctx, outline, {
    color: INK_LINE,
    baseWidth: 1.3,
    widthJitter: 0.35,
    closed: true,
    seed: seed + 12,
    opacity: 0.85,
  });
}

const HEAD_CENTER = { x: 10.6, y: 0 };

function drawHeadDetails(ctx, pose, colors, seed) {
  ctx.save();
  ctx.translate(HEAD_CENTER.x, HEAD_CENTER.y);
  // Em vista de cima, headTilt vira uma leve guinada lateral da cabeça.
  ctx.rotate((pose.headTilt || 0) * 0.5);

  [1, -1].forEach((side, si) => {
    // Antenas geniculadas (cotovelo característico de himenópteros) - curtas
    // e discretas, espelhadas para a frente.
    strokeHandDrawn(ctx, [
      { x: 2.4, y: 1.2 * side },
      { x: 5.6, y: 3.6 * side },
      { x: 9, y: 2.6 * side },
    ], {
      color: colors.legs,
      baseWidth: 0.9,
      widthJitter: 0.2,
      seed: seed + 30 + si,
      opacity: 0.9,
    });

    // Olho composto nas laterais da cabeça - proporcional (nunca gigante).
    ctx.beginPath();
    ctx.ellipse(0.6, 3 * side, 2.1, 1.35, 0.25 * side, 0, Math.PI * 2);
    ctx.fillStyle = colors.eye;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.ellipse(0.1, 2.7 * side, 0.5, 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 232, 214, 0.5)';
    ctx.fill();
  });

  // Probóscide - só aparece/estende quando mouthOpen > 0, para a frente.
  const mouthOpen = pose.mouthOpen || 0;
  if (mouthOpen > 0.02) {
    strokeHandDrawn(ctx, [
      { x: 3, y: 0 },
      { x: 3.2 + 5 * mouthOpen, y: 0.2 },
    ], {
      color: colors.legs,
      baseWidth: 0.8,
      widthJitter: 0.15,
      seed: seed + 35,
      opacity: 0.9,
    });
  }

  ctx.restore();
}
