import type { Register } from 'claude-code'

const ASK = (focus: string) => `Escreva um HANDOFF desta sessão: um prompt único, pronto pra colar numa sessão nova do Claude Code que não viu nada disto.
Em português, direto, sem enrolação, em markdown, com estas seções:
## Objetivo (o que o usuário quer, nas palavras dele)
## Estado (o que já está feito e verificado; o que está pela metade)
## Arquivos (caminhos absolutos que importam e o papel de cada um)
## Decisões e restrições (o que já foi decidido e não deve ser rediscutido; preferências do usuário)
## Armadilhas (erros já batidos e como foram contornados)
## Próximo passo (a primeira ação concreta)
Nunca inclua segredos, tokens, senhas ou chaves. Responda só com o handoff.${focus ? `\nFoco pedido: ${focus}` : ''}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'Resume a sessão num prompt pronto pra colar numa sessão nova (vai pro clipboard)', argumentHint: '[foco]' })

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    const reply = await $.model.fork({ prompt: ASK(e.args.trim()) })
    if (!reply.isAnswered) return { text: `Sem handoff: ${reply.reason === 'nothing-to-fork' ? 'a sessão ainda não tem nenhuma resposta.' : reply.reason}` }
    const { isCopied } = await $.ui.copy({ text: reply.text }).catch(() => ({ isCopied: false }))

    return { text: `${isCopied ? '📋 Handoff copiado. Cole numa sessão nova.' : 'Não consegui copiar; o handoff está aqui embaixo.'}\n\n${reply.text}` }
  })
}
