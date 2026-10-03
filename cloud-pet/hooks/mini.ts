// The one-line pet: Clawd as the app draws him on a fresh session (flat orange block, square eyes,
// stubby arms, four legs), doing a small thing. Each act is a pure function of the frame, drawn on a
// 20x10 pixel grid and handed out as an SVG a text line can carry.

import type { Mood, TaskPhase } from './scene'

export type MiniAct = 'fish' | 'read' | 'coffee' | 'sleep' | 'dance' | 'look' | 'laptop' | 'wave' | 'think' | 'cheer' | 'sad' | 'dizzy' | 'dead'

/** What he does when nothing is going on: one after another, about half a minute each. */
export const IDLE: MiniAct[] = ['fish', 'read', 'coffee', 'look', 'dance', 'sleep']
const IDLE_FRAMES = 200

export const MINI_W = 20
export const MINI_H = 10

const COLOR: Record<string, string> = {
  O: '#d97757', // body
  E: '#a8553b', // shut lid
  K: '#1c1210', // eyes
  G: '#9a9a9a',
  D: '#5c5c5c',
  W: '#f2f2f2',
  L: '#7fd0ff',
  N: '#3a78c8',
  Y: '#ffd34d',
  R: '#ff5d5d',
  Z: '#c9b6ff',
  P: '#f0a08a',
  T: '#8b5a3c',
}

type Grid = string[][]
type Eyes = 'open' | 'blink' | 'shut' | 'happy' | 'x' | 'down' | 'left' | 'right'
type Arm = 'down' | 'mid' | 'up' | 'none'

const BX = 6 // body's left column
const BY = 2 // body's top row

const blank = (): Grid => Array.from({ length: MINI_H }, () => Array<string>(MINI_W).fill('.'))
const put = (g: Grid, r: number, c: number, ch: string) => { if (g[r]?.[c] !== undefined) g[r][c] = ch }
const rect = (g: Grid, r: number, c: number, h: number, w: number, ch: string) => {
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) put(g, r + i, c + j, ch)
}

/** Clawd himself. dy lifts the whole body (a jump), arms are drawn by the act that needs them. */
const clawd = (g: Grid, o: { eyes?: Eyes; dy?: number; armL?: Arm; armR?: Arm }) => {
  const dy = o.dy ?? 0
  const top = BY + dy
  rect(g, top, BX, 6, 8, 'O')
  ;[0, 2, 5, 7].forEach(c => rect(g, top + 6, BX + c, 2, 1, 'O'))

  const eyeRow = top + 2
  const at = (a: number, b: number, ch: string) => { put(g, eyeRow, BX + a, ch); put(g, eyeRow, BX + b, ch) }
  const both = (fn: (c: number) => void) => [BX + 1, BX + 6].forEach(fn)
  switch (o.eyes ?? 'open') {
    case 'open': at(1, 6, 'K'); break
    case 'left': at(0, 5, 'K'); break
    case 'right': at(2, 7, 'K'); break
    case 'down': put(g, eyeRow + 1, BX + 1, 'K'); put(g, eyeRow + 1, BX + 6, 'K'); break
    case 'shut': at(1, 6, 'E'); break
    case 'blink': break
    case 'happy': both(c => { put(g, eyeRow - 1, c, 'K'); put(g, eyeRow, c - 1, 'K'); put(g, eyeRow, c + 1, 'K') }); break
    case 'x': both(c => { put(g, eyeRow - 1, c - 1, 'K'); put(g, eyeRow - 1, c + 1, 'K'); put(g, eyeRow, c, 'K'); put(g, eyeRow + 1, c - 1, 'K'); put(g, eyeRow + 1, c + 1, 'K') }); break
  }

  const arm = (side: 'L' | 'R', a: Arm) => {
    if (a === 'none') return
    const c = side === 'L' ? BX - 2 : BX + 8
    const r = { down: top + 3, mid: top + 2, up: top }[a]
    rect(g, r, c, 2, 2, 'O')
  }
  arm('L', o.armL ?? 'down')
  arm('R', o.armR ?? 'down')
}

