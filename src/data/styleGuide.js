// Guia de estilo visual — extraído por análise de 8 frames de
// C:\Users\lenovo\Videos\Screen Recordings\Borboleta.mp4 (referência do usuário:
// vídeo do ciclo de vida de uma borboleta monarca, feito anteriormente pelo Claude).
//
// Descoberta importante: a referência NÃO é um mascote "fofo" de cartoon simples.
// É uma ilustração naturalista elegante (estilo caderno de campo científico /
// field journal) com hachura desenhada à mão, textura de papel, e uma segunda
// camada de "instrumento técnico" (réguas, transferidores, arcos de medição)
// sobreposta à ilustração. Todo o desenho em src/art/ deve mirar essa sensação:
// preciso, orgânico, com peso de mão-desenhada — não geometria plana/vetor liso.
//
// Todos os valores abaixo são estimativas visuais a partir dos frames (não
// amostragem exata de pixel) — suficientes para grounding consistente entre
// agentes, ajustáveis durante implementação.

export const styleGuide = {
  // Dois "modos" de paleta observados no vídeo de referência.
  palettes: {
    // Modo "naturalista" — usar para TODO o Marco 1 (interior da colmeia,
    // larvas, rainha, criaturas). É o modo padrão do jogo.
    naturalist: {
      paperCreamLight: '#EFE8D6',
      paperCreamDark: '#E3DAC0', // as duas formam o padrão de faixas diagonais do "papel" de fundo
      leafSage: '#8FA888',
      leafSageShadow: '#6E8566',
      leafSageHighlight: '#B8CBA8',
      inkLine: '#2B2418', // linhas de contorno — nunca preto puro, marrom-escuro quente
      caterpillarBlack: '#1A1A1A',
      caterpillarGold: '#C9A227',
      caterpillarCream: '#F0EAD8',
      chrysalisJade: '#6FAE8C',
      chrysalisGold: '#C9A227',
      sunGold: '#F5C542',
      sunHalo: '#F7DFA0',
      mapTeal: '#7FA895',
      accentPink: '#E8447A', // usar RARAMENTE — 1 elemento de destaque por cena, nunca como cor de preenchimento
    },
    // Modo "instrumento/blueprint" — reservado para a visão ultravioleta do
    // Marco 2 (fora da colmeia). Documentado agora para não perder a referência,
    // NÃO usar no Marco 1.
    instrumentUV: {
      navyBg: '#0B0E2E',
      wireGlow: '#D8E4F5',
      wireGlowDim: '#8FA0C4',
      accentPink: '#EE5586',
    },
  },

  // Como desenhar contorno e preenchimento em src/art/*.js
  linework: {
    strokeWeight: '1.5–2.5px em resolução base (escalar com DPI no Renderer), nunca uniforme demais — variar levemente a espessura ao longo do path para simular traço de mão',
    strokeColor: 'inkLine (marrom-escuro quente), nunca #000 puro',
    cornerStyle: 'orgânico, levemente irregular — evitar curvas bezier perfeitamente simétricas; pequenas variações de raio dão sensação de mão-desenhada',
  },

  // Técnica procedural para simular a hachura/textura de papel do vídeo,
  // sem usar nenhuma imagem externa (mantém a decisão de 100% Canvas procedural).
  proceduralTexture: {
    hatching: 'para superfícies como folhas e crisálida: desenhar dezenas de linhas curvas finas e paralelas seguindo o contorno da forma (não retas), opacidade baixa (0.15–0.3), leve jitter de ângulo/espaçamento por linha para não parecer um padrão repetido perfeito',
    stipple: 'para sombra suave/profundidade: campo de pontos pequenos com opacidade e densidade variável (mais denso nas áreas de sombra), posições com ruído pseudo-aleatório (seed fixa por entidade para não "piscar" entre frames)',
    paperGrain: 'fundo: duas cores de creme (paperCreamLight/Dark) em faixas diagonais largas (~40-60px, leve variação), sobrepostas com um campo de ruído de opacidade muito baixa (0.03–0.06) para textura de papel — tudo desenhado via canvas paths/imageData, sem PNG externo',
  },

  // Luz e atmosfera
  lighting: {
    keyLight: 'dourado quente (sunGold/sunHalo), como luz de fim de tarde — usar gradientes radiais suaves para glow, nunca sombra dura preta',
    dayNightNote: 'o ciclo dia/noite do TimeSystem deve migrar a paleta naturalista inteira (não trocar de paleta abruptamente): dia = tons quentes plenos; noite = mesma paleta com saturação reduzida e um leve viés azulado, preservando o "papel" de fundo',
  },

  // Motivo de "instrumento técnico" sobreposto — assinatura visual forte do
  // vídeo de referência (réguas, transferidores, arcos de medição, marcas de
  // escala) desenhado por cima da ilustração, geralmente ANIMANDO como se
  // estivesse "explicando"/"medindo" a cena em tempo real.
  technicalOverlayMotif: {
    what: 'círculos concêntricos finos, arcos com marcas de escala tipo transferidor, linhas pontilhadas de guia, pequenos ícones circulares (diagramas-mini)',
    usage: 'reaproveitar esse motivo na UI do jogo (HUD.js, IndicatorBar.js) em vez de barras de progresso genéricas — indicadores da colônia podem ser arcos/mostradores finos no mesmo estilo, reforçando a identidade visual em vez de UI de jogo genérica',
    animationFeel: 'os elementos técnicos se desenham progressivamente (stroke-dasharray-like reveal) e usam UM único acento vívido (accentPink) para a linha/seta mais importante da cena — todo o resto fica nos tons muted da paleta',
  },

  // Sensação de animação/movimento geral (para engine/tween.js)
  motion: {
    easing: 'preferir ease-in-out suaves e lentos para elementos "explicativos" (overlay técnico), e curvas mais orgânicas tipo squash-and-stretch leve para seres vivos (respiração, asas, pernas) — nunca linear, nunca robótico',
    pace: 'deliberado, quase contemplativo — o vídeo de referência não tem pressa; mesmo em tarefas de tensão/reflexo (Limpeza, Defesa), a ARTE de fundo e ambiente deve manter esse ritmo calmo, só os elementos de desafio (criaturas, gauges) devem ter urgência visual',
  },

  // Nota para src/art/bee.js especificamente
  beeDesignNote:
    'A Mandaçaia deve ser desenhada como ilustração naturalista elegante e anatomicamente plausível (proporções próximas do inseto real: cabeça, tórax, abdômen distintos, asas translúcidas com nervura fina), com charme vindo da animação fluida e da textura/hachura — não de proporções exageradas tipo mascote (nada de cabeça gigante/olhos enormes estilo cartoon infantil). O "charme" é o mesmo da lagarta/crisálida de referência: presença física real, desenhada com carinho.',

  // Nota para o futuro Marco 2 (visão ultravioleta) — não implementar agora
  futureUVVisionNote:
    'O modo "instrumento/blueprint" (palettes.instrumentUV) observado no vídeo de referência é a base visual natural para a visão ultravioleta estilizada do Marco 2: fundo azul-marinho, linhas brilhantes tipo wireframe, motivo de instrumento de navegação/medição — encaixa tematicamente com abelhas usando luz UV/polarizada para navegar.',
};

export default styleGuide;
