export type SaveMessage = { ok: boolean; text: string } | null

/** The result of a save, announced to screen readers. */
export function SaveStatus({ message }: { message: SaveMessage }) {
  return (
    <p role="status" className={message?.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
      {message?.text}
    </p>
  )
}