const ACTS: Record<MiniAct, (g: Grid, t: number) => void> = {
  // rod in the raised left hand, a bobber on the water; now and then a bite
  fish(g, t) {
    const bite = t % 40 >= 34
    clawd(g, { armL: 'mid', eyes: bite ? 'happy' : t % 14 === 0 ? 'blink' : 'left' })
    const tip = bite ? 1 : 0
    ;[[3, 3], [2, 2], [1, 1]].forEach(([r, c]) => put(g, r, c, 'G'))
    put(g, tip, 0, 'G')
    for (let r = tip + 1; r < 7; r++) put(g, r, 0, 'W')
    const bob = bite ? 8 : 7 + (Math.floor(t / 4) % 2)
    put(g, bob, 0, 'R')
    rect(g, 8, 0, 2, 5, 'N')
    for (let c = 0; c < 5; c++) if ((c + Math.floor(t / 3)) % 3 === 0 && !(bob === 8 && c === 0)) put(g, 8, c, 'L')
    if (bite) { put(g, 0, BX + 4, 'Y'); put(g, 1, BX + 4, 'Y') }
  },
  // a book held open, eyes going line by line, a page turned every so often
  read(g, t) {
    clawd(g, { armL: 'mid', armR: 'mid', eyes: Math.floor(t / 3) % 3 === 2 ? 'blink' : 'open' })
    rect(g, BY + 4, BX + 1, 2, 7, 'W')
    put(g, BY + 4, BX + 4, 'G'); put(g, BY + 5, BX + 4, 'G')
    const line = Math.floor(t / 3) % 2
    ;[BX + 2, BX + 3, BX + 5, BX + 6].forEach(c => put(g, BY + 4 + line, c, 'D'))
    if (t % 16 >= 14) rect(g, BY + 4, BX + 5, 2, 3, 'G') // a page turns
  },
  // a mug, steam curling up, a sip now and then
  coffee(g, t) {
    const sip = t % 30 >= 24
    clawd(g, { armR: 'none', eyes: sip ? 'shut' : 'open' })
    const lift = sip ? -1 : 0
    rect(g, BY + 5, BX + 8, 2, 2, 'O')
    rect(g, BY + 2 + lift, BX + 8, 2, 2, 'W')
    put(g, BY + 2 + lift, BX + 10, 'W')
    put(g, BY + 3 + lift, BX + 10, 'W')
    rect(g, BY + 4 + lift, BX + 8, 1, 2, 'O')
    put(g, BY + 3 + lift - 2 - (Math.floor(t / 3) % 2), BX + 8 + (Math.floor(t / 6) % 2), 'G')
  },
  // eyes shut, the z's float up
  sleep(g, t) {
    clawd(g, { eyes: 'shut' })
    const n = Math.floor(t / 4) % 4
    if (n >= 1) put(g, 4, 16, 'Z')
    if (n >= 2) { put(g, 2, 17, 'Z'); put(g, 2, 18, 'Z') }
    if (n >= 3) { put(g, 0, 18, 'Z'); put(g, 0, 19, 'Z') }
  },
  // glances about the room
  look(g, t) {
    const seq: Eyes[] = ['open', 'left', 'left', 'open', 'right', 'right', 'open', 'blink']
    clawd(g, { eyes: seq[Math.floor(t / 5) % seq.length] })
  },
  // bounces to a tune
  dance(g, t) {
    const up = t % 2 === 0
    clawd(g, { eyes: 'happy', dy: up ? -1 : 0, armL: up ? 'up' : 'down', armR: up ? 'down' : 'up' })
    put(g, 1 + (Math.floor(t / 2) % 2), 2, 'Y')
    put(g, 0 + (Math.floor(t / 2) % 2), 17, 'Y')
  },
  // at a laptop, typing: the screen scrolls, one hand then the other
  laptop(g, t) {
    clawd(g, { eyes: 'right', armR: 'none' })
    rect(g, 3, 15, 4, 5, 'G')
    rect(g, 4, 16, 2, 3, 'L')
    for (let r = 4; r < 6; r++) for (let c = 16; c < 19; c++) if ((t * 3 + r * 5 + c * 7) % 5 < 2) put(g, r, c, 'W')
    rect(g, 7, 13, 1, 7, 'D')
    rect(g, BY + 3 + (t % 2), BX + 8, 2, 2, 'O')
    put(g, BY + 5 - (t % 2), BX + 9, 'O')
  },
  // a hand up for the person, an alarm over his head
  wave(g, t) {
    const hi = t % 2 === 0
    clawd(g, { eyes: 'open', armR: hi ? 'up' : 'mid' })
    put(g, 0, 4, 'Y'); put(g, 1, 4, 'Y')
    if (t % 4 < 2) { put(g, 0, 3, 'Y'); put(g, 1, 5, 'Y') }
  },
  // stuck: looks back, three dots and a bead of sweat
  think(g, t) {
    clawd(g, { eyes: 'left' })
    const n = Math.floor(t / 4) % 4
    for (let i = 0; i < n; i++) put(g, 0 + (i % 2), 15 + i * 2, 'G')
    put(g, 3 + (Math.floor(t / 3) % 3), BX + 8, 'L')
  },
  // turn finished: arms up, jumping, confetti
  cheer(g, t) {
    clawd(g, { eyes: 'happy', dy: t % 2 === 0 ? -1 : 0, armL: 'up', armR: 'up' })
    const pal = ['R', 'Y', 'L', 'Z', 'P']
    for (let i = 0; i < 6; i++) put(g, (t + i * 3) % 4, (i * 4 + t) % 20, pal[(i + t) % pal.length])
  },
  // low weather: eyes down, tears
  sad(g, t) {
    clawd(g, { eyes: 'down', armL: 'down', armR: 'down' })
    ;[BX + 1, BX + 6].forEach((c, i) => put(g, BY + 4 + ((Math.floor(t / 2) + i * 2) % 3), c, 'L'))
  },
  // the turn failed: stars circle his head
  dizzy(g, t) {
    clawd(g, { eyes: 'x' })
    const spots = [[0, 5], [0, 9], [0, 13], [1, 9]]
    put(g, spots[t % 4][0], spots[t % 4][1], 'Y')
    put(g, spots[(t + 2) % 4][0], spots[(t + 2) % 4][1], 'Y')
  },
}

