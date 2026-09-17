// SaveSystem — persistência simples em localStorage, 1 slot fixo (lógica pura
// de fachada; sem estado de instância — todos os métodos são estáticos).
//
// Formato esperado do `state` salvo (definido pelo chamador, não validado
// estruturalmente aqui): { rank, day, colony, history }
//   rank: string (TaskSystem.currentRank)
//   day: number (TimeSystem.currentDay)
//   colony: object (resultado de ColonyState.serialize())
//   history: array | object (histórico de pontuações passadas, livre)
//
// API pública:
//   SaveSystem.SAVE_KEY: string — chave fixa usada no localStorage.
//   SaveSystem.save(state: object): boolean
//     Serializa `state` com JSON.stringify e grava em localStorage sob
//     SAVE_KEY. Retorna true em sucesso; false se localStorage não estiver
//     disponível (ex.: ambiente Node/teste) ou se o write falhar (quota
//     excedida, modo privado restrito, etc.).
//   SaveSystem.load(): object | null
//     Lê o slot salvo e faz JSON.parse. Retorna null se não existir nada
//     salvo, se localStorage não estiver disponível, ou se o conteúdo
//     estiver corrompido (JSON.parse é protegido por try/catch).
//   SaveSystem.clear(): void
//     Remove o slot salvo. No-op silencioso se localStorage não existir.

const SAVE_KEY = 'vida-de-abelha-save';

function getStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      return localStorage;
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_err) {
    // Acessar localStorage pode lançar em alguns ambientes restritos
    // (ex. modo privado de certos navegadores, sandboxes). Tratamos como
    // "indisponível" em vez de propagar o erro.
  }
  return null;
}

export default class SaveSystem {
  static SAVE_KEY = SAVE_KEY;

  static save(state) {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (_err) {
      return false;
    }
  }

  static load() {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (raw == null) return null;
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  static clear() {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.removeItem(SAVE_KEY);
    } catch (_err) {
      // ignora — não há slot para limpar de qualquer forma
    }
  }
}

export { SAVE_KEY };
