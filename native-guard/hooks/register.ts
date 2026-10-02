import type { Register } from 'claude-code'

import { verdict } from './guard'

let isOn = true
let blocked = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'guard', description: 'Liga/desliga o guarda que troca sed -i/heredoc por Edit e Write' })
    isOn = (await $.store.get('off')) !== true

    return next(e)
  })

  on('command.run', { command: 'guard' }, async $ => {
    isOn = !isOn
    await $.store.set('off', !isOn)

    return { text: isOn ? `Guarda ligado (${blocked} recusas nesta sessão).` : 'Guarda desligado.' }
  })

  on('tool.call', ($, e, next) => {
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell'
    const why = isOn && isShell ? verdict(String((e as { command?: unknown }).command ?? '')) : undefined
    if (!why) return next(e)
    blocked++

    return { deny: `native-guard: ${why} Se o shell for mesmo o único jeito, repita o comando com o comentário "# guard:ok".` }
  })
}
