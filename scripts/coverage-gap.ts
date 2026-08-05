import { readFileSync } from 'node:fs'

// Reads vitest v8 coverage JSON and prints uncovered statements/branches
// with their real source line numbers.
const data = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'))

for (const [key, file] of Object.entries(data) as any[]) {
  if (!key.includes('room-do') && !key.includes('schema.ts')) continue

  const sm = file.statementMap
  const uncovered: number[] = []
  for (const [id, count] of Object.entries<number>(file.s)) {
    if (count === 0 && sm[id]) {
      uncovered.push(sm[id].start.line)
    }
  }

  const bm = file.branchMap
  const bUncovered: number[] = []
  for (const [id, counts] of Object.entries<number[]>(file.b)) {
    const idx = counts.findIndex((c) => c === 0)
    if (idx !== -1 && bm[id]) {
      const loc = bm[id].locations[idx] ?? bm[id].loc
      bUncovered.push(loc?.start.line ?? Number(id))
    }
  }

  const fm = file.fnMap
  const fUncovered: number[] = []
  for (const [id, count] of Object.entries<number>(file.f)) {
    if (count === 0 && fm[id]) {
      fUncovered.push(fm[id].loc.start.line)
    }
  }

  console.log(key.replace(/\\/g, '/'))
  console.log('  statements uncovered:', [...new Set(uncovered)].join(','))
  console.log('  branches uncovered:', [...new Set(bUncovered)].join(','))
  console.log('  functions uncovered:', [...new Set(fUncovered)].join(','))
}
