// Leaderboard - ranking local (localStorage), tolerante a storage indisponível.
//
// Começa com registros fictícios de pontuação baixa (dummy: true) para o jogador
// ter o que superar; uma vida mediana (~20.000+) já entra no topo.
//
// API (default = instância com o localStorage do navegador):
//   createLeaderboard({ storage, key, capacity = 10 }) -> board
//   board.load()          -> entradas ordenadas (lê o storage; sem nada salvo = seed)
//   board.top(n = 10)     -> [{ name, score, date, dummy }] (maior primeiro)
//   board.qualifies(score) -> boolean  (score > 0 e entra no top `capacity`)
//   board.add(name, score) -> { entry, rank } | null  (null se score inválido; rank 1-based)
//       nome sanitizado: sem controles, espaços colapsados, trim, máx. 16 chars;
//       vazio -> t('score.defaultName') ("Abelha"/"Bee"). Grava até capacity×2 entradas.
//   board.best()          -> maior pontuação REAL (não dummy) do jogador, ou 0
//   board.rankOf(score)   -> posição 1-based que a pontuação ocupa(ria)
//   board.saveFailed      -> true se a última gravação falhou (lista segue em memória)
//   sanitizeName(name) / SEED / LEADERBOARD_KEY

import { t } from '../i18n/index.js'

export const LEADERBOARD_KEY = 'bee-life.leaderboard.v1'
export const NAME_MAX = 16

export const SEED = [
  { name: 'Jataí', score: 11800 },
  { name: 'Uruçu', score: 10400 },
  { name: 'Tubuna', score: 9100 },
  { name: 'Mirim', score: 7700 },
  { name: 'Iraí', score: 6300 },
  { name: 'Manduri', score: 5000 },
  { name: 'Borá', score: 3900 },
  { name: 'Mandaguari', score: 3000 },
].map((e) => ({ ...e, date: '2026-01-01', dummy: true }))

export function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()
  return Array.from(clean).slice(0, NAME_MAX).join('').trim() || t('score.defaultName')
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null } catch { return null }
}

const byScore = (a, b) => b.score - a.score || (a.dummy === b.dummy ? 0 : a.dummy ? 1 : -1)

function validEntry(e) {
  return e && typeof e.name === 'string' && Number.isFinite(e.score) && e.score >= 0
}

export function createLeaderboard({ storage = defaultStorage(), key = LEADERBOARD_KEY, capacity = 10 } = {}) {
  let entries = null
  const board = {
    saveFailed: false,
    load() {
      let list = null
      // Gravação falhou: a memória é mais recente que o storage.
      if (entries && board.saveFailed) return entries.map((e) => ({ ...e }))
      try {
        const raw = storage?.getItem(key)
        const parsed = raw ? JSON.parse(raw) : null
        if (Array.isArray(parsed)) list = parsed.filter(validEntry).map((e) => ({
          name: e.name.slice(0, NAME_MAX), score: Math.round(e.score), date: String(e.date ?? ''), dummy: !!e.dummy,
        }))
      } catch { /* storage bloqueado ou JSON corrompido: usa seed/memória */ }
      if (list) entries = list
      else if (!entries) entries = SEED.map((e) => ({ ...e }))
      entries.sort(byScore)
      return entries.map((e) => ({ ...e }))
    },
    top(n = capacity) {
      return board.load().slice(0, Math.max(0, n))
    },
    rankOf(score) {
      const list = board.load()
      return list.filter((e) => e.score >= score).length + 1
    },
    qualifies(score) {
      return Number.isFinite(score) && score > 0 && board.rankOf(score) <= capacity
    },
    best() {
      return board.load().filter((e) => !e.dummy).reduce((m, e) => Math.max(m, e.score), 0)
    },
    add(name, score) {
      if (!Number.isFinite(score) || score < 0) return null
      const entry = { name: sanitizeName(name), score: Math.round(score), date: new Date().toISOString().slice(0, 10), dummy: false }
      const list = board.load()
      list.push(entry)
      list.sort(byScore)
      entries = list.slice(0, capacity * 2)
      const rank = list.indexOf(entry) + 1
      try {
        if (!storage) throw new Error('no storage')
        storage.setItem(key, JSON.stringify(entries))
        board.saveFailed = false
      } catch {
        board.saveFailed = true
      }
      return { entry: { ...entry }, rank }
    },
  }
  return board
}

const leaderboard = createLeaderboard()
export default leaderboard
