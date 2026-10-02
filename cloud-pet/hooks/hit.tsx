import type { ClientSurface } from 'claude-code'

// An invisible region laid over the scene: it draws nothing and only reports the
// pointer (hover and click) to the hooks module, in scene px (a cell is 1 px wide, 2 tall).
export default function Hit({ columns, rows }: { columns: number; rows: number }, s: ClientSurface<boolean>) {
  const { Box } = s.elements

  if (s.state === undefined) {
    s.setState(true)
    s.onPointer(e => s.post({
      t: e.type,
      x: e.fine?.x ?? e.x + 0.5,
      y: (e.fine?.y ?? e.y + 0.5) * 2,
    }))
  }

  return <Box width={columns} height={rows} />
}
