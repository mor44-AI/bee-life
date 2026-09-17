// ColonyState — estado dos indicadores da colônia (lógica pura, sem I/O).
//
// API pública:
//   new ColonyState(overrides?)
//     Campos (todos number, clampados 0–100): population, nectar, pollen,
//     propolis, wax, health. `overrides` é um objeto parcial opcional com
//     qualquer um desses campos (usado também por deserialize).
//   applyTaskResult(taskType, score): void
//     Aplica o resultado de UM turno jogado. `taskType` é um dos ranks de
//     TaskSystem ('larva' | 'cleaning' | 'feedLarvae' | 'feedQueen' | 'guard');
//     `score` é a pontuação do turno em escala 0–100 (50 = neutro). Cada tipo
//     de tarefa afeta indicadores diferentes — ver regras comentadas abaixo.
//   tickDecay(dt = 1): void
//     Decaimento/recuperação gradual em background (ex.: 1x por dia-jogável,
//     dt = número de dias). Néctar/pólen/cera/própolis caem lentamente com o
//     tempo (taxas em data/config.js); saúde reage à fartura de recursos; e
//     população cresce devagar se a colônia estiver saudável, ou declina se
//     a saúde estiver crítica.
//   serialize(): object — objeto plano serializável (JSON-safe).
//   static deserialize(data): ColonyState — reconstrói uma instância a partir
//     do objeto salvo (campos ausentes caem nos defaults do construtor).

import { config } from '../data/config.js';

const clamp = (value, min = 0, max = 100) => {
  const n = Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, n));
};

export default class ColonyState {
  constructor({
    population = 50,
    nectar = 60,
    pollen = 60,
    propolis = 40,
    wax = 50,
    health = 70,
  } = {}) {
    this.population = clamp(population);
    this.nectar = clamp(nectar);
    this.pollen = clamp(pollen);
    this.propolis = clamp(propolis);
    this.wax = clamp(wax);
    this.health = clamp(health);

    // Buffer transitório criado por turnos de 'guard' bem-sucedidos: absorve
    // parte do decaimento de néctar/pólen no próximo tickDecay (representa a
    // colônia protegida de saques/invasores). Não faz parte do contrato
    // público de campos, mas é serializado para não se perder ao salvar.
    this._guardShield = 0;
  }

  applyTaskResult(taskType, score) {
    const s = clamp(score, 0, 100);
    // perf: -1 (pior turno possível) .. 0 (neutro, score=50) .. +1 (turno perfeito)
    const perf = (s - 50) / 50;

    switch (taskType) {
      case 'cleaning':
        // Limpeza afeta principalmente saúde (higiene reduz doença/mofo) e a
        // manutenção da cera dos favos; um pouco de própolis (usada como
        // selante antimicrobiano durante a limpeza).
        this.health = clamp(this.health + perf * 12);
        this.wax = clamp(this.wax + perf * 8);
        this.propolis = clamp(this.propolis + perf * 4);
        break;

      case 'feedLarvae':
        // Alimentar larvas afeta a população futura (cria que sobrevive até
        // a fase adulta) e consome pólen — bom desempenho desperdiça menos.
        this.population = clamp(this.population + perf * 10);
        this.pollen = clamp(this.pollen - (6 - perf * 4));
        break;

      case 'feedQueen':
        // Alimentar a rainha sustenta a postura de ovos (população) e
        // consome néctar (base do alimento glandular oferecido à rainha).
        this.population = clamp(this.population + perf * 14);
        this.nectar = clamp(this.nectar - (6 - perf * 4));
        break;

      case 'guard':
        // Defesa protege a saúde geral e reforça a entrada com própolis;
        // um bom turno também acumula um escudo que amortece o decaimento
        // de recursos no próximo tickDecay (menos perdas por saque/invasão).
        this.health = clamp(this.health + perf * 6);
        this.propolis = clamp(this.propolis + perf * 6);
        this._guardShield = clamp(this._guardShield + Math.max(perf, 0) * 10, 0, 30);
        break;

      case 'larva':
      default:
        // Fase larval / tipo desconhecido: efeito leve só em saúde, para não
        // travar o jogo caso outro rank apareça no futuro.
        this.health = clamp(this.health + perf * 5);
        break;
    }
  }

  tickDecay(dt = 1) {
    const rates = config.colonyDecay;

    let nectarLoss = rates.nectarPerDay * dt;
    let pollenLoss = rates.pollenPerDay * dt;

    // O escudo de guarda amortece a perda de néctar/pólen antes de qualquer
    // outra coisa, e é consumido no processo.
    if (this._guardShield > 0) {
      const totalLoss = nectarLoss + pollenLoss;
      const mitigated = Math.min(this._guardShield, totalLoss);
      this._guardShield = clamp(this._guardShield - mitigated, 0, 30);
      if (totalLoss > 0) {
        const ratio = 1 - mitigated / totalLoss;
        nectarLoss *= ratio;
        pollenLoss *= ratio;
      }
    }

    this.nectar = clamp(this.nectar - nectarLoss);
    this.pollen = clamp(this.pollen - pollenLoss);
    this.wax = clamp(this.wax - rates.waxPerDay * dt);
    this.propolis = clamp(this.propolis - rates.propolisPerDay * dt);

    // Saúde reage à fartura (ou escassez) de estoques.
    const resourcesHealthy = this.nectar > 40 && this.pollen > 40;
    this.health = clamp(
      this.health + (resourcesHealthy ? rates.healthRecovery : -rates.healthPenalty) * dt
    );

    // População cresce devagar se a colônia estiver saudável e bem suprida;
    // declina se a saúde estiver crítica.
    if (this.health > 60 && this.nectar > 30 && this.pollen > 30) {
      this.population = clamp(this.population + rates.populationGrowth * dt);
    } else if (this.health < 30) {
      this.population = clamp(this.population - rates.populationDecline * dt);
    }
  }

  serialize() {
    return {
      population: this.population,
      nectar: this.nectar,
      pollen: this.pollen,
      propolis: this.propolis,
      wax: this.wax,
      health: this.health,
      guardShield: this._guardShield,
    };
  }

  static deserialize(data = {}) {
    const colony = new ColonyState(data);
    colony._guardShield = clamp(data.guardShield ?? 0, 0, 30);
    return colony;
  }
}
