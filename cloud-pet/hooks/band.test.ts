// claude plugin test: the band draws a valid tree on both surfaces
import { expect, mock, test } from 'claude-code/testing'

import { IDLE, miniAct, miniSvg } from './mini'
import { CACHE_TTL, hudLines, setCompactAt, spendText } from './scene'

const BAND = { plugin: 'cloud-pet', component: 'AbovePrompt', props: { hasSurvey: false, maxRows: 14, bodyColumns: 100 } } as const

test('band draws on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 15) })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: /contexto/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a turn with a failed step ends: the HUD says how long it took', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 15) })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 170_000, window: 200_000, percent: 85 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', () => ({ result: 'boom', text: 'boom', isError: true }) as never)
  await $.turn.start({ text: 'oi', turnId: 't' } as never)
  // regression: an answered question must not leave the HUD waiting
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.tool.call({ tool: 'Bash', command: 'false', description: 'Rodando os testes da api' } as never)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /esperando/ })).toBeUndefined()
  await after.unmount()
  const live = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await live.find({ type: 'Text', text: /Rodando os testes da api/ })).toBeDefined()
  await live.unmount()
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 't', reason: 'answer' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /pronto em 5s/ })).toBeDefined()
    await ui.unmount()
  }
})

test('what a turn took reads as cost and points of each window', async () => {
  expect(spendText({ cost: 0.42, five: 2, week: 0.31 })).toBe('+$0.42 · 5h +2.0% · sem +0.3%')
  expect(spendText({ cost: 0, five: 0 })).toBe('5h ~0%')
  setCompactAt(217_000, 250_000)
  expect(hudLines({ tokens: 100_000 }, 'happy', 0, 0).flat().join('\n')).toMatch(/100k\/250k[\s\S]*auto-compact em ~117k/)
})

test('the cache row counts down, warns, then says what the next message costs', () => {
  const rows = (cacheLeft?: number) => hudLines({ tokens: 71_000 }, 'happy', 0, 0, { cacheLeft }).flat().join('\n')
  expect(rows()).not.toMatch(/cache/)
  expect(rows(CACHE_TTL)).toMatch(/cache +▰{10} 1h00/)
  expect(rows(8 * 60_000)).toMatch(/cache[^\n]*8min\n +⚠ esfria logo/)
  expect(rows(0)).toMatch(/cache +▱+ expirou\n +próxima msg relê ~71k[\s\S]*\/clear/)
})

test('every one-line pose draws', () => {
  for (const act of [...IDLE, 'laptop', 'wave', 'think', 'cheer', 'sad', 'dizzy', 'dead'] as const) {
    for (const f of [0, 3, 9, 41]) expect(miniSvg(act, f)).toContain('<rect')
  }
  expect(miniAct('work', 'calm', 0)).toBe('laptop')
  expect(miniAct(undefined, 'dead', 0)).toBe('dead')
  expect(miniAct(undefined, 'calm', 0)).toBe(IDLE[0])
})