/** Out of limit: belly up, legs in the air. */
const dead = (g: Grid) => {
  const up = blank()
  clawd(up, { eyes: 'x' })
  up.reverse()
  up.splice(0, 2)
  up.push(Array(MINI_W).fill('.'), Array(MINI_W).fill('.'))
  g.forEach((row, r) => row.splice(0, MINI_W, ...up[r]))
}

/** What he is up to, from what the pet itself shows. */
export const miniAct = (phase: TaskPhase | undefined, mood: Mood, frame: number): MiniAct => {
  if (mood === 'dead') return 'dead'
  if (phase === 'work') return 'laptop'
  if (phase === 'wait') return 'wave'
  if (phase === 'stuck') return 'think'
  if (phase === 'done' || mood === 'cheer') return 'cheer'
  if (phase === 'fail' || mood === 'dizzy') return 'dizzy'
  if (mood === 'sad' || mood === 'cry') return 'sad'

  return IDLE[Math.floor(frame / IDLE_FRAMES) % IDLE.length]
}

/** One frame, at 3 css px per art px (60x30). */
export const miniSvg = (act: MiniAct, frame: number): string => {
  const g = blank()
  if (act === 'dead') dead(g)
  else ACTS[act](g, Math.floor(frame / 2))
  const rects = g.flatMap((row, y) => {
    const out: string[] = []
    for (let x = 0; x < MINI_W;) {
      const ch = row[x]
      let n = 1
      while (x + n < MINI_W && row[x + n] === ch) n++
      if (COLOR[ch]) out.push(`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${COLOR[ch]}"/>`)
      x += n
    }
    return out
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MINI_W} ${MINI_H}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
