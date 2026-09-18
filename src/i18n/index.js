// i18n — Bee Life is played in Portuguese (pt) and English (en).
//
// API:
//   t(key, params?)        -> string. Placeholders use {name}: t('hub.turn', { n: 2 }).
//                             A dictionary value may also be a function (params) => string
//                             (useful for plurals). Missing key: falls back to the other
//                             language, then to the key itself (warned once in dev).
//   getLang() / setLang(lang)   current language ('pt' | 'en'); setLang persists the choice.
//   onLangChange(fn) -> unsubscribe   for DOM overlays; canvas screens just call t() on render.
//   detectLang({ storage, languages })  stored choice, else 'pt' for any pt-* browser
//                             language, else 'en'.
//
// Strings live in src/i18n/strings/<module>.js as `export default { pt: {...}, en: {...} }`,
// with keys namespaced by module (e.g. 'menu.newGame'). Both languages must have the same keys
// (tests/i18n.test.js enforces it). Offscreen caches that bake text must include getLang() in
// their cache key.

import screens from './strings/screens.js'
import hud from './strings/hud.js'
import species from './strings/species.js'
import cleaning from './strings/cleaning.js'
import feedLarvae from './strings/feedLarvae.js'
import feedQueen from './strings/feedQueen.js'
import guard from './strings/guard.js'
import score from './strings/score.js'
import facts from './strings/facts.js'

export const LANGS = ['pt', 'en']
export const LANG_STORAGE_KEY = 'bee-life.lang.v1'
export const MODULES = { screens, hud, species, cleaning, feedLarvae, feedQueen, guard, score, facts }

const dictionaries = { pt: {}, en: {} }
for (const mod of Object.values(MODULES)) {
  for (const lang of LANGS) Object.assign(dictionaries[lang], mod?.[lang] ?? {})
}

function defaultStorage() {
  try { return globalThis.localStorage } catch { return undefined }
}

export function detectLang({ storage = defaultStorage(), languages } = {}) {
  try {
    const saved = storage?.getItem(LANG_STORAGE_KEY)
    if (LANGS.includes(saved)) return saved
  } catch { /* Storage blocked: fall back to the browser language. */ }
  const list = languages ?? globalThis.navigator?.languages ?? [globalThis.navigator?.language]
  return list.some(l => typeof l === 'string' && l.toLowerCase().startsWith('pt')) ? 'pt' : 'en'
}

let current = detectLang()
const listeners = new Set()
const warned = new Set()

function applyDocumentLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'pt' ? 'pt-BR' : 'en'
}
applyDocumentLang()

export function getLang() { return current }

export function setLang(lang, { storage = defaultStorage() } = {}) {
  if (!LANGS.includes(lang) || lang === current) return
  current = lang
  try { storage?.setItem(LANG_STORAGE_KEY, lang) } catch { /* Not remembered, still switches. */ }
  applyDocumentLang()
  for (const fn of listeners) fn(lang)
}

export function onLangChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function t(key, params = {}) {
  const other = current === 'pt' ? 'en' : 'pt'
  let value = dictionaries[current][key] ?? dictionaries[other][key]
  if (value === undefined) {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key "${key}"`)
    }
    return key
  }
  if (typeof value === 'function') value = value(params)
  return String(value).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}
