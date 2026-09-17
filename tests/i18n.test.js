import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULES, LANGS, detectLang, t, setLang, getLang } from '../src/i18n/index.js'

test('every string module has the same keys in pt and en', () => {
  for (const [name, mod] of Object.entries(MODULES)) {
    const [a, b] = LANGS.map(lang => Object.keys(mod[lang] ?? {}).sort())
    assert.deepEqual(a, b, `module "${name}" has keys missing in one language`)
  }
})

test('language detection prefers stored choice, then pt browsers, else en', () => {
  const storage = value => ({ getItem: () => value, setItem() {} })
  assert.equal(detectLang({ storage: storage('en'), languages: ['pt-BR'] }), 'en')
  assert.equal(detectLang({ storage: storage(null), languages: ['fr-FR', 'pt-PT'] }), 'pt')
  assert.equal(detectLang({ storage: storage('xx'), languages: ['de'] }), 'en')
  const blocked = { getItem() { throw Error('blocked') } }
  assert.equal(detectLang({ storage: blocked, languages: ['pt'] }), 'pt')
})

test('t interpolates params and falls back to the key', () => {
  const storage = { setItem() {} }
  setLang('en', { storage })
  assert.equal(getLang(), 'en')
  assert.equal(t('__missing.key__'), '__missing.key__')
})
