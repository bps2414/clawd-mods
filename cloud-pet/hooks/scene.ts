import type { PetUsage } from '../types'

/** Where auto-compact fires: the weather is tokens / COMPACT_AT, the full storm. 200k until the session says its own. */
export let COMPACT_AT = 200_000
/** The compaction window itself (autoCompactWindow): what the HUD shows tokens against. Auto-compact fires a reserve short of it. */
export let WINDOW = 200_000
export const setCompactAt = (tokens: number, window = tokens) => { COMPACT_AT = tokens; WINDOW = Math.max(tokens, window) }

export type Mood = 'happy' | 'calm' | 'worried' | 'sad' | 'cry' | 'dead' | 'cheer' | 'poked' | 'dizzy'

export const moodFor = (t: number, isDead: boolean, over?: 'cheer' | 'poked' | 'dizzy'): Mood =>
  isDead ? 'dead' : over ?? (t < 0.3 ? 'happy' : t < 0.55 ? 'calm' : t < 0.75 ? 'worried' : t < 0.9 ? 'sad' : 'cry')

export const MOOD_TEXT: Record<Mood, string> = {
  poked: 'hihi! cosquinha 💕',
  dizzy: 'tô tonto… para… 😵',
  happy: 'tudo leve por aqui ☀',
  calm: 'umas nuvenzinhas passando…',
  worried: 'acho que vai chover…',
  sad: 'tô ficando encharcado 🥺',
  cry: 'SOCORRO! auto-compact chegando…',
  dead: 'x_x acabou o limite… tadinho',
  cheer: 'COMPACTADO! tô levinho ✨',
}

