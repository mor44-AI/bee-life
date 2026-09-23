// facts - curiosidades sobre abelhas sem ferrão, em rodízio sem repetição.
//
// Texto em src/i18n/strings/facts.js (chave 'facts.<id>', pt e en). Para expandir,
// basta acrescentar { id, category } em FACTS e as strings pt/en correspondentes -
// o baralho salvo é refeito automaticamente quando a lista muda.
//
// API:
//   FACTS: Array<{ id, category }>
//   factCategories: string[]  (ids de categoria; rótulo i18n opcional 'facts.category.<id>'
//                              fica a cargo da UI se ela quiser exibir)
//   nextFact({ storage, random } = {}) -> { id, key, category }
//       key = 'facts.<id>' (a UI chama t(key)). Embaralha e percorre o baralho inteiro
//       antes de repetir; o baralho e a posição ficam em sessionStorage (fallback
//       localStorage; sem storage, em memória). Nunca lança.
//   factKey(id) -> 'facts.<id>'
//   resetFacts({ storage } = {})  (testes)

export const factCategories = [
  'biology', 'behavior', 'nest', 'colony', 'ecology', 'culture',
  'pollination', 'city', 'vsApis', 'mandacaia', 'surprising',
]

export const FACTS = [
  { id: 'noSting', category: 'biology' },
  { id: 'potsNotCombs', category: 'nest' },
  { id: 'tropicalRange', category: 'ecology' },
  { id: 'jataiGuards', category: 'behavior' },
  { id: 'mandacaiaEntrance', category: 'nest' },
  { id: 'involucrum', category: 'nest' },
  { id: 'scentTrails', category: 'behavior' },
  { id: 'pollinateNatives', category: 'pollination' },
  { id: 'pollinateAcai', category: 'pollination' },
  { id: 'buzzTomato', category: 'pollination' },
  { id: 'strawberryJatai', category: 'pollination' },
  { id: 'hollowTrees', category: 'ecology' },
  { id: 'urbanJatai', category: 'city' },
  { id: 'urbanMeliponary', category: 'city' },
  { id: 'urbanGardens', category: 'city' },
  { id: 'bioindicator', category: 'city' },
  { id: 'apisIntroduced', category: 'vsApis' },
  { id: 'africanized', category: 'vsApis' },
  { id: 'wateryHoney', category: 'vsApis' },
  { id: 'physogastricQueen', category: 'vsApis' },
  { id: 'geneticCaste', category: 'vsApis' },
  { id: 'gradualSwarm', category: 'vsApis' },
  { id: 'massProvisioning', category: 'vsApis' },
  { id: 'cellsOnce', category: 'vsApis' },
  { id: 'smallerColonies', category: 'vsApis' },
  { id: 'soundRecruitment', category: 'vsApis' },
  { id: 'mandacaiaStripes', category: 'mandacaia' },
  { id: 'mandacaiaGeopropolis', category: 'mandacaia' },
  { id: 'mandacaiaSouth', category: 'mandacaia' },
  { id: 'mandacaiaThreat', category: 'mandacaia' },
  { id: 'mandacaiaGentle', category: 'mandacaia' },
  { id: 'vultureBees', category: 'surprising' },
  { id: 'robberLimao', category: 'surprising' },
  { id: 'mummifyInvaders', category: 'surprising' },
  { id: 'soldierJatai', category: 'surprising' },
  { id: 'fireBee', category: 'surprising' },
  { id: 'fungusFood', category: 'surprising' },
  { id: 'undergroundNests', category: 'surprising' },
  { id: 'mayaBees', category: 'culture' },
  { id: 'tupiNames', category: 'culture' },
  { id: 'lawConama', category: 'culture' },
  { id: 'medicinalHoney', category: 'culture' },
]

export const FACTS_STORAGE_KEY = 'bee-life.facts.v1'

export const factKey = (id) => `facts.${id}`

function defaultStorage() {
  try { if (globalThis.sessionStorage) return globalThis.sessionStorage } catch { /* bloqueado */ }
  try { if (globalThis.localStorage) return globalThis.localStorage } catch { /* bloqueado */ }
  return null
}

let memory = null

function shuffle(ids, random) {
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function readDeck(storage) {
  try {
    const raw = storage?.getItem(FACTS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* storage indisponível ou JSON corrompido */ }
  return memory
}

function writeDeck(storage, deck) {
  memory = deck
  try { storage?.setItem(FACTS_STORAGE_KEY, JSON.stringify(deck)) } catch { /* só memória */ }
}

function validDeck(deck) {
  if (!deck || !Array.isArray(deck.order) || !Number.isInteger(deck.i)) return false
  const ids = new Set(FACTS.map((f) => f.id))
  return deck.order.length === ids.size && deck.order.every((id) => ids.has(id))
    && new Set(deck.order).size === ids.size
}

export function nextFact({ storage = defaultStorage(), random = Math.random } = {}) {
  let deck = readDeck(storage)
  if (!validDeck(deck)) deck = { order: shuffle(FACTS.map((f) => f.id), random), i: 0 }
  if (deck.i >= deck.order.length) {
    const last = deck.order[deck.order.length - 1]
    let order = shuffle(deck.order, random)
    // Evita repetir a mesma curiosidade na virada do baralho.
    if (order.length > 1 && order[0] === last) order = [...order.slice(1), order[0]]
    deck = { order, i: 0 }
  }
  const id = deck.order[deck.i]
  writeDeck(storage, { order: deck.order, i: deck.i + 1 })
  const fact = FACTS.find((f) => f.id === id)
  return { id, key: factKey(id), category: fact.category }
}

export function resetFacts({ storage = defaultStorage() } = {}) {
  memory = null
  try { storage?.removeItem(FACTS_STORAGE_KEY) } catch { /* ignora */ }
}

export default { FACTS, factCategories, nextFact, factKey, resetFacts }
