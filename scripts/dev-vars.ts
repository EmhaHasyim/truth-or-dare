// Shared helpers for loading `.dev.vars` in dotenv-style format.
// Used by `drizzle.config.ts` (dev tooling) and `scripts/sync-secrets.ts`
// (deploy-time secret sync).
//
// Parsing rules mirror wrangler's own parser (it uses the `dotenv` package):
//   - lines starting with `#` are comments
//   - `KEY=VALUE`, everything after the first `=` is the value
//   - surrounding `"` / `'` quotes are stripped
//   - inline ` # comment` (whitespace before `#`) is stripped when unquoted
import { readFileSync } from 'node:fs'

export interface DevVar {
  key: string
  value: string
}

/** Parse a dotenv-style value the way wrangler/dotenv does. */
function parseValue(rawValue: string): string {
  let value = rawValue.trimStart()

  // Quoted value ("..." or '...') → strip the surrounding quotes.
  const first = value[0]
  if (first === '"' || first === "'") {
    const close = value.indexOf(first, 1)
    if (close !== -1) {
      return value.slice(1, close).trimEnd()
    }
  }

  // Unquoted: strip an inline comment (` # ...`), like dotenv does.
  const comment = value.match(/\s+#/)
  if (comment?.index !== undefined) {
    value = value.slice(0, comment.index)
  }

  return value.trimEnd()
}

/** Parse a dotenv-style `.dev.vars` file into key/value pairs. */
export function parseDevVars(filePath = '.dev.vars'): DevVar[] {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  const vars: DevVar[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    vars.push({ key, value: parseValue(line.slice(eq + 1)) })
  }
  return vars
}

/** Load `.dev.vars` into `process.env`, only for keys not already set. */
export function loadDevVarsIntoEnv(filePath = '.dev.vars'): void {
  for (const { key, value } of parseDevVars(filePath)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