export const MOOD_ICON: Record<Mood, string> = {
  poked: '💕', dizzy: '😵', happy: '☀', calm: '⛅', worried: '☁', sad: '🌧', cry: '⛈', dead: '💀', cheer: '🌈',
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const mod = (n: number, m: number) => ((n % m) + m) % m

const hash = (seed: number) => {
  let n = Math.imul(seed | 0, 0x45d9f3b)
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

const lerp = (a: number, b: number, t: number) => {
  const k = clamp(t, 0, 1)
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

const desat = (c: number, k: number) => {
  const y = Math.round(((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11)
  return lerp(c, (y << 16) | (y << 8) | y, k)
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// ---- text bits for the HUD ----------------------------------------------

export const bar = (pct: number) => {
  const on = Math.round(clamp(pct, 0, 100) / 10)
  return '▰'.repeat(on) + '▱'.repeat(10 - on)
}

export const hearts = (usedPct: number) => {
  const full = Math.round(clamp(100 - usedPct, 0, 100) / 20)
  return '♥'.repeat(full) + '♡'.repeat(5 - full)
}

const k = (n: number) => `${Math.round(n / 1000)}k`

/** 95 -> "1min", 4000 -> "1h06" */
export const span = (ms: number) => {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`
  const m = Math.max(1, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}

const eta = (iso: string | undefined, now: number) => {
  const ms = iso ? Date.parse(iso) - now : NaN
  return ms > 0 ? ` · reseta em ${span(ms)}` : ''
}

export type HudExtra = {
  /** what the turn is doing; takes the mood line while a turn runs */
  task?: string
  /** the limit sentinel's warning; takes the reset countdown's place */
  fiveWarn?: string
  /** what the last turn took: USD and points of each limit window */
  last?: TurnSpend
  /** what today cost so far across sessions, USD */
  today?: number
}

export type TurnSpend = { cost?: number; five?: number; week?: number }

const pts = (n: number) => (n < 0.05 ? '~0%' : `+${n < 10 ? n.toFixed(1) : Math.round(n)}%`)

/** "+$0.42 · 5h +2.0% · sem +0.3%": what one turn took, the parts there is a reading for. */
export const spendText = (s: TurnSpend) => [
  s.cost !== undefined && s.cost >= 0.005 && `+$${s.cost.toFixed(2)}`,
  s.five !== undefined && `5h ${pts(s.five)}`,
  s.week !== undefined && `sem ${pts(s.week)}`,
].filter(Boolean).join(' · ')

export const hudLines = (u: PetUsage, mood: Mood, now: number, compacts: number, x: HudExtra = {}): string[] => {
  const t = clamp(u.tokens / COMPACT_AT, 0, 1)
  const left = COMPACT_AT - u.tokens
  const compact = mood === 'cheer' && !x.task ? '✨ contexto limpinho, bora de novo'
    : t >= 1 ? '⚡ compactando…'
      : t >= 0.9 ? `⚠ auto-compact em ~${k(left)}!`
        : `auto-compact em ~${k(left)}`

  const head = mood === 'dead'
    ? ((u.five ?? 0) >= 100 ? 'x_x limite de 5h acabou… tadinho' : 'x_x limite da semana acabou… tadinho')
    : x.task ?? MOOD_TEXT[mood]

  const cost = u.cost === undefined ? []
    : [`custo      $${u.cost.toFixed(2)}${x.today ? ` · hoje $${x.today.toFixed(2)}` : ''}`]
  const last = x.last && spendText(x.last)

  return [
    head,
    `contexto   ${bar(t * 100)} ${k(u.tokens)}/${k(WINDOW)}`,
    compacts > 0 ? `${compact} · ${compacts}× hoje` : compact,
    u.five === undefined
      ? 'energia 5h ♡♡♡♡♡ sem leitura ainda'
      : `energia 5h ${hearts(u.five)} ${Math.round(u.five)}%${x.fiveWarn ?? eta(u.fiveResets, now)}`,
    u.week === undefined ? 'semana     ▱▱▱▱▱▱▱▱▱▱ —' : `semana     ${bar(u.week)} ${Math.round(u.week)}%`,
    ...cost,
    ...(last ? [`último     ${last}`] : []),
  ]
}

// ---- the pet: the Claude Code mascot, 18x9 px. Flat orange block body, two ----
// ---- square eyes, stubby arms low on the sides, four thin legs. No mouth.   ----

const PALETTE: Record<string, number> = {
  O: 0xd97757, // body
  K: 0x1c1210, // eyes
  B: 0x7fd0ff, // tears, sweat
  P: 0xf0a08a, // blush
}

const BASE = [
  '..OOOOOOOOOOOOOO..',
  '..OOOOOOOOOOOOOO..',
  '..OOOOOOOOOOOOOO..',
  '..OOOOOOOOOOOOOO..',
  'OOOOOOOOOOOOOOOOOO',
  'OOOOOOOOOOOOOOOOOO',
  '..OO..OO..OO..OO..',
  '..OO..OO..OO..OO..',
  '..OO..OO..OO..OO..',
]
export const PET_W = 18
const PET_H = 9

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n))

/** Gaze offset in px (ox, oy): toward the pointer, else down the track while working, else idly glancing about. */
const gaze = (s: Scene): [number, number] => {
  const r = petRect(s)
  if (s.look) return [clamp1(Math.round((s.look.x - (r.x + 9)) / 7)), clamp1(Math.round((s.look.y - (r.y + 2)) / 5))]
  if (s.task?.phase === 'work') return [1, 0]
  if (s.task?.phase === 'stuck') return [-1, 0] // looks back at the trail

  return [[0, 0, -1, 0, 1, 0][Math.floor(s.frame / 40) % 6], 0]
}

const sprite = (s: Scene): string[][] => {
  const { mood, frame } = s
  const phase = s.task?.phase
  const g = BASE.map(r => r.split(''))
  if (mood === 'dead') {
    // belly up, legs in the air, a cross for each eye
    g.reverse()
    ;[4, 11].forEach(c => [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]].forEach(([r, i]) => { g[5 + r][c + i] = 'K' }))
    return g
  }
  const put = (r: number, c: number, ch: string) => { if (g[r]?.[c] !== undefined) g[r][c] = ch }
  const [ox, oy] = gaze(s)
  const eye = (c: number, r: number) => { put(r, c, 'K'); put(r + 1, c, 'K') }
  const eyes = (dy = 0) => { eye(5 + ox, 1 + clamp1(oy + dy)); eye(12 + ox, 1 + clamp1(oy + dy)) }
  const closed = () => [4, 5, 12, 13].forEach(c => put(2, c, 'K'))
  const happyEyes = () => [[1, 5], [2, 4], [2, 6], [1, 12], [2, 11], [2, 13]].forEach(([r, c]) => put(r, c, 'K'))
  const armUp = (cols: number[]) => cols.forEach(c => { put(4, c, '.'); put(5, c, '.'); put(2, c, 'O'); put(3, c, 'O') })
  const blush = () => { put(3, 4, 'P'); put(3, 13, 'P') }
  const drop = (c: number, r0: number, span: number, speed: number) => put(r0 + (Math.floor(frame / speed) % span), c, 'B')
  // legs shuffle while it walks: strolling in nice weather, or hauling the task bar
  const walking = phase === 'work' || (!phase && (mood === 'happy' || mood === 'calm'))
  const pace = phase === 'work' ? 3 : 5
  if (walking) [2, 6, 10, 14].forEach((c, i) => { if ((Math.floor(frame / pace) + i) % 2) { put(8, c, '.'); put(8, c + 1, '.') } })

  if ((s.stumble ?? 0) > 0) {
    closed(); drop(14, 0, 3, 2)
  } else if (mood === 'cheer') {
    happyEyes(); blush(); armUp([0, 1]); armUp([16, 17])
  } else if (mood === 'poked') {
    happyEyes(); blush()
  } else if (mood === 'dizzy') {
    const [a, b] = [[1, 5], [1, 6], [2, 6], [2, 5]][Math.floor(frame / 2) % 4]
    put(a, b, 'K'); put(a, b + 7, 'K')
  } else if (mood === 'happy') {
    frame % 40 < 2 ? closed() : eyes(); blush()
    if (!phase && frame % 28 < 12) armUp([16, 17])
  } else if (mood === 'calm') {
    frame % 40 < 2 ? closed() : eyes()
  } else if (mood === 'worried') {
    eyes(); drop(14, 0, 3, 4)
  } else if (mood === 'sad') {
    eyes(1); drop(5, 4, 3, 4); drop(12, 4, 3, 4)
  } else if (mood === 'cry') {
    closed(); drop(5, 3, 4, 2); drop(12, 3, 4, 2); drop(4, 3, 4, 3); drop(13, 3, 4, 3)
  }
  // waiting on the person: it waves; stuck: a bead of sweat
  if (phase === 'wait' && frame % 8 < 4) armUp([16, 17])
  if (phase === 'stuck') drop(14, 0, 3, 4)

  return g
}

// ---- the scene: one pixel buffer both surfaces draw ------------------------

export type TaskPhase = 'work' | 'wait' | 'stuck' | 'done' | 'fail'

/** The task bar: the pet is the slider's thumb and leaves a trail of squares behind it. */
export type TaskView = {
  phase: TaskPhase
  /** trail squares that went wrong (a tool errored there), by index from the left */
  errs: number[]
  /** frames since the newest square appeared; it flashes white while small */
  fresh: number
  /** 1 while the turn runs, falling to 0 as the trail fades out after it */
  fade: number
}

export type Scene = {
  /** weather intensity 0..1, eased */
  t: number
  mood: Mood
  frame: number
  /** frames of celebration left after a compaction, 0 when none */
  cheer: number
  /** where the pointer is, in scene px; absent when it is away */
  look?: { x: number; y: number }
  /** frames left of the happy hop after a poke */
  poke?: number
  /** a bolt the person called down with a click */
  zap?: { x: number; left: number }
  /** the pet's left edge, eased by the caller; absent, it strolls on its own */
  petX?: number
  /** the camera's travel in px: each layer of the world slides by its own share of it */
  cam?: number
  /** local hour 0..24, fractional: the sky's time of day */
  hour?: number
  /** flowers in the garden: one per turn finished today */
  flowers?: number
  task?: TaskView
  /** frames left of a trip after a tool error */
  stumble?: number
  /** a little text rising from the pet (what the turn cost) */
  float?: { text: string; age: number }
  W: number
  PH: number
}

/** Where the pet strolls to on its own: wide in nice weather, still once it worsens. */
export const wanderX = ({ W, t, frame, cheer, mood }: Pick<Scene, 'W' | 't' | 'frame' | 'cheer' | 'mood'>) => {
  const eff = cheer > 0 ? Math.min(t, 0.2) : t
  const amp = mood === 'dead' ? 0 : Math.max(0, W / 2 - PET_W) * clamp(1 - eff * 2, 0, 1)

  return Math.round(W / 2 + Math.sin(frame / 30) * amp) - (PET_W >> 1)
}

/** Where progress p (0..1) puts the pet on the track. */
export const trackX = (W: number, p: number) => Math.round(clamp(p, 0, 1) * (W - PET_W))

/** How many trail squares lie behind a pet whose left edge is at x. */
export const squaresAt = (x: number) => Math.max(0, Math.floor((x + (PET_W >> 1) - 1) / 3))

/** Where the pet stands (px); also what a click is tested against. */
export const petRect = (s: Pick<Scene, 'W' | 'PH' | 't' | 'frame' | 'cheer' | 'mood' | 'petX'>) => {
  const x = Math.round(s.petX ?? wanderX(s))

  return { x, y: s.PH - 2 - PET_H, w: PET_W, h: PET_H, cx: x + (PET_W >> 1) }
}

const RAINBOW = [0xff5d5d, 0xff9b4a, 0xffe14d, 0x6bdc6b, 0x58b7ff, 0x9a7bff]
const CONFETTI = [0xff5d8f, 0xffe14d, 0x6bdc6b, 0x58b7ff, 0xffffff, 0xc58bff]
const PURPLE = 0x9a7bff

// the sky through the day: [hour, top, horizon]
const SKY: [number, number, number][] = [
  [0, 0x0b1030, 0x26305a], [5, 0x0b1030, 0x26305a], [6.5, 0x5b6fb0, 0xffc9a0], [8, 0x7cc8f0, 0xcdeefc],
  [16.5, 0x7cc8f0, 0xcdeefc], [18, 0x4a3b78, 0xff9e6b], [19.5, 0x0b1030, 0x26305a], [24, 0x0b1030, 0x26305a],
]
const skyAt = (h: number): [number, number] => {
  const i = Math.max(1, SKY.findIndex(s => s[0] >= h))
  const [h0, t0, b0] = SKY[i - 1]
  const [h1, t1, b1] = SKY[i]
  const f = (h - h0) / (h1 - h0)

  return [lerp(t0, t1, f), lerp(b0, b1, f)]
}

// a 3x5 pixel font for the bits of text that float in the scene
const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '.#.', '.#.', '.#.'], '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'], '+': ['...', '.#.', '###', '.#.', '...'], '$': ['.##', '##.', '.#.', '.##', '##.'],
  '.': ['.', '.', '.', '.', '#'], '?': ['###', '..#', '.#.', '...', '.#.'], '!': ['#', '#', '#', '.', '#'],
}

type Cloud = { x: number; y: number; w: number }

/** W px wide, PH px tall (even, 12+); colors 0xRRGGBB. */
export const paintScene = (scene: Scene): Uint32Array => {
  const { W, PH, t: rawT, mood, frame, cheer, poke = 0, zap, task, float } = scene
  const cam = scene.cam ?? 0
  const hour = mod(scene.hour ?? 12, 24)
  const px = new Uint32Array(W * PH)
  const set = (x: number, y: number, c: number) => {
    if (x >= 0 && x < W && y >= 0 && y < PH) px[y * W + x] = c
  }
  const mix = (x: number, y: number, c: number, a: number) => {
    x = Math.round(x); y = Math.round(y)
    if (x >= 0 && x < W && y >= 0 && y < PH) px[y * W + x] = lerp(px[y * W + x], c, a)
  }
  const rect = (x: number, y: number, w: number, h: number, c: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c)
  }

  const dead = mood === 'dead'
  const t = dead ? 0.85 : cheer > 0 ? Math.min(rawT, 0.2) : rawT
  const ground = PH - 2
  const rain = clamp((t - 0.4) / 0.6, 0, 1)
  const stormy = !dead && t >= 0.8
  const day = clamp((hour - 5) / 2, 0, 1) * clamp((19.5 - hour) / 2, 0, 1) // 0 night .. 1 full day
  const night = 1 - day
  const dusk = (c: number) => lerp(c, 0x0a1128, night * 0.5) // the land under the hour's light

  // lightning: a deterministic flash every 22 frames, likelier as t grows; a click calls one down
  const epoch = Math.floor(frame / 22)
  const phase = frame % 22
  const isFlash = !!zap || (stormy && hash(epoch * 31 + 7) < (t - 0.7) * 2.4 && phase < 3)
  const flash = zap ? (zap.left % 2 ? 0.45 : 0.15) : isFlash ? (phase === 1 ? 0.2 : 0.5) : 0

  // sky: the hour's colors, darkened by the weather
  const [hourTop, hourBot] = skyAt(hour)
  const skyTop = lerp(hourTop, 0x1d2233, t * 1.15)
  const skyBot = lerp(hourBot, 0x39405a, t * 1.1)
  for (let y = 0; y < PH; y++) {
    const c = lerp(lerp(skyTop, skyBot, y / ground), 0xfff3b0, flash)
    for (let x = 0; x < W; x++) px[y * W + x] = c
  }

  // stars, twinkling; the clouds take them away
  const starry = night * clamp(1 - t * 1.6, 0, 1)
  if (starry > 0.05) {
    for (let i = 0; i < 16; i++) {
      const tw = hash(i * 7 + Math.floor(frame / 7)) < 0.8 ? 1 : 0.35
      mix(Math.floor(hash(i * 91 + 3) * W), Math.floor(hash(i * 57 + 1) * (ground - 5)), 0xffffff, starry * tw * (0.5 + hash(i) * 0.5))
    }
  }

  // sun by day, moon by night, each on its arc; both fade as the weather turns
  const clear = 1 - clamp(t / 0.45, 0, 1)
  const arc = (u: number): [number, number] => [Math.round(4 + u * (W - 9)), Math.round(3 + (1 - Math.sin(u * Math.PI)) * Math.min(6, ground - 6))]
  if (clear > 0 && day > 0) {
    const [sx, sy] = arc(clamp((hour - 6) / 12.5, 0, 1))
    const sun = lerp(0xffd45e, 0xff9a4d, 1 - day)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = dx * dx + dy * dy
      if (d <= 9) mix(sx + dx, sy + dy, sun, clear * Math.min(1, day * 1.5))
      else if (d <= 20) mix(sx + dx, sy + dy, sun, clear * day * 0.18) // glow
    }
    // rays that take turns
    ;[[5, 0], [-5, 0], [0, -5], [4, 4], [-4, 4], [4, -4], [-4, -4]].forEach(([dx, dy], i) => {
      if ((Math.floor(frame / 6) + i) % 2) mix(sx + dx, sy + dy, 0xfff3b0, clear * day * 0.8)
    })
  }
  if (clear > 0 && night > 0.3) {
    const [mx, my] = arc(clamp(mod(hour - 19, 24) / 10.5, 0, 1))
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const isCut = (dx - 1.4) * (dx - 1.4) + (dy + 0.6) * (dy + 0.6) < 4
      if (dx * dx + dy * dy <= 5 && !isCut) mix(mx + dx, my + dy, 0xf4f1d6, clear * night)
    }
  }

  // the clouds: a far layer drifting slowly, a near one that carries the rain
  const cloud = lerp(lerp(lerp(0xffffff, 0xb9c4e6, night * 0.7), 0x444a5c, t * 1.25), 0xffffff, flash * 0.6)
  const wrap = (v: number) => mod(v, W + 28) - 14
  const far: Cloud[] = Array.from({ length: 2 + Math.round(t * 2) }, (_, i) => ({
    w: 5 + Math.floor(hash(i * 23 + 2) * 4),
    x: Math.floor(wrap(hash(i * 29 + 5) * (W + 28) + frame * (0.04 + hash(i * 31) * 0.04) - cam * 0.08)),
    y: Math.floor(hash(i * 37 + 4) * 3),
  }))
  const near: Cloud[] = Array.from({ length: 1 + Math.round(t * 5) }, (_, i) => ({
    w: 9 + Math.floor(t * 9) + Math.floor(hash(i * 5) * 4),
    x: Math.floor(wrap(hash(i * 7) * (W + 28) + frame * (0.12 + hash(i * 11) * 0.2) - cam * 0.22)),
    y: 1 + Math.floor(hash(i * 3) * 3),
  }))
  far.forEach(({ x, y, w }) => {
    const c = lerp(cloud, lerp(skyTop, skyBot, 0.3), 0.5)
    rect(x + 1, y, w - 2, 1, c)
    rect(x, y + 1, w, 1, lerp(c, 0x000000, 0.06))
  })

  // far mountains and nearer hills, each sliding by its own share of the camera
  const scale = clamp(ground / 18, 0.6, 1)
  const ridge = (x: number, share: number, a: number, b: number) => Math.sin((x + cam * share) / a) + 0.6 * Math.sin((x + cam * share) / b + 1.7)
  const mountain = lerp(lerp(skyBot, 0x5a6fa8, 0.6), 0x2a3046, t * 0.8)
  const hill = dusk(lerp(0x4a9a6c, 0x1f3a33, t))
  for (let x = 0; x < W; x++) {
    const hm = Math.round((4.5 + 1.9 * ridge(x, 0.12, 7, 3.1)) * scale)
    for (let j = 0; j < hm; j++) set(x, ground - 1 - j, j === hm - 1 && hm >= 6 * scale ? lerp(mountain, 0xffffff, 0.55) : lerp(mountain, skyBot, j / 14))
  }
  for (let x = -3; x < W + 3; x++) {
    const hh = Math.round((2.4 + 1.1 * ridge(x, 0.4, 5, 2.3)) * scale)
    for (let j = 0; j < hh; j++) set(x, ground - 1 - j, j === hh - 1 ? lerp(hill, 0xffffff, 0.12) : hill)
    // a pine now and then, rooted in the hills' own ground
    const wx = Math.floor(x + cam * 0.4)
    if (mod(wx, 11) === 0 && hash(Math.floor(wx / 11) * 53) < 0.6) {
      const pine = lerp(hill, 0x0c2a22, 0.45)
      const top = ground - 1 - hh
      set(x, top - 3, pine); rect(x - 1, top - 2, 3, 1, pine); rect(x - 1, top - 1, 3, 1, lerp(pine, 0x000000, 0.15)); set(x, top, 0x5a4030)
    }
  }

  // rainbow after a compaction
  if (cheer > 0) {
    const cx = W / 2
    const cy = ground + 3
    const outer = Math.min(W / 2 - 1, 16)
    for (let y = 0; y < ground; y++) for (let x = 0; x < W; x++) {
      const d = outer - Math.hypot(x - cx, (y - cy) * 1.2)
      const band = Math.floor(d / 1.5)
      if (d >= 0 && band < RAINBOW.length) set(x, y, lerp(px[y * W + x], RAINBOW[band], 0.85))
    }
  }

  // near clouds: a bump on top, a lit crown, a dark belly; under[x] is where each column's rain starts
  const under = new Int16Array(W).fill(-1)
  near.forEach(({ x, y, w }) => {
    rect(x + Math.floor(w * 0.25), y - 1, Math.max(2, Math.floor(w * 0.35)), 1, lerp(cloud, 0xffffff, 0.3))
    rect(x + 2, y, w - 4, 1, lerp(cloud, 0xffffff, 0.2))
    rect(x, y + 1, w, 1, cloud)
    rect(x + 1, y + 2, w - 2, 1, lerp(cloud, 0x000000, 0.14 + t * 0.12))
    for (let i = 1; i < w - 1; i++) if (x + i >= 0 && x + i < W) under[x + i] = Math.max(under[x + i], y + 3)
  })

  // lightning bolt, from a cloud's belly down, behind the pet
  if (isFlash) {
    const src = near[Math.floor(hash(epoch * 13) * near.length)]
    let bx = clamp(zap ? Math.round(zap.x) : src.x + (src.w >> 1), 1, W - 3)
    for (let y = Math.max(2, under[bx]); y < ground; y++) {
      if (y % 3 === 0) bx += hash(epoch * 100 + y) < 0.5 ? -1 : 1
      set(bx, y, 0xfff7a8)
      set(bx + 1, y, 0xfff7a8)
    }
  }

  // ground: grass, tufts and the day's garden in the nearest layer
  const grass = dusk(lerp(0x58a05a, 0x24331f, t))
  rect(0, ground, W, PH - ground, grass)
  rect(0, ground, W, 1, dusk(lerp(0x7bc26b, 0x33472e, t)))
  const flowers = scene.flowers ?? 3
  for (let x = 0; x < W; x++) {
    const wx = Math.floor(x + cam)
    if (hash(wx * 19) < 0.22) set(x, ground - 1, lerp(grass, 0xffffff, 0.14))
    if (mod(wx, 5) !== 2) continue
    const slot = Math.floor(wx / 5)
    if (mod(slot, 8) >= flowers) continue
    const sway = Math.sin(frame / 9 + slot) > 0.6 ? 1 : 0
    const petal = [0xff8fb1, 0xffe14d, 0xffffff, 0xc58bff][Math.floor(hash(slot * 7) * 4)]
    set(x, ground - 1, dusk(0x3f8a4a))
    set(x + sway, ground - 2, dusk(lerp(petal, 0x55607a, rain * 0.6)))
  }

  // rain: every drop leaves a cloud's belly and falls to the ground, leaning with the wind
  if (rain > 0) {
    const drop = lerp(0xbfe3ff, 0x6a9bff, t)
    for (let x = 0; x < W; x++) {
      if (under[x] < 0 || hash(x * 13 + 1) >= 0.12 + rain * 0.6) continue
      const fall = ground - under[x]
      if (fall < 2) continue
      const off = Math.floor(hash(x * 3) * fall + frame * (2 + Math.floor(hash(x * 7) * 2))) % fall
      const dx = stormy ? -Math.floor(off / 4) : rain > 0.5 ? -Math.floor(off / 8) : 0
      const y = under[x] + off
      set(x + dx, y, drop)
      mix(x + dx, y - 1, drop, 0.45)
      if (y >= ground - 1) { mix(x + dx - 1, ground - 1, 0xcfe6ff, 0.7); mix(x + dx + 1, ground - 1, 0xcfe6ff, 0.7) } // splash
    }
    // puddles gather once it pours
    if (rain > 0.45) {
      for (let x = 0; x < W; x++) {
        const wx = Math.floor(x + cam)
        if (mod(wx, 9) > 2 || hash(Math.floor(wx / 9) * 41) >= rain) continue
        set(x, ground, lerp(grass, 0x8fb8ff, hash(wx + Math.floor(frame / 3)) < 0.3 ? 0.85 : 0.5))
      }
    }
  }

  // small company: fireflies on a calm night, a butterfly on a sunny day
  if (!dead && night > 0.6 && t < 0.5) {
    for (let i = 0; i < 4; i++) {
      if ((Math.floor(frame / 5) + i) % 4 < 2) continue
      mix(hash(i * 17 + 9) * W + Math.sin(frame / 9 + i * 2) * 3, ground - 3 - hash(i * 5) * 5 + Math.cos(frame / 7 + i) * 2, 0xe8ff7a, 0.9)
    }
  }
  if (!dead && day > 0.6 && t < 0.35) {
    const bx = Math.round(W * 0.3 + Math.sin(frame / 16) * W * 0.22)
    const by = Math.round(ground - 6 + Math.sin(frame / 5) * 2)
    set(bx, by, 0x5a3a6a)
    if (frame % 4 < 2) { set(bx - 1, by, 0xff8fd0); set(bx + 1, by, 0xff8fd0) } else { set(bx - 1, by - 1, 0xff8fd0); set(bx + 1, by - 1, 0xff8fd0) }
  }

  // out of energy: the whole scene drains to grey
  if (dead) for (let i = 0; i < px.length; i++) px[i] = desat(px[i], 0.9)

  // the pet: wanders while the weather is nice, holds still once it worsens, walks the track on a task
  const stumble = scene.stumble ?? 0
  const shiver = mood === 'cry' ? (frame % 2 ? 1 : -1) : 0
  const base = petRect(scene)
  const cx = base.cx + shiver
  const petX = base.x + shiver
  const hop = stumble > 0 ? -1 - (stumble % 2)
    : mood === 'cheer' ? (Math.floor(frame / 3) % 2 ? -2 : 0)
      : poke > 0 ? -Math.round(Math.sin((1 - poke / 14) * Math.PI) * 3)
        : mood === 'happy' && Math.floor(frame / 4) % 2 ? -1 : 0
  const petY = base.y + hop
  rect(cx - 8, ground, 17, 1, lerp(grass, 0x000000, 0.35)) // shadow

  // the task bar: a rail across the ground, and the trail of squares the pet has laid so far
  if (task && !dead) {
    for (let x = 1; x < W - 1; x += 3) { mix(x, ground + 1, 0x000000, 0.28 * task.fade); mix(x + 1, ground + 1, 0x000000, 0.28 * task.fade) }
    const n = squaresAt(base.x)
    for (let i = 0; i < n; i++) {
      const x0 = 1 + i * 3
      const isLast = i === n - 1
      let c = task.phase === 'done' ? 0x6bdc6b : task.phase === 'fail' ? 0x8a8f9c : task.errs.includes(i) ? 0xff5d5d : PURPLE
      if (task.phase === 'done' && (i + Math.floor(frame / 2)) % 5 === 0) c = 0xeaffea // a glint runs down the finished bar
      if (isLast && task.fresh < 3) c = 0xffffff
      else if (isLast && task.phase === 'work') c = lerp(c, 0xffffff, 0.25 + 0.25 * Math.sin(frame / 2))
      else if (isLast && (task.phase === 'stuck' || task.phase === 'wait')) c = frame % 6 < 3 ? c : lerp(c, grass, 0.7)
      mix(x0, ground, lerp(c, 0xffffff, 0.35), task.fade)
      mix(x0 + 1, ground, lerp(c, 0xffffff, 0.15), task.fade)
      mix(x0, ground + 1, c, task.fade)
      mix(x0 + 1, ground + 1, lerp(c, 0x000000, 0.22), task.fade)
    }
  }

  sprite(scene).forEach((row, r) => row.forEach((ch, c) => {
    if (ch !== '.') set(petX + c, petY + r, dead ? desat(PALETTE[ch], 0.75) : PALETTE[ch])
  }))

  // a tombstone beside the fallen pet, a ghost rising from it (from the pet itself when there is no room)
  if (dead) {
    const room = [petX + PET_W + 3, petX - 10].find(x => x >= 0 && x + 7 <= W)
    const STONE = ['..###..', '.#####.', '#######', '###+###', '#+++###', '###+###', '###+###', '#######']
    if (room !== undefined) {
      STONE.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch !== '.') set(room + c, ground - 8 + r, ch === '+' ? 0x5b6070 : c === 6 ? 0x7d8392 : 0xaab0bb)
      }))
    }
    const age = frame % 70
    const alpha = Math.min(age / 8, 1) * Math.min((70 - age) / 24, 1) * 0.85
    const gx = (room ?? cx - 3) + Math.round(Math.sin(age / 6) * 2)
    const gy = (room === undefined ? petY - 4 : ground - 9) - Math.floor((age / 70) * (ground - 8))
    const wave = Math.floor(frame / 4) % 2
    const GHOST = ['..###..', '.#####.', '#E###E#', '#######', '#######', '#######', wave ? '#.#.#.#' : '.#.#.#.']
    GHOST.forEach((row, r) => [...row].forEach((ch, c) => {
      const x = gx + c
      const y = gy + r
      if (ch === '.' || x < 0 || x >= W || y < 0 || y >= ground) return
      set(x, y, lerp(px[y * W + x], ch === 'E' ? 0x2a2d3a : 0xf2f4ff, alpha))
    }))
  }

  // umbrella once it really rains
  if (t >= 0.6 && !dead && mood !== 'cheer') {
    ;[9, 15, 19].forEach((w, i) => {
      const y = petY - 5 + i
      for (let x = cx - (w >> 1); x <= cx + (w >> 1); x++) {
        set(x, y, (((x - cx) % 6) + 6) % 6 < 3 ? 0xe86a8f : 0xfbd3de)
      }
    })
    rect(cx, petY - 2, 1, 2, 0x6b4a3a)
  }

  // hearts float up after a poke, stars circle a dizzy head
  if (poke > 0) {
    ;[[3, 0], [10, 5], [7, 9]].forEach(([dx, lag]) => {
      const age = 14 - poke - lag / 3
      if (age < 0) return
      const hx = petX + dx
      const hy = petY - 2 - Math.floor(age * 1.2)
      ;[[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]].forEach(([ax, ay]) => set(hx + ax, hy + ay, ax === 1 && ay === 1 ? 0xffc0d4 : 0xff5d8f))
    })
  }
  if (mood === 'dizzy') {
    for (let i = 0; i < 3; i++) {
      const a = frame / 4 + (i * Math.PI * 2) / 3
      const sx = Math.round(cx + Math.cos(a) * 8)
      const sy = Math.round(petY - 2 + Math.sin(a) * 1.5)
      set(sx, sy, 0xffe14d); set(sx - 1, sy, 0xfff3b0); set(sx + 1, sy, 0xfff3b0); set(sx, sy - 1, 0xfff3b0)
    }
  }

  // confetti while cheering a compaction; sparkles for that and for a finished turn
  if (cheer > 0) {
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(hash(i * 5) * W)
      const y = Math.floor(hash(i * 3) * PH + frame * (1 + (i % 3) * 0.5)) % ground
      set(x, y, CONFETTI[i % CONFETTI.length])
    }
  }
  if (cheer > 0 || task?.phase === 'done') {
    ;[[petX - 3, petY + 1], [petX + PET_W + 2, petY - 1], [petX + 8, petY - 4]].forEach(([sx, sy], i) => {
      if ((Math.floor(frame / 3) + i) % 3 === 0) return
      set(sx, sy, 0xffffff); set(sx - 1, sy, 0xfff3b0); set(sx + 1, sy, 0xfff3b0); set(sx, sy - 1, 0xfff3b0); set(sx, sy + 1, 0xfff3b0)
    })
  }

  // the floating text: rises from the pet and fades
  const text = float?.text ?? (task?.phase === 'wait' && !dead ? '?' : undefined)
  if (text) {
    const age = float?.age ?? 0
    const glyphs = [...text].map(ch => FONT[ch]).filter(Boolean)
    const width = glyphs.reduce((n, g) => n + g[0].length + 1, -1)
    let x = clamp(cx - (width >> 1), 0, Math.max(0, W - width))
    const y = Math.max(0, petY - 7 - Math.floor(age / 4))
    const alpha = float ? Math.min(1, (36 - age) / 10) : frame % 8 < 5 ? 1 : 0.4
    const ink = day > 0.5 && t < 0.5 ? 0x3a1f5c : 0xfff3b0
    glyphs.forEach(g => {
      g.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') mix(x + c, y + r, ink, alpha) }))
      x += g[0].length + 1
    })
  }

  return px
}

/** Half-block cells for a terminal Raster: top pixel as foreground, bottom as background. */
export const toCells = (px: Uint32Array, W: number, PH: number): string => {
  const rows = PH >> 1
  const out = new Uint32Array(W * rows * 3)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < W; c++) {
      out[i++] = 0x2580
      out[i++] = px[2 * r * W + c]
      out[i++] = px[(2 * r + 1) * W + c]
    }
  }
  return new Uint8Array(out.buffer).toBase64()
}

/** The same buffer as run-length SVG rects, for the surfaces with no Raster. */
export const toSvg = (px: Uint32Array, W: number, PH: number): string => {
  const rects: string[] = []
  for (let y = 0; y < PH; y++) {
    let x = 0
    while (x < W) {
      const c = px[y * W + x]
      let n = 1
      while (x + n < W && px[y * W + x + n] === c) n++
      rects.push(`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${hex(c)}"/>`)
      x += n
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${PH}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
