# Vida de Abelha

Jogo em Canvas 2D sobre a vida de uma operária de Mandaçaia. A arte é procedural.

## Jogar localmente

Execute `npm run dev` e abra o endereço indicado pelo Vite.
Se o comando npm da máquina estiver quebrado, use `node node_modules/vite/bin/vite.js`.

Teclado: WASD ou setas para movimento, Espaço para ação, E/Shift para especial.
Na rainha, as setas executam o combo; WASD continua movendo a abelha.
No celular, use arraste e os controles na tela. A limpeza mantém a dica textual.

## Regras atuais

- Quatro fases: limpeza, alimentar larvas, alimentar rainha, defesa.
- Cada fase tem exatamente três turnos de 42 segundos, seguidos de uma breve transição.
- A dificuldade começa em 0,57 em cada fase e aumenta nos turnos seguintes.
- A pontuação afeta a colônia, mas não antecipa nem atrasa a promoção.
- O nascimento é uma animação de abertura, não uma quinta fase com turnos.
- Abertura em vídeo: `public/video/intro.mp4` (vertical 720×1280, com som; poster `public/video/intro-poster.jpg`). Toca após "Toque/Clique para começar" só na primeira visita (flag `vida-de-abelha.intro-seen.v1` no localStorage); "Ver abertura" no menu reabre. Sem o arquivo, o jogo abre direto no menu.
- A rainha oferece janelas de alimentação mais frequentes; o especial foi preservado.
- Salvamento local automático ao nascer e ao concluir cada turno. Recarregar durante um turno retoma o último ponto salvo, sem contabilizar o turno incompleto.

## Verificação

- `npm test` ou `node --test tests/*.test.js`: progressão, dificuldade, retomada e persistência.
- `npm run build` ou `node node_modules/vite/bin/vite.js build`: pacote de produção.
- `/_preview/state.html?state=feedQueen`: teste isolado de uma fase. Outras opções: `cleaning`, `feedLarvae`, `guard`.

## Ondas de desenvolvimento

O repositório recebido não contém o plano original completo das ondas 3 e 4.

- Onda 2: telas, arte, controles e quatro tarefas existentes, com os ajustes pedidos aplicados.
- Onda 3: integração em `src/main.js`, fluxo completo, progressão fixa, salvamento, atualização dos controles a cada frame e pausa ao ocultar a aba. Implementação inicial presente; a avaliação humana do equilíbrio e do toque real continua necessária.
- Onda 4 (proposta, não confirmação do plano original): polimento, testes em aparelhos reais, ajustes de equilíbrio após jogar e preparação de publicação. Sem publicação realizada.

O encerramento atual é o fim do Marco 1. A referência ao mundo ultravioleta é uma promessa de continuação, não uma fase externa já implementada.
