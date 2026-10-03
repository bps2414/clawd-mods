import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Day, PetUsage } from '../types'
import { CACHE_TTL, COMPACT_AT, WINDOW, setCompactAt, spendText, MOOD_ICON, PET_W, hudLines, moodFor, paintScene, petRect, span, squaresAt, toCells, toSvg, trackX, wanderX } from './scene'
import type { Scene, TaskPhase, TurnSpend } from './scene'

const usage = atom({ plugin: 'cloud-pet', key: 'usage' } as const, { tokens: 0 } as PetUsage)
const compacts = atom({ plugin: 'cloud-pet', key: 'compacts' } as const, 0)

const TICK = 150 // ms per frame
const CHEER_FRAMES = 45 // ~7s of rainbow after a compaction
const STUCK_MS = 45_000 // this long with no step: the pet stops and looks back
const LONG_TURN_MS = 120_000 // a turn this long rings when it ends
const ASK_RING_MS = 15_000 // a question left unanswered this long rings
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Animation state. A hot reload resets these; the usage itself lives in $.state.
let latest: PetUsage = { tokens: 0 }
let lastKey = ''
let shown = 0 // weather intensity, eased toward tokens / COMPACT_AT so the sky never jumps
let frame = 0
let cheer = 0
let isHidden = false
let isMini = false // collapsed to one text line
let isTerminal = false
let bandId: string | undefined // the AbovePrompt render instance the timer blits into
let size = { W: 40, PH: 20 }
// the account's real limit windows, asked of Anthropic directly so they stay fresh with no prompt sent
let remote: Pick<PetUsage, 'five' | 'week' | 'fiveResets'> | undefined
// pointer play: where it hovers, and what a click set going
let look: { x: number; y: number } | undefined
let poke = 0 // frames of happy hop left
let dizzy = 0
let pokes = 0 // pokes in quick succession
let lastPoke = -999
let zap: { x: number; left: number } | undefined
let say = ''
let sayLeft = 0
const SAYS = ['hihi!', 'cosquinhas!', 'ai!', 'mais um! 💕', 'tô com fome de token…', 'bora codar?']

// the task bar: the turn in flight, the pet walking its track
type Task = {
  phase: 'work' | 'done' | 'fail'
  turnId?: string // absent on a turn taken up midway
  asks: number // questions open in front of the person: waiting is counted, never a flag someone must remember to clear
  steps: number
  startAt: number // wall-clock ms, so a throttled timer never bends the times shown
  lastAt: number // the last sign of life
  tool: string
  errs: number[]
  squares: number
  fresh: number
  end: number // frames the finished bar stays before it fades away
  cost0?: number
  five0?: number
  week0?: number
  summary?: string
}
const END_FRAMES = 30
let task: Task | undefined
let progress = 0 // eased 0..1
let stepsPerTurn = 12 // learned: what a usual turn of this person takes, kept in $.store
let petX: number | undefined
let cam = 0
let scroll = 0 // the world slides by while the pet works
let stumble = 0
let float: { text: string; age: number } | undefined
let lastHead = ''
// the world's clock and the diary
let nowMs = 0
let tzMin = -new Date().getTimezoneOffset() // /pet fuso N overrides, should the engine's clock not be the wall's
const NO_DAY: Day = { turns: 0, secs: 0, cost: 0, compacts: 0, deaths: 0 }
let today: Day = NO_DAY
let todayKey = ''
let lastSpend: TurnSpend | undefined
let isMuted = false
let wasDead = false
// the limit sentinel: recent readings of the 5h window, to project when it runs out
let samples: { at: number; five: number }[] = []
let fiveWarn: string | undefined
let hasWarned = false

// the prompt cache: any request keeps it warm for an hour, so the clock runs from the last sign of one
let cacheAt: number | undefined // wall-clock ms; unknown until this session does something
let cacheNote = 0 // 0 nothing said yet, 1 warned it is cooling, 2 said it went cold
const touchCache = () => { cacheAt = Date.now(); cacheNote = 0 }
const cacheLeft = () => (cacheAt === undefined ? undefined : Math.max(0, CACHE_TTL - (Date.now() - cacheAt)))

