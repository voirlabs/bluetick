// Minimal structured logger. Never pass message content or phone numbers here:
// logs end up in hosting dashboards that are not access-controlled like the DB.
type Fields = Record<string, string | number | boolean | null | undefined>

function write(level: 'info' | 'warn' | 'error', scope: string, msg: string, fields?: Fields) {
  const line = JSON.stringify({ level, scope, msg, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function logger(scope: string) {
  return {
    info: (msg: string, fields?: Fields) => write('info', scope, msg, fields),
    warn: (msg: string, fields?: Fields) => write('warn', scope, msg, fields),
    error: (msg: string, err?: unknown, fields?: Fields) =>
      write('error', scope, msg, {
        ...fields,
        error: err instanceof Error ? err.message : err === undefined ? undefined : String(err),
      }),
  }
}
