// claude plugin test: the band draws a valid tree on both surfaces, idle and with a full sky (compact button)
import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'cloud-pet', component: 'AbovePrompt', props: { hasSurvey: false, maxRows: 14, bodyColumns: 100 } } as const

test('band draws on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2, 15) })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.drawn()
    expect(await ui.find({ type: 'Text', text: /contexto/ })).toBeDefined()
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
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