const isDead = (u: PetUsage) => (u.five ?? 0) >= 100 || (u.week ?? 0) >= 100
const moodNow = () => moodFor(
  shown,
  isDead(latest),
  dizzy > 0 || task?.phase === 'fail' ? 'dizzy' : poke > 0 ? 'poked' : cheer > 0 || task?.phase === 'done' ? 'cheer' : undefined,
)
const phaseNow = (): TaskPhase | undefined =>
  task && (task.phase !== 'work' ? task.phase : task.asks > 0 ? 'wait' : Date.now() - task.lastAt > STUCK_MS ? 'stuck' : 'work')
const local = (ms: number) => new Date(ms + tzMin * 60_000)
const dateKey = (ms: number) => local(ms).toISOString().slice(0, 10)

const sceneState = (): Scene => {
  const d = local(nowMs)

  return {
    ...size, t: shown, mood: moodNow(), frame, cheer, look, poke, zap, petX, cam, stumble, float,
    hour: nowMs ? d.getUTCHours() + d.getUTCMinutes() / 60 : 12,
    flowers: Math.min(8, 2 + today.turns),
    task: task && { phase: phaseNow()!, errs: task.errs, fresh: task.fresh, fade: Math.min(1, task.end / 12) },
  }
}
const scene = () => paintScene(sceneState())

