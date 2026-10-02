import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UsageLedger,
  createUsageTap,
  localDay,
  modelOf,
  recordFrom,
  scanSse,
  sumRecords,
  type UsageRecord,
} from '../src/usage-ledger.ts'

/** Build one SSE chunk line carrying a usage object. */
function usageChunk(usage: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ id: 'x', choices: [{ delta: {} }], usage })}\n\n`
}

/** A realistic upstream usage object (CN, deepseek-v4.1-flash). */
const CN_USAGE = {
  prompt_tokens: 40008,
  completion_tokens: 1,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: 40008,
  credit: 1.14,
}

describe('scanSse', () => {
  it('pulls the usage object out of a chunk', () => {
    const scan = scanSse(usageChunk(CN_USAGE))
    expect(scan.usages).toHaveLength(1)
    expect(scan.usages[0]!['credit']).toBe(1.14)
    expect(scan.done).toBe(false)
  })

  it('sees the [DONE] sentinel', () => {
    const scan = scanSse('data: [DONE]\n\n')
    expect(scan.done).toBe(true)
    expect(scan.usages).toHaveLength(0)
  })

  it('carries an incomplete trailing line into the next fragment', () => {
    const whole = usageChunk(CN_USAGE)
    const cut = Math.floor(whole.length / 2)
    const first = scanSse(whole.slice(0, cut))
    expect(first.usages).toHaveLength(0)
    expect(first.rest.length).toBeGreaterThan(0)
    // Feeding the remainder with the carry recovers the chunk.
    const second = scanSse(whole.slice(cut), first.rest)
    expect(second.usages).toHaveLength(1)
    expect(second.usages[0]!['credit']).toBe(1.14)
  })

  it('keeps the LAST usage when several appear (summary chunk wins)', () => {
    const text = usageChunk({ prompt_tokens: 1, credit: 0 }) + usageChunk(CN_USAGE)
    const scan = scanSse(text)
    expect(scan.usages).toHaveLength(2)
    expect(scan.usages.at(-1)!['credit']).toBe(1.14)
  })

  it('survives malformed JSON without throwing', () => {
    const scan = scanSse('data: {not json\n\ndata: [DONE]\n\n')
    expect(scan.usages).toHaveLength(0)
    expect(scan.done).toBe(true)
  })

  it('ignores non-data lines (comments, blank lines, keepalives)', () => {
    const scan = scanSse(': keepalive\n\nevent: ping\n\ndata: [DONE]\n\n')
    expect(scan.usages).toHaveLength(0)
    expect(scan.done).toBe(true)
  })
})

describe('recordFrom', () => {
  const ctx = { at: '2026-10-02T03:00:00.000Z', region: 'cn' as const, uid: 'u1', model: 'deepseek-v4.1-flash', ms: 1234, done: true }

  it('maps the CN field names', () => {
    const r = recordFrom(CN_USAGE, ctx)
    expect(r).toMatchObject({
      region: 'cn', uid: 'u1', model: 'deepseek-v4.1-flash',
      prompt: 40008, cacheHit: 0, cacheMiss: 40008, completion: 1, credit: 1.14, done: true,
    })
  })

  it('derives cacheMiss when the upstream omits the miss counter', () => {
    const r = recordFrom({ prompt_tokens: 100, prompt_cache_hit_tokens: 80, completion_tokens: 5, credit: 0.2 }, ctx)
    expect(r.cacheMiss).toBe(20)
  })

  it('never reports a negative miss when cache reads exceed the prompt count', () => {
    const r = recordFrom({ prompt_tokens: 10, prompt_cache_hit_tokens: 999, completion_tokens: 1 }, ctx)
    expect(r.cacheMiss).toBe(0)
  })

  it('reads reasoning tokens from completion_tokens_details', () => {
    const r = recordFrom({
      prompt_tokens: 10, completion_tokens: 50, credit: 0.1,
      completion_tokens_details: { reasoning_tokens: 40 },
    }, ctx)
    expect(r.reasoning).toBe(40)
  })

  it('falls back to a top-level thinking counter', () => {
    const r = recordFrom({ prompt_tokens: 10, completion_tokens: 50, completion_thinking_tokens: 7 }, ctx)
    expect(r.reasoning).toBe(7)
  })

  it('accepts numeric strings', () => {
    const r = recordFrom({ prompt_tokens: '12', completion_tokens: '3', credit: '0.05' }, ctx)
    expect(r).toMatchObject({ prompt: 12, completion: 3, credit: 0.05 })
  })

  it('treats missing fields as zero rather than NaN', () => {
    const r = recordFrom({}, ctx)
    expect(r).toMatchObject({ prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, reasoning: 0, credit: 0 })
  })
})

describe('createUsageTap', () => {
  const context = { startedAt: Date.now() - 500, now: () => new Date('2026-10-02T03:00:00.000Z'), region: 'cn' as const, uid: 'u1', model: 'm' }

  it('produces a record once the stream ends', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from(usageChunk(CN_USAGE), 'utf8'))
    tap.push(Buffer.from('data: [DONE]\n\n', 'utf8'))
    const record = tap.finish()
    expect(record).toBeDefined()
    expect(record!.credit).toBe(1.14)
    expect(record!.done).toBe(true)
    expect(record!.ms).toBeGreaterThan(0)
  })

  it('handles a usage chunk split across chunk boundaries', () => {
    const whole = Buffer.from(usageChunk(CN_USAGE) + 'data: [DONE]\n\n', 'utf8')
    const tap = createUsageTap(context)
    for (let i = 0; i < whole.length; i += 7) tap.push(whole.subarray(i, i + 7))
    const record = tap.finish()
    expect(record?.credit).toBe(1.14)
    expect(record?.done).toBe(true)
  })

  it('returns nothing when the stream carried no usage', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'utf8'))
    expect(tap.finish()).toBeUndefined()
  })

  it('returns nothing after an abort (client gave up)', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from(usageChunk(CN_USAGE), 'utf8'))
    tap.abort()
    expect(tap.finish()).toBeUndefined()
  })

  it('does not double-report when finished twice', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from(usageChunk(CN_USAGE), 'utf8'))
    expect(tap.finish()).toBeDefined()
    expect(tap.finish()).toBeUndefined()
  })

  it('ignores chunks pushed after finish', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from(usageChunk(CN_USAGE), 'utf8'))
    tap.finish()
    tap.push(Buffer.from(usageChunk({ credit: 99 }), 'utf8'))
    expect(tap.finish()).toBeUndefined()
  })

  it('marks done=false when [DONE] never arrived', () => {
    const tap = createUsageTap(context)
    tap.push(Buffer.from(usageChunk(CN_USAGE), 'utf8'))
    expect(tap.finish()!.done).toBe(false)
  })
})

describe('sumRecords / localDay', () => {
  it('sums every counter', () => {
    const recs = [
      recordFrom({ prompt_tokens: 10, prompt_cache_hit_tokens: 8, completion_tokens: 2, credit: 0.1 }, { at: 'x', region: 'cn', uid: 'u', model: 'm', ms: 1, done: true }),
      recordFrom({ prompt_tokens: 20, prompt_cache_hit_tokens: 0, completion_tokens: 4, credit: 0.5 }, { at: 'x', region: 'cn', uid: 'u', model: 'm', ms: 1, done: true }),
    ]
    // First record: cacheMiss derives to 2. Second: 20.
    expect(sumRecords(recs)).toMatchObject({ requests: 2, prompt: 30, cacheHit: 8, cacheMiss: 22, completion: 6, credit: 0.6 })
  })

  it('buckets by local calendar day', () => {
    expect(localDay('2026-10-02T03:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(localDay(new Date(2026, 9, 2, 12, 0, 0).toISOString())).toBe('2026-10-02')
  })
})

describe('modelOf', () => {
  it('reads the model from a prepared body', () => {
    expect(modelOf('{"model":"deepseek-v4.1-flash","messages":[]}')).toBe('deepseek-v4.1-flash')
  })
  it('falls back to "unknown" for junk', () => {
    expect(modelOf('not json')).toBe('unknown')
    expect(modelOf('{"nope":1}')).toBe('unknown')
    expect(modelOf('[]')).toBe('unknown')
  })
})

describe('UsageLedger', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'usage-ledger-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const rec = (at: string, credit = 1, prompt = 100): UsageRecord => ({
    at, region: 'cn', uid: 'u1', model: 'deepseek-v4.1-flash',
    prompt, cacheHit: 0, cacheMiss: prompt, completion: 1, reasoning: 0, credit, ms: 10, done: true,
  })

  it('appends and reads back', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec('2026-10-02T01:00:00.000Z', 1.5))
    await ledger.append(rec('2026-10-02T02:00:00.000Z', 2.5))
    const all = await ledger.read()
    expect(all).toHaveLength(2)
    expect(all.map((r) => r.credit)).toEqual([1.5, 2.5])
  })

  it('creates the directory on first write', async () => {
    const nested = join(dir, 'deep', 'state')
    const ledger = new UsageLedger({ dir: nested })
    await ledger.append(rec('2026-10-02T01:00:00.000Z'))
    expect(await ledger.read()).toHaveLength(1)
  })

  it('reads an absent ledger as empty', async () => {
    const ledger = new UsageLedger({ dir })
    expect(await ledger.read()).toEqual([])
    expect(await ledger.daily()).toEqual([])
    expect(await ledger.size()).toBe(0)
  })

  it('keeps concurrent writes from interleaving (one line each)', async () => {
    const ledger = new UsageLedger({ dir })
    await Promise.all(Array.from({ length: 50 }, (_, i) => ledger.append(rec(`2026-10-02T01:00:${String(i).padStart(2, '0')}.000Z`, i + 1))))
    const raw = await readFile(ledger.path, 'utf8')
    const lines = raw.split('\n').filter((l) => l.trim() !== '')
    expect(lines).toHaveLength(50)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
    expect(await ledger.read()).toHaveLength(50)
  })

  it('skips torn lines instead of failing the read', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec('2026-10-02T01:00:00.000Z'))
    await writeFile(ledger.path, (await readFile(ledger.path, 'utf8')) + '{"at":"broken"\n', 'utf8')
    expect(await ledger.read()).toHaveLength(1)
  })

  it('reports write failures without throwing (a full disk must not break chat)', async () => {
    const onError = vi.fn()
    // A path that cannot be a directory: writing under an existing file fails.
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'x', 'utf8')
    const ledger = new UsageLedger({ dir: join(blocker, 'nested'), onError })
    await expect(ledger.append(rec('2026-10-02T01:00:00.000Z'))).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalled()
  })

  it('groups per day and sorts ascending', async () => {
    const ledger = new UsageLedger({ dir })
    const day1a = new Date(2026, 9, 1, 10, 0, 0).toISOString()
    const day1b = new Date(2026, 9, 1, 18, 0, 0).toISOString()
    const day2 = new Date(2026, 9, 2, 9, 0, 0).toISOString()
    await ledger.append(rec(day1a, 1))
    await ledger.append(rec(day1b, 2))
    await ledger.append(rec(day2, 4))
    const daily = await ledger.daily()
    expect(daily.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02'])
    expect(daily[0]).toMatchObject({ requests: 2, credit: 3 })
    expect(daily[1]).toMatchObject({ requests: 1, credit: 4 })
  })

  it('filters by an inclusive local-day range', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec(new Date(2026, 9, 1, 12).toISOString(), 1))
    await ledger.append(rec(new Date(2026, 9, 2, 12).toISOString(), 2))
    await ledger.append(rec(new Date(2026, 9, 3, 12).toISOString(), 4))
    expect(await ledger.between('2026-10-02', '2026-10-02')).toHaveLength(1)
    expect(await ledger.between('2026-10-01', '2026-10-02')).toHaveLength(2)
    expect(await ledger.between('', '')).toHaveLength(3)
    expect(await ledger.between('2026-10-04', '')).toHaveLength(0)
  })

  it('compacts a range into a rollup without purging by default', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec(new Date(2026, 9, 1, 12).toISOString(), 1))
    await ledger.append(rec(new Date(2026, 9, 2, 12).toISOString(), 2))
    const result = await ledger.compact('2026-10-01', '2026-10-01', false)
    expect(result.folded).toMatchObject({ requests: 1, credit: 1 })
    expect(result.purged).toBe(false)
    expect(await ledger.read()).toHaveLength(2)          // detail retained
    expect(await ledger.rollups()).toHaveLength(1)
  })

  it('purges the folded range only when explicitly asked', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec(new Date(2026, 9, 1, 12).toISOString(), 1))
    await ledger.append(rec(new Date(2026, 9, 2, 12).toISOString(), 2))
    const result = await ledger.compact('2026-10-01', '2026-10-01', true)
    expect(result.purged).toBe(true)
    const left = await ledger.read()
    expect(left).toHaveLength(1)
    expect(left[0]!.credit).toBe(2)
  })

  it('clear() removes the detail file and stays quiet when absent', async () => {
    const ledger = new UsageLedger({ dir })
    await ledger.append(rec('2026-10-02T01:00:00.000Z'))
    await ledger.clear()
    expect(await ledger.read()).toEqual([])
    await expect(ledger.clear()).resolves.toBeUndefined()
  })

  it('exposes the ledger file name for the CLI', async () => {
    const ledger = new UsageLedger({ dir })
    expect(ledger.path.endsWith('usage-ledger.ndjson')).toBe(true)
  })
})
