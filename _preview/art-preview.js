// Harness de verificação visual, independente do build do jogo (Vite não
// processa esta pasta). Importa diretamente as funções puras de src/art/*.js
// e desenha uma "folha de contato" com todas as poses/estados relevantes,
// para conferência visual contra src/data/styleGuide.js.
//
// Servir via HTTP a partir da raiz do projeto (ex.: `npx vite` ou qualquer
// servidor estático) — imports ES module não funcionam em file:// no Chrome.

import { styleGuide } from '../src/data/styleGuide.js';
import {
  drawBeeBody,
  createIdlePose,
  createFlightPose,
  createCarryingPose,
  createRegurgitatePose,
} from '../src/art/bee.js';
import {
  drawHiveInterior,
  drawCell,
  drawComb,
  drawQueenChamber,
} from '../src/art/hive.js';
import { drawBackground, drawLightOverlay } from '../src/art/environment.js';
import {
  drawAnt,
  drawPhoridFly,
  drawWaxMothLarva,
  createAntPose,
  createPhoridFlyPose,
  createWaxMothLarvaPose,
} from '../src/art/creatures.js';

const naturalist = styleGuide.palettes.naturalist;

// Tenta carregar engine/tween.js (escrito em paralelo por outro agente) só
// para demonstrar o contrato de interpolação entre poses nomeadas — se
// ainda não existir/estiver incompleto, o painel correspondente mostra o
// erro sem derrubar o resto da folha de contato.
let tweenApi = null;
try {
  tweenApi = await import('../src/engine/tween.js');
} catch (err) {
  console.warn('[art-preview] engine/tween.js indisponível ainda:', err);
}

const sections = [];
let currentSection = null;

function section(title) {
  currentSection = { title, panels: [] };
  sections.push(currentSection);
}

function panel({ id, title, width = 220, height = 180, draw }) {
  currentSection.panels.push({
    id, title, width, height, draw, canvas: null, ctx: null, errored: false,
  });
}

// ---------------------------------------------------------------------------
// Abelha — poses nomeadas
// ---------------------------------------------------------------------------
section('Abelha — poses nomeadas (bee.js)');
panel({
  id: 'bee-idle',
  title: 'idle — respiração sutil',
  draw: (ctx, t) => drawBeeBody(ctx, createIdlePose(110, 110, { t, scale: 2.6 })),
});
panel({
  id: 'bee-flight',
  title: 'voo — batida de asa',
  draw: (ctx, t) => drawBeeBody(ctx, createFlightPose(110, 110, t, { scale: 2.6 })),
});
panel({
  id: 'bee-carrying-pollen',
  title: 'carregando pólen (voando)',
  draw: (ctx, t) => drawBeeBody(ctx, createCarryingPose(110, 110, t, { scale: 2.6, cargo: 'pollen' })),
});
panel({
  id: 'bee-carrying-nectar',
  title: 'carregando néctar (pousada)',
  draw: (ctx, t) => drawBeeBody(ctx, createCarryingPose(110, 110, t, { scale: 2.6, cargo: 'nectar', grounded: true })),
});
panel({
  id: 'bee-regurgitate',
  title: 'regurgitação — alimentando',
  draw: (ctx, t) => drawBeeBody(ctx, createRegurgitatePose(110, 110, t, { scale: 2.6 })),
});
panel({
  id: 'bee-interpolated',
  title: 'interpolação idle ↔ voo (via engine/tween.js#interpolatePose)',
  draw: (ctx, t) => {
    const a = createIdlePose(110, 110, { t, scale: 2.6 });
    const b = createFlightPose(110, 110, t, { scale: 2.6 });
    const blend = (Math.sin(t * 1.1) + 1) / 2;
    let pose = blend > 0.5 ? b : a;
    if (tweenApi && typeof tweenApi.interpolatePose === 'function') {
      pose = tweenApi.interpolatePose(a, b, blend);
    }
    drawBeeBody(ctx, pose);
  },
});

// ---------------------------------------------------------------------------
// Abelha — variantes de idade (colorVariant)
// ---------------------------------------------------------------------------
section('Abelha — colorVariant por idade (jovem mais clara, velha mais escura)');
['young', 'adult', 'old'].forEach((variant) => {
  panel({
    id: `bee-variant-${variant}`,
    title: `colorVariant: "${variant}"`,
    draw: (ctx, t) => drawBeeBody(ctx, createIdlePose(110, 110, { t, scale: 2.8, colorVariant: variant })),
  });
});