const clock = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(Math.floor((s % 60) / 10) * 10).padStart(2, '0')}`
}

/** What the agent is doing right now, in words: the tool's own description when it has one, else the tool and its target. */
const doing = (e: { tool: string } & Record<string, unknown>): string => {
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
  const file = str(e.file_path ?? e.notebook_path).split(/[\\/]/).pop() ?? ''
  const tool = e.tool.replace(/^mcp__.*__/, '')
  const text = str(e.description) // Bash, PowerShell and Agent say what they are for
    || (file && `${({ Read: 'lendo', Edit: 'editando', Write: 'escrevendo' } as Record<string, string>)[tool] ?? tool} ${file}`)
    || (str(e.pattern) && `buscando ${str(e.pattern)}`)
    || (str(e.skill) && `skill ${str(e.skill)}`)
    || (str(e.query ?? e.url) && `${tool} ${str(e.query ?? e.url)}`)
    || str(e.command)
    || tool

  return text.length > 30 ? `${text.slice(0, 29)}…` : text
}

/** The HUD's first line while a turn is in flight. */
const taskHead = (): string | undefined => {
  if (!task) return undefined
  const phase = phaseNow()
  if (phase === 'done' || phase === 'fail') return task.summary
  if (phase === 'wait') return '✋ esperando você responder…'
  const took = clock(Date.now() - task.startAt)
  if (phase === 'stuck') return `⏳ ${task.tool || 'pensando'} há ${clock(Date.now() - task.lastAt)} · ${took}`

  return `▶ ${task.tool || 'pensando…'} · ${took}`
}

// ---- sound: a two-note chime made here, so the mod ships no audio file ----

const chime = (notes: number[]) => {
  const RATE = 8000
  const n = Math.floor(RATE * 0.14)
  const data = new Uint8Array(44 + notes.length * n)
  const view = new DataView(data.buffer)
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => { data[at + i] = ch.charCodeAt(0) })
  tag(0, 'RIFF'); view.setUint32(4, 36 + notes.length * n, true); tag(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true); view.setUint32(28, RATE, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true)
  tag(36, 'data'); view.setUint32(40, notes.length * n, true)
  notes.forEach((hz, j) => {
    for (let i = 0; i < n; i++) data[44 + j * n + i] = 128 + Math.round(80 * Math.sin((2 * Math.PI * hz * i) / RATE) * (1 - i / n))
  })

  return data.toBase64()
}
const DONE = [784, 1175] // up: the turn is over
const ASK = [988, 988, 740] // a knock: it wants an answer

const ring = async ($: EngineInterface, notes: number[], words: string) => {
  if (isMuted) return
  try {
    await $.audio.play({ base64: chime(notes), mime: 'audio/wav' })
  } catch {
    // no player for a clip here: the system voice says it instead, and silence is fine too
    await $.audio.speak(words).catch(() => undefined)
  }
}

// ---- the diary: one row per day, shared by every session ------------------

const readDays = async ($: EngineInterface) => ((await $.store.get('days')) ?? {}) as Record<string, Day>

// ponytail: read-modify-write, so two sessions ending a turn in the same instant can lose one bump; a file lock if it ever matters
const bumpDay = async ($: EngineInterface, fn: (d: Day) => void) => {
  const days = await readDays($)
  const key = dateKey(nowMs || (await $.clock.now()))
  const day: Day = { ...NO_DAY, ...days[key] }
  fn(day)
  days[key] = day
  today = day
  todayKey = key
  await $.store.set('days', Object.fromEntries(Object.entries(days).sort().slice(-30)))
}

const stats = async ($: EngineInterface) => {
  const rows = Object.entries(await readDays($)).sort().slice(-7)
  if (rows.length === 0) return 'O diário do Clawd ainda está em branco.'
  const line = ([date, d]: [string, Day]) =>
    `${date.slice(5)}  ${String(d.turns).padStart(3)} turnos  ${span(d.secs * 1000).padStart(6)}  $${d.cost.toFixed(2).padStart(6)}  ${d.compacts} compact  ${'💀'.repeat(Math.min(d.deaths, 5))}`

  return ['Diário do Clawd (últimos dias)', ...rows.map(line), `ritmo de um turno seu: ~${Math.round(stepsPerTurn)} passos`].join('\n')
}

// ---- readings --------------------------------------------------------------

/** Where this session really auto-compacts (the person's autoCompactWindow setting), estimated locally at no cost. */
const pollThreshold = async ($: EngineInterface) => {
  const b = (await $.session.usage({ breakdown: 'summary' }).catch(() => undefined))?.context.breakdown
  const at = b?.autoCompactThreshold
  if (typeof at === 'number' && at > 0 && (at !== COMPACT_AT || b!.rawMaxTokens !== WINDOW)) {
    setCompactAt(at, b!.rawMaxTokens)
    lastKey = ''
    $.ui.invalidate('ui.render')
  }
}

type Window = { utilization?: unknown; resets_at?: unknown }
const pollLimits = async ($: EngineInterface) => {
  try {
    const auth = await $.session.authorize()
    if (auth?.kind !== 'bearer') return
    const r = await $.http.fetch('https://api.anthropic.com/api/oauth/usage', { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    if (!r.ok) return
    const j = JSON.parse(r.text) as { five_hour?: Window; seven_day?: Window }
    const num = (w?: Window) => (typeof w?.utilization === 'number' ? w.utilization : undefined)
    remote = { five: num(j.five_hour), week: num(j.seven_day), fiveResets: typeof j.five_hour?.resets_at === 'string' ? j.five_hour.resets_at : undefined }
  } catch {
    // keep the last reading, the session's own figures fill in
  }
}

/** Projects the 5h window at the pace of the last 20 minutes; warns when it would run out before it resets. */
const watchLimit = ($: EngineInterface, u: PetUsage) => {
  if (u.five === undefined) { fiveWarn = undefined; return }
  const lastSeen = samples[samples.length - 1]
  if (lastSeen && u.five < lastSeen.five - 5) { samples = []; hasWarned = false } // the window reset
  if (!lastSeen || nowMs - lastSeen.at >= 55_000) samples = [...samples, { at: nowMs, five: u.five }].filter(s => nowMs - s.at <= 20 * 60_000)
  const first = samples[0]
  const rate = first && nowMs - first.at >= 3 * 60_000 ? (u.five - first.five) / (nowMs - first.at) : 0
  const outIn = rate > 0 ? (100 - u.five) / rate : Infinity
  const resetIn = u.fiveResets ? Date.parse(u.fiveResets) - nowMs : Infinity
  fiveWarn = outIn < resetIn && outIn < 90 * 60_000 && u.five < 100 ? ` · ⚠ acaba em ~${span(outIn)}` : undefined
  if (fiveWarn && outIn < 20 * 60_000 && !hasWarned) {
    hasWarned = true
    $.ui.toast(`Clawd: nesse ritmo o limite de 5h acaba em ~${span(outIn)}, antes do reset`, { timeoutMs: 9000 })
  }
}

const poll = async ($: EngineInterface) => {
  const u = await $.session.usage()
  nowMs = await $.clock.now()
  if (todayKey && dateKey(nowMs) !== todayKey) { today = NO_DAY; todayKey = dateKey(nowMs) } // midnight passed
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const week = u.rateLimits.find(r => r.kind === 'seven_day')
  const win = u.context.window ?? COMPACT_AT
  const next: PetUsage = {
    tokens: Math.round(u.context.tokens ?? ((u.context.percent ?? 0) / 100) * win),
    five: remote?.five ?? five?.percentUsed,
    week: remote?.week ?? week?.percentUsed,
    fiveResets: remote?.fiveResets ?? five?.resetsAt,
    cost: u.cost?.usd,
  }
  latest = next
  watchLimit($, next)
  if (isDead(next) && !wasDead) void bumpDay($, d => { d.deaths++ }).catch(() => undefined)
  wasDead = isDead(next)
  const key = JSON.stringify(next) + (fiveWarn ?? '') + COMPACT_AT + WINDOW
  if (key === lastKey) return
  lastKey = key
  await update($, usage, () => next)
  const left = Math.max(0, COMPACT_AT - next.tokens)
  $.ui.status(`${MOOD_ICON[moodNow()]} ${Math.round(next.tokens / 1000)}k/${Math.round(WINDOW / 1000)}k · compact em ${Math.round(left / 1000)}k${next.five === undefined ? '' : ` · 5h ${Math.round(next.five)}%`}`)
}

/** One frame of everything that moves. */
const step = ($: EngineInterface) => {
  frame++
  if (cheer > 0) cheer--
  if (poke > 0) poke--
  if (dizzy > 0) dizzy--
  if (stumble > 0) stumble--
  if (zap && --zap.left <= 0) zap = undefined
  if (float && ++float.age > 36) float = undefined
  if (sayLeft > 0 && --sayLeft === 0) $.ui.invalidate('ui.render')
  shown += (clamp(latest.tokens / COMPACT_AT, 0, 1) - shown) * 0.12

  const mood = moodNow()
  const stroll = wanderX({ ...size, t: shown, frame, cheer, mood })
  if (task) {
    const isOver = task.phase === 'done' || task.phase === 'fail'
    // no turn says how long it is: each step and each 20s close a share of what is left, by this person's usual turn
    const secs = (Date.now() - task.startAt) / 1000
    const goal = task.phase === 'done' ? 1 : task.phase === 'fail' ? progress : Math.min(0.93, 1 - Math.exp(-(task.steps + secs / 20) / stepsPerTurn))
    progress += (goal - progress) * 0.15
    task.fresh++
    const n = squaresAt(trackX(size.W, progress))
    if (n > task.squares) { task.squares = n; task.fresh = 0 }
    if (phaseNow() === 'work') scroll += 0.45
    if (isOver && --task.end <= 0) task = undefined
  }
  const goalX = task ? trackX(size.W, progress) : stroll
  petX = petX === undefined ? goalX : petX + (goalX - petX) * (task ? 0.5 : 0.12)
  if (Math.abs(goalX - petX) < 0.5) petX = goalX
  cam += (scroll + (petX - (size.W - PET_W) / 2) * 0.5 + (look ? (look.x - size.W / 2) * 0.2 : 0) - cam) * 0.15

  const left = cacheLeft()
  if (left !== undefined && !task) {
    if (left === 0 && cacheNote < 2) {
      cacheNote = 2
      $.ui.toast(`Clawd: cache esfriou · a próxima msg relê ~${Math.round(latest.tokens / 1000)}k tokens`, { timeoutMs: 12000 })
    } else if (left > 0 && left <= 5 * 60_000 && cacheNote < 1) {
      cacheNote = 1
      $.ui.toast(`Clawd: cache esfria em ~${span(left)}`, { timeoutMs: 8000 })
    }
  }

  const head = `${taskHead() ?? ''}|${left === undefined ? '' : Math.ceil(left / 60_000)}` // the cache row ticks by the minute
  if (head !== lastHead) {
    lastHead = head
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pet', description: 'Clawd: mostra/esconde, som, diário e fuso', argumentHint: '[mini | som | stats | fuso N]' })
    nowMs = await $.clock.now()
    isMuted = (await $.store.get('muted')) === true
    const tz = await $.store.get('tz')
    if (typeof tz === 'number') tzMin = tz * 60
    const learned = await $.store.get('stepsPerTurn')
    if (typeof learned === 'number') stepsPerTurn = clamp(learned, 4, 80)
    todayKey = dateKey(nowMs)
    today = { ...NO_DAY, ...(await readDays($))[todayKey] }
    isHidden = (await $.store.get('hidden')) === true
    isMini = (await $.store.get('mini')) === true

    void pollThreshold($)
    $.clock.every(60_000, () => void pollThreshold($))
    void pollLimits($).then(() => poll($))
    $.clock.every(5000, () => void poll($))
    $.clock.every(60_000, () => void pollLimits($))
    let isBlitting = false // a blit still in flight: its tick is skipped, so a slow terminal never queues frames
    $.clock.every(TICK, async () => {
      step($)
      if (isHidden || isMini) return // one text line has nothing to animate per frame
      if (isTerminal && bandId) {
        if (isBlitting) return
        isBlitting = true
        try {
          const r = await $.ui.blit({ requestId: bandId, key: 'scene', cells: toCells(scene(), size.W, size.PH) })
          if (r.deny) $.ui.invalidate('ui.render')
        } finally {
          isBlitting = false
        }
      } else if (!isTerminal) {
        $.ui.invalidate('ui.render') // the desktop has no blit: every frame is a redraw (the engine folds them to 30 a second)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const [verb, arg] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === 'som') {
      isMuted = !isMuted
      await $.store.set('muted', isMuted)
      if (!isMuted) void ring($, DONE, 'Clawd')

      return { text: isMuted ? 'Clawd no mudo. /pet som liga de novo.' : 'Som ligado: Clawd toca quando um turno longo termina ou fica te esperando.' }
    }
    if (verb === 'mini') {
      isMini = !isMini
      await $.store.set('mini', isMini)
      $.ui.invalidate('ui.render')

      return { text: isMini ? 'Clawd encolhido numa linha. /pet mini expande de novo.' : 'Clawd expandido.' }
    }
    if (verb === 'stats') return { text: await stats($) }
    if (verb === 'fuso') {
      const hours = Number(arg)
      if (!Number.isFinite(hours) || Math.abs(hours) > 14) return { text: 'Uso: /pet fuso -3 (horas em relação a UTC)' }
      tzMin = hours * 60
      await $.store.set('tz', hours)

      return { text: `Fuso do céu do Clawd: UTC${hours >= 0 ? '+' : ''}${hours}.` }
    }
    isHidden = !isHidden
    await $.store.set('hidden', isHidden)
    $.ui.invalidate('ui.render')

    return { text: isHidden ? 'Pet hidden. /pet shows it again.' : 'Pet is back above the prompt.' }
  })

  const begin = (turnId?: string) => {
    task = { turnId, phase: 'work', asks: 0, steps: 0, startAt: Date.now(), lastAt: Date.now(), tool: '', errs: [], squares: 0, fresh: 99, end: END_FRAMES, cost0: latest.cost, five0: latest.five, week0: latest.week }
    progress = 0
    float = undefined

    return task
  }

  // a turn begins: the pet steps onto the track
  on('turn.start', ($, e, next) => {
    const mine = begin(e.turnId)
    touchCache()
    // the windows are read once a minute: a fresh reading now, so the turn is not billed the minute before it
    void pollLimits($).then(() => { mine.five0 = remote?.five ?? mine.five0; mine.week0 = remote?.week ?? mine.week0 })

    return next(e)
  })

  // every tool call is a step down the track; an error trips the pet and stains that square
  on('tool.call', async ($, e, next) => {
    // a tool runs, so a turn is in flight: with none on record (the mod reloaded mid-turn, the last one was closed early) take it up
    const mine = task?.phase === 'work' ? task : e.agentId === undefined ? begin() : undefined
    if (!mine) return next(e) // a background agent outliving its turn is no turn of its own
    mine.steps++
    mine.lastAt = Date.now()
    touchCache()
    mine.tool = doing(e)
    const isAsking = e.tool === 'AskUserQuestion'
    const timer = isAsking ? $.clock.after(ASK_RING_MS, () => void ring($, ASK, 'Clawd precisa de você')) : undefined
    if (isAsking) mine.asks++
    try {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError === true) {
        mine.errs.push(Math.max(0, mine.squares - 1))
        stumble = 6
      }

      return ran
    } finally {
      if (isAsking) mine.asks--
      mine.lastAt = Date.now()
      touchCache() // the next model request follows a tool result
      timer?.cancel()
    }
  })

  // the conversation ends or is cleared: nothing is in flight any more
  on('session.end', ($, e, next) => {
    task = undefined

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done // a subagent's run is a step of the turn, not its end
    touchCache() // the last request of the turn is the one that kept it warm

    // from here on nothing may throw: a failed hook is skipped, and the engine would run the rest of the chain again
    try {
      await poll($).catch(() => undefined)
      // a turn cut short by a new prompt can end after the new one began: it must not close the new one's bar
      const mine = task && (task.turnId === undefined || task.turnId === e.turnId) ? task : undefined
      const isOk = e.reason === 'answer'
      const spent = latest.cost !== undefined && mine?.cost0 !== undefined ? Math.max(0, latest.cost - mine.cost0) : 0
      const took = span(e.durationMs)
      if (mine) {
        mine.phase = isOk ? 'done' : 'fail'
        mine.asks = 0
        mine.end = END_FRAMES
        mine.summary = isOk ? `✓ pronto em ${took}${spent >= 0.005 ? ` · +$${spent.toFixed(2)}` : ''}` : e.isAborted ? '✗ interrompido' : '✗ o turno caiu'
        if (isOk && spent >= 0.005) float = { text: `+$${spent.toFixed(2)}`, age: 0 }
        if (isOk && mine.steps > 0) {
          stepsPerTurn = clamp(stepsPerTurn * 0.8 + mine.steps * 0.2, 4, 80)
          void $.store.set('stepsPerTurn', stepsPerTurn).catch(() => undefined)
        }
      }
      if (isOk) {
        lastSpend = { cost: spent }
        // what it took of the 5h and weekly windows, once Anthropic's own count has it; the account's other sessions count in too
        const gone = (now?: number, was?: number) => (now !== undefined && was !== undefined && now >= was ? now - was : undefined)
        const mark = lastSpend
        void pollLimits($).then(() => poll($)).then(() => {
          mark.five = gone(latest.five, mine?.five0)
          mark.week = gone(latest.week, mine?.week0)
          if (mine?.summary && (mark.five !== undefined || mark.week !== undefined)) mine.summary = `✓ ${took} · ${spendText(mark)}`
          $.ui.invalidate('ui.render')
        }).catch(() => undefined)
        void bumpDay($, d => { d.turns++; d.secs += Math.round(e.durationMs / 1000); d.cost += spent }).catch(() => undefined)
        if (e.durationMs >= LONG_TURN_MS) {
          $.ui.toast(`Clawd: pronto em ${took}${spent >= 0.005 ? ` (+$${spent.toFixed(2)})` : ''}`, { timeoutMs: 8000 })
          void ring($, DONE, 'Clawd terminou')
        }
      }
      $.ui.invalidate('ui.render')
    } catch {
      // the bar is decoration: the turn's own result goes through whatever happened here
    }

    return done
  })

  // the Client laid over the scene reports the pointer: hover steers the eyes, a click plays
  on('ui.message', async ($, e, next) => {
    const d = e.data as { t?: string; x?: number; y?: number }
    if (typeof d?.x === 'number' && typeof d.y === 'number') {
      if (d.t === 'leave') look = undefined
      else look = { x: d.x, y: d.y }

      if (d.t === 'down' && isDead(latest)) {
        say = 'x_x…'
        sayLeft = 22
        $.ui.invalidate('ui.render')
      } else if (d.t === 'down') {
        const r = petRect(sceneState())
        const isOnPet = d.x >= r.x - 1 && d.x <= r.x + r.w + 1 && d.y >= r.y - 1 && d.y <= r.y + r.h + 1
        if (isOnPet) {
          pokes = frame - lastPoke < 22 ? pokes + 1 : 1
          lastPoke = frame
          if (pokes >= 6) {
            dizzy = 40
            pokes = 0
            say = 'tonto… tonto…'
          } else {
            poke = 14
            say = SAYS[frame % SAYS.length]
          }
        } else {
          zap = { x: d.x, left: 6 }
          say = 'trovão! ⚡'
        }
        sayLeft = 22
        $.ui.invalidate('ui.render')
      }
    }

    return next(e)
  })

  // auto-compact (or /compact) done: the sky clears and the pet celebrates
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.trigger !== 'precompute') {
      cheer = CHEER_FRAMES
      $.ui.toast('Compactado! Clawd tá levinho ✨')
      // none of this may fail the hook: the compaction is already done
      await update($, compacts, n => n + 1).catch(() => undefined)
      void bumpDay($, d => { d.compacts++ }).catch(() => undefined)
      await poll($).catch(() => undefined)
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, maxRows, bodyColumns } = e.props
    const rows = Math.min(12, maxRows - 2)
    if (isHidden || hasSurvey || (!isMini && rows < 6)) return next(e)

    const u = await read($, usage)
    await read($, compacts) // subscribes: a compaction redraws the band
    const count = today.compacts // the day's, every session's, as the line says
    const now = await $.clock.now()
    const mood = moodNow()
    const groups = hudLines(u, mood, now, count, { task: taskHead(), fiveWarn, last: lastSpend, today: today.cost, cacheLeft: cacheLeft() })
    if (sayLeft > 0) groups[0] = [say]
    const lines = groups.flat()
    if (isMini) {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor wrap="truncate-end">{MOOD_ICON[mood]} {lines[0]} · {Math.round(u.tokens / 1000)}k/{Math.round(WINDOW / 1000)}k{u.five === undefined ? '' : ` · 5h ${Math.round(u.five)}%`}</Text>
    }
    const hasSide = bodyColumns >= 64
    const W = hasSide ? clamp(bodyColumns - 36, 24, 44) : clamp(bodyColumns - 2, 20, 44)
    size = { W, PH: rows * 2 }
    bandId = e.requestId

    // groups are told apart by a blank row when the card has room, else they run together; rows with a two-space indent are the dim sub-lines
    const room = Math.max(rows, maxRows - 2)
    const gaps = lines.length + groups.length - 1 <= room
    const HUD = (Text: any) => groups.flatMap((g, gi) => [
      ...(gaps && gi > 0 ? [<Text key={`gap${gi}`}> </Text>] : []),
      ...g.map(line => <Text bold={gi === 0} dimColor={line.startsWith('  ')}>{line}</Text>),
    ]).slice(0, room)

    if (e.surface === 'terminal') {
      const { Box, Text, Raster, Client } = $.ui.resolve(e)
      isTerminal = true

      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box width={size.W} height={rows}>
              <Raster key="scene" columns={size.W} rows={rows} cells={toCells(scene(), size.W, size.PH)} />
              <Box position="absolute" top={0} left={0}>
                <Client key="hit" module="./hit.tsx" width={size.W} height={rows} props={{ columns: size.W, rows }} />
              </Box>
            </Box>
            {hasSide && <Box flexDirection="column" marginLeft={2} justifyContent="center">{HUD(Text)}</Box>}
          </Box>
          {!hasSide && <Text dimColor>{lines[0]} · {Math.round(u.tokens / 1000)}k/{Math.round(WINDOW / 1000)}k</Text>}
        </Box>
      )
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    isTerminal = false

    return (
      <Box flexDirection="row">
        <Svg source={toSvg(scene(), size.W, size.PH)} alt="Clawd and the weather" width={size.W * 7} />
        <Box flexDirection="column" marginLeft={2}>{HUD(Text)}</Box>
      </Box>
    )
  })
}
