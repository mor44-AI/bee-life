// TimeSystem — passagem do tempo e ciclo dia/noite do jogo (lógica pura).
//
// API pública:
//   new TimeSystem(maxDays = config.days.defaultMaxDays)
//     currentDay: number — começa em 1.
//     maxDays: number — duração da vida jogável (45–60, ver data/config.js).
//     isNight: boolean — começa false (dia).
//   advanceDay(): void
//     Decisão de design (documentada aqui conforme pedido): cada CHAMADA
//     alterna a fase dia/noite; `currentDay` só avança na transição
//     noite -> dia (o "amanhecer"), que é o momento em que um dia-jogável
//     se fecha de fato. Ou seja, um ciclo completo de 1 dia-jogável = 2
//     chamadas de advanceDay():
//       1ª chamada (dia -> noite): fecha as tarefas do dia, isNight vira true.
//          É o ponto natural para o chamador disparar ColonyState.tickDecay
//          (decaimento noturno) antes da 2ª chamada.
//       2ª chamada (noite -> dia): isNight volta a false E currentDay += 1,
//          abrindo o próximo dia-jogável.
//     Essa divisão evita um "advance" monolítico que misturaria o fim do
//     turno de tarefas com o tick de decaimento da colônia — cada sistema
//     (TaskSystem, ColonyState, TimeSystem) fica desacoplado do outro.
//   isLifeOver(): boolean — true quando currentDay > maxDays.
//   serialize(): object — objeto plano serializável.
//   static deserialize(data): TimeSystem — reconstrói a partir do salvo.

import { config } from '../data/config.js';

export default class TimeSystem {
  constructor(maxDays = config.days.defaultMaxDays) {
    this.currentDay = 1;
    this.maxDays = maxDays;
    this.isNight = false;
  }

  advanceDay() {
    if (!this.isNight) {
      // Anoitece: o dia-jogável atual termina.
      this.isNight = true;
    } else {
      // Amanhece: começa o próximo dia-jogável.
      this.isNight = false;
      this.currentDay += 1;
    }
  }

  isLifeOver() {
    return this.currentDay > this.maxDays;
  }

  serialize() {
    return {
      currentDay: this.currentDay,
      maxDays: this.maxDays,
      isNight: this.isNight,
    };
  }

  static deserialize(data = {}) {
    const time = new TimeSystem(
      Number.isFinite(data.maxDays) ? data.maxDays : config.days.defaultMaxDays
    );
    time.currentDay = Number.isFinite(data.currentDay) ? data.currentDay : 1;
    time.isNight = Boolean(data.isNight);
    return time;
  }
}