// ---------------------------------------------------------------------------
// Colmeia
// ---------------------------------------------------------------------------
section('Colmeia (hive.js)');
panel({
  id: 'hive-interior',
  title: 'drawHiveInterior — favo orgânico + câmara real',
  width: 480,
  height: 340,
  draw: (ctx) => {
    drawHiveInterior(ctx, {
      width: 480,
      height: 340,
      backgroundSeed: 5,
      combs: [
        {
          x: 30,
          y: 40,
          cols: 7,
          rows: 5,
          cellSize: 15,
          seed: 11,
          getState: (col, row) => {
            const states = ['empty', 'egg', 'larva', 'capped', 'honey', 'pollen'];
            return states[(col * 3 + row * 2) % states.length];
          },
        },
      ],
      queenChamber: { x: 380, y: 250, width: 90, height: 55, seed: 21 },
    });
  },
});
panel({
  id: 'hive-cell-states',
  title: 'drawCell — todos os estados (empty, egg, larva, capped, honey, pollen)',
  width: 280,
  height: 100,
  draw: (ctx) => {
    const states = ['empty', 'egg', 'larva', 'capped', 'honey', 'pollen'];
    states.forEach((state, i) => {
      drawCell(ctx, { x: 25 + i * 44, y: 50, size: 18, rotation: 0, seed: 30 + i }, state);
    });
  },
});
panel({
  id: 'hive-comb-only',
  title: 'drawComb isolado — repare no jitter orgânico (não é grid perfeito)',
  width: 280,
  height: 200,
  draw: (ctx) => {
    drawComb(ctx, {
      x: 15, y: 15, cols: 5, rows: 5, cellSize: 17, seed: 77,
      getState: (c, r) => (['empty', 'larva', 'capped', 'honey'][(c + r) % 4]),
    });
  },
});
panel({
  id: 'hive-queen-chamber',
  title: 'drawQueenChamber isolado',
  width: 220,
  height: 160,
  draw: (ctx) => {
    drawQueenChamber(ctx, { x: 110, y: 80, width: 90, height: 55, seed: 21 });
  },
});

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------
section('Ambiente (environment.js) — mesma paleta, dia → noite sem troca abrupta');
[['day', 'dia'], ['morning', 'manhã'], ['dusk', 'entardecer'], ['night', 'noite']].forEach(([tod, label]) => {
  panel({
    id: `env-${tod}`,
    title: `drawBackground + drawLightOverlay — ${label}`,
    width: 240,
    height: 170,
    draw: (ctx) => {
      drawBackground(ctx, tod, { width: 240, height: 170, seed: 1 });
      drawLightOverlay(ctx, tod, { width: 240, height: 170 });
    },
  });
});

// ---------------------------------------------------------------------------
// Criaturas
// ---------------------------------------------------------------------------
section('Criaturas (creatures.js) — silhuetas devem ser reconhecíveis à distância');
panel({
  id: 'creature-ant',
  title: 'drawAnt — formiga invasora (rígida, sem asas, cintura marcada)',
  draw: (ctx, t) => drawAnt(ctx, createAntPose(110, 110, t, { scale: 3.4 })),
});
panel({
  id: 'creature-fly',
  title: 'drawPhoridFly — mosca parasita (corcunda, 1 par de asas)',
  draw: (ctx, t) => drawPhoridFly(ctx, createPhoridFlyPose(110, 110, t, { scale: 5 })),
});
panel({
  id: 'creature-larva',
  title: 'drawWaxMothLarva — larva da traça-de-cera (mole, sem pernas)',
  draw: (ctx, t) => drawWaxMothLarva(ctx, createWaxMothLarvaPose(110, 110, t, { scale: 3 })),
});
panel({
  id: 'creature-comparison',
  title: 'lado a lado — leitura rápida de silhueta (e a abelha, para comparar)',
  width: 360,
  height: 150,
  draw: (ctx, t) => {
    drawAnt(ctx, createAntPose(50, 105, t, { scale: 2.6 }));
    drawPhoridFly(ctx, createPhoridFlyPose(150, 60, t, { scale: 3.8 }));
    drawWaxMothLarva(ctx, createWaxMothLarvaPose(240, 105, t, { scale: 2.2 }));
    drawBeeBody(ctx, createIdlePose(320, 90, { t, scale: 2.2 }));
  },
});

// ---------------------------------------------------------------------------
// Monta a página e roda o loop de animação
// ---------------------------------------------------------------------------
const gallery = document.getElementById('gallery');
const statusEl = document.getElementById('status');
const allPanels = [];

sections.forEach((sec) => {
  const h2 = document.createElement('h2');
  h2.textContent = sec.title;
  gallery.appendChild(h2);

  const row = document.createElement('div');
  row.className = 'row';
  gallery.appendChild(row);

  sec.panels.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'card';
    const canvas = document.createElement('canvas');
    canvas.width = p.width;
    canvas.height = p.height;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${p.title} (${p.id})`;
    const errorBox = document.createElement('div');
    errorBox.className = 'error';
    card.appendChild(canvas);
    card.appendChild(label);
    card.appendChild(errorBox);
    row.appendChild(card);

    p.canvas = canvas;
    p.ctx = canvas.getContext('2d');
    p.errorBox = errorBox;
    allPanels.push(p);
  });
});

let totalErrors = 0;

function frame(now) {
  const t = now / 1000;
  totalErrors = 0;
  allPanels.forEach((p) => {
    const { ctx, canvas } = p;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = naturalist.paperCreamLight;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      p.draw(ctx, t);
      if (p.errored) {
        p.errored = false;
        p.errorBox.textContent = '';
      }
    } catch (err) {
      totalErrors++;
      if (!p.errored) {
        p.errored = true;
        console.error(`[art-preview] erro em "${p.title}" (${p.id}):`, err);
      }
      p.errorBox.textContent = `Erro: ${err.message}`;
      ctx.fillStyle = '#E8447A';
      ctx.font = '11px monospace';
      ctx.fillText('ERRO — ver console', 8, canvas.height - 8);
    }
  });
  statusEl.textContent = totalErrors === 0
    ? `${allPanels.length} painéis renderizando sem erros — tween.js: ${tweenApi ? 'carregado' : 'indisponível (ok, só afeta o painel de interpolação)'}`
    : `${totalErrors} painel(is) com erro — ver caixas vermelhas abaixo e o console`;
  statusEl.classList.toggle('has-errors', totalErrors > 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
