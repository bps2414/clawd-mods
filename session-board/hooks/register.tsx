import type { EngineInterface, Register } from 'claude-code'

// Each session keeps one small file of its own in ~/.claude/session-board, so no two processes ever write the same file.
type Row = { id: string; cwd: string; state: 'rodando' | 'esperando você' | 'pronto' | 'fim'; since: number; seen: number; what: string }

const PANE = 'session-board'
const BEAT = 15_000
const STALE = 60_000 // a session not seen for this long has gone without saying goodbye

let dir = ''
let me: Row | undefined
let rows: Row[] = []
let now = 0
let turn = '' // the turn in flight, so a turn cut short ending late does not mark the new one done
let asks = 0

const save = async ($: EngineInterface) => {
  if (!me || !dir) return
  me.seen = await $.clock.now()
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me)).catch(() => undefined)
}

const set = ($: EngineInterface, state: Row['state'], what?: string) => {
  if (!me) return
  if (me.state !== state) me.since = now || me.since
  me.state = state
  if (what !== undefined) me.what = what
  void save($).then(() => load($))
}

const load = async ($: EngineInterface) => {
  if (!dir) return
  now = await $.clock.now()
  const files = await $.fs.list(dir).catch(() => [])
  // ponytail: files of dead sessions stay on disk (tiny, $.fs has no delete); skipped by mtime before reading
  const live = files.filter(f => f.kind === 'file' && f.name.endsWith('.json') && now - f.mtimeMs < STALE)
  const read = await Promise.all(live.map(f => $.fs.read(`${dir}/${f.name}`).then(t => JSON.parse(t as string) as Row).catch(() => undefined)))
  rows = read.filter((r): r is Row => r !== undefined && r.state !== 'fim').sort((a, b) => a.cwd.localeCompare(b.cwd))
  $.ui.invalidate('ui.render')
}

const ago = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}min` : `${(ms / 3_600_000).toFixed(1)}h`)
const ICON: Record<Row['state'], string> = { rodando: '▶', 'esperando você': '✋', pronto: '✓', fim: '·' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'Painel com todas as sessões do Claude Code abertas e o estado de cada uma' })
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home) {
      dir = `${home.replace(/\\/g, '/')}/.claude/session-board`
      now = await $.clock.now()
      me = { id: await $.session.id(), cwd: await $.session.cwd(), state: 'pronto', since: now, seen: now, what: '' }
      await save($)
      $.clock.every(BEAT, () => void save($).then(() => load($)))
    }

    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await load($)
    await $.ui.open({ id: PANE, title: 'Sessões' })

    return { text: rows.map(r => `${ICON[r.state]} ${r.cwd} · ${r.state}`).join('\n') || 'Nenhuma sessão viva.' }
  })

  on('turn.start', ($, e, next) => {
    turn = e.turnId
    asks = 0
    set($, 'rodando', e.text.replace(/\s+/g, ' ').slice(0, 60))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isAsking = e.tool === 'AskUserQuestion'
    if (isAsking) asks++
    // a tool of the main thread runs, so the session is running, whatever the file said (the mod reloaded mid-turn)
    if (isAsking || (e.agentId === undefined && me?.state !== 'rodando')) set($, asks > 0 ? 'esperando você' : 'rodando')
    try {
      return await next(e)
    } finally {
      if (isAsking && --asks <= 0) { asks = 0; if (me?.state === 'esperando você') set($, 'rodando') }
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && (turn === '' || turn === e.turnId)) { asks = 0; set($, 'pronto') }

    return done
  })

  on('session.end', async ($, e, next) => {
    if (me) me.state = 'fim'
    await save($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const name = (cwd: string) => cwd.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Nenhuma sessão viva.</Text>}
        {rows.map(r => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold={r.state === 'esperando você'} color={r.state === 'esperando você' ? 'yellow' : r.state === 'rodando' ? 'magenta' : 'green'}>
              {ICON[r.state]} {name(r.cwd)}{r.id === me?.id ? ' (esta)' : ''}
            </Text>
            <Text dimColor>  {r.state} há {ago(now - r.since)}{r.what ? ` · ${r.what}` : ''}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
