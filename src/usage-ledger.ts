/**
 * Per-request usage ledger for the WorkBuddy upstream.
 *
 * ## Why this module exists
 *
 * The upstream SSE stream carries a final chunk whose `usage` object holds both
 * the exact token split (`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 * / `completion_tokens`) and the account's **real** billed `credit`. That is the
 * only place in the whole stack where both are visible at once:
 *
 * - pi-ai parses the stream but keeps only normalised `input`/`output`/`cacheRead`
 *   and **drops `credit`**, so DSH sessions never see the billed value;
 * - DSH session files do not persist usage at all;
 * - the web console only offers a 3000-row export, capped and range-cached.
 *
 * Recording here therefore yields *measured* numbers rather than a conversion.
 *
 * ## Two facts that shape the design
 *
 * 1. `credit` is rounded to 2 decimals by the upstream, so a small request bills
 *    `0`. Summing per-request credits therefore *under*-reports; the ledger keeps
 *    the exact token counters alongside so token totals stay exact and credit can
 *    be reconciled against a balance reading.
 * 2. The same response is only ever written once per completed request, and the
 *    upstream may stream for minutes, so records are appended on stream end.
 *
 * ## Storage
 *
 * Newline-delimited JSON, one record per request, appended atomically per line
 * (`O_APPEND` semantics via a serialised write queue). Records are **never**
 * removed automatically — compaction happens only when a human selects a date
 * range in the UI, and even then the raw detail is kept unless explicitly purged.
 *
 * @module dsh-workbuddy-connect/usage-ledger
 */

import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Which upstream account served a request. */
export type LedgerRegion = 'cn' | 'global'

/** One completed chat request, as observed at the shim boundary. */
export interface UsageRecord {
  /** ISO-8601 instant the request completed. */
  at: string
  /** Upstream account the request was billed to. */
  region: LedgerRegion
  /** Account uid, so multiple sign-ins stay distinguishable. */
  uid: string
  /** Model id exactly as sent upstream. */
  model: string
  /** Total prompt tokens as reported upstream. */
  prompt: number
  /** Prompt tokens served from cache (billed far cheaper). */
  cacheHit: number
  /** Prompt tokens that missed cache (billed at full rate). */
  cacheMiss: number
  /** Generated tokens, reasoning included (upstream already counts it in). */
  completion: number
  /** Reasoning tokens, when the upstream reports them separately. */
  reasoning: number
  /** Billed credits for this single request, upstream's own number (2 dp). */
  credit: number
  /** Wall-clock duration of the stream, milliseconds. */
  ms: number
  /** Whether the request completed with a `[DONE]` sentinel. */
  done: boolean
}

/** Aggregate over a set of records. */
export interface UsageTotals {
  requests: number
  prompt: number
  cacheHit: number
  cacheMiss: number
  completion: number
  reasoning: number
  credit: number
}

/** One day of aggregates, as served to the UI. */
export interface UsageDay extends UsageTotals {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
}

const EMPTY_TOTALS: UsageTotals = {
  requests: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, reasoning: 0, credit: 0,
}

/** Sum a list of records. */
export function sumRecords(records: readonly UsageRecord[]): UsageTotals {
  const total = { ...EMPTY_TOTALS }
  for (const r of records) {
    total.requests += 1
    total.prompt += r.prompt
    total.cacheHit += r.cacheHit
    total.cacheMiss += r.cacheMiss
    total.completion += r.completion
    total.reasoning += r.reasoning
    total.credit += r.credit
  }
  return total
}

/** Local calendar day (`YYYY-MM-DD`) for an ISO instant, in the host's zone. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Extract the usage-bearing chunk from a raw SSE text fragment.
 *
 * The upstream emits one chunk carrying `usage` (with the billed `credit`)
 * immediately before `[DONE]`. Fragments arrive split across TCP reads, so the
 * caller feeds arbitrary text and this returns whatever complete `data:` lines
 * it can parse; `rest` carries the trailing partial line forward.
 */
export interface SseScan {
  /** Usage objects found in this fragment, in order. */
  usages: Record<string, unknown>[]
  /** Whether a `[DONE]` sentinel was seen. */
  done: boolean
  /** Incomplete trailing line to prepend to the next fragment. */
  rest: string
}

/** Parse the `data:` lines of one SSE fragment without retaining content. */
export function scanSse(fragment: string, carry = ''): SseScan {
  const text = carry + fragment
  const usages: Record<string, unknown>[] = []
  let done = false
  let cursor = 0
  let newline = text.indexOf('\n')
  while (newline >= 0) {
    const line = text.slice(cursor, newline).trim()
    cursor = newline + 1
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        done = true
      } else if (payload.length > 0) {
        try {
          const parsed: unknown = JSON.parse(payload)
          if (typeof parsed === 'object' && parsed !== null) {
            const usage = (parsed as { usage?: unknown }).usage
            if (typeof usage === 'object' && usage !== null) usages.push(usage as Record<string, unknown>)
          }
        } catch {
          // A malformed chunk is not worth failing a request over.
        }
      }
    }
    newline = text.indexOf('\n', cursor)
  }
  return { usages, done, rest: text.slice(cursor) }
}

/** Read a numeric field that may arrive under any of several upstream spellings. */
function num(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

/** Build a record from the last usage object a stream produced. */
export function recordFrom(usage: Record<string, unknown>, context: {
  at: string
  region: LedgerRegion
  uid: string
  model: string
  ms: number
  done: boolean
}): UsageRecord {
  const prompt = num(usage, 'prompt_tokens', 'input_tokens')
  const cacheHit = num(usage, 'prompt_cache_hit_tokens', 'cache_read_input_tokens', 'cached_tokens')
  const cacheMissRaw = num(usage, 'prompt_cache_miss_tokens')
  // Prefer the upstream's explicit miss counter; otherwise derive it, and never
  // report a negative remainder if a provider over-reports its cache reads.
  const cacheMiss = cacheMissRaw > 0 ? cacheMissRaw : Math.max(0, prompt - cacheHit)
  const completion = num(usage, 'completion_tokens', 'output_tokens')
  const details = usage['completion_tokens_details']
  const reasoning = typeof details === 'object' && details !== null
    ? num(details as Record<string, unknown>, 'reasoning_tokens')
    : num(usage, 'completion_thinking_tokens', 'reasoning_tokens')
  return {
    at: context.at,
    region: context.region,
    uid: context.uid,
    model: context.model,
    prompt,
    cacheHit,
    cacheMiss,
    completion,
    reasoning,
    credit: num(usage, 'credit'),
    ms: Math.max(0, Math.round(context.ms)),
    done: context.done,
  }
}

/** Options for {@link UsageLedger}. */
export interface UsageLedgerOptions {
  /** Directory the ledger files live in (the plugin's `state/` dir). */
  dir: string
  /** Clock injection for tests. */
  now?: () => Date
  /** Sink for ledger failures; a full disk must not break chat. */
  onError?: (error: unknown) => void
}

/**
 * Append-only usage ledger.
 *
 * Every write is serialised through one promise chain, so concurrent requests
 * cannot interleave partial lines. Failures are reported to `onError` and
 * swallowed: losing a statistics line must never fail a chat request.
 */
export class UsageLedger {
  private readonly dir: string
  private readonly file: string
  private readonly now: () => Date
  private readonly onError: (error: unknown) => void
  private queue: Promise<void> = Promise.resolve()
  private ready: Promise<void> | undefined

  constructor(options: UsageLedgerOptions) {
    this.dir = options.dir
    this.file = join(options.dir, 'usage-ledger.ndjson')
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError ?? (() => {})
  }

  /** Path of the detail file. */
  get path(): string {
    return this.file
  }

  /** Ensure the directory exists exactly once. */
  private async ensure(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined)
    await this.ready
  }

  /** Timestamp the ledger stamps records with. */
  stamp(): string {
    return this.now().toISOString()
  }

  /** Append one record; resolves once it is on disk. Never throws. */
  append(record: UsageRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n'
    this.queue = this.queue
      .then(() => this.ensure())
      .then(() => appendFile(this.file, line, 'utf8'))
      .catch((error: unknown) => {
        this.onError(error)
      })
    return this.queue
  }

  /**
   * Wait for every queued write to settle.
   *
   * Callers that remove the ledger directory (tests, `compact`, a profile
   * teardown) must await this first: a pending `mkdir`/`appendFile` holds a
   * handle on the directory, and deleting it underneath the queue fails with
   * `EBUSY` on Windows.
   */
  async idle(): Promise<void> {
    // The queue may grow while we await it, so loop until it stops changing.
    for (;;) {
      const pending = this.queue
      await pending
      if (pending === this.queue) return
    }
  }

  /** Read every record; malformed lines are skipped, not fatal. */
  async read(): Promise<UsageRecord[]> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      this.onError(error)
      return []
    }
    const out: UsageRecord[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        out.push(JSON.parse(trimmed) as UsageRecord)
      } catch {
        // A torn line is dropped rather than failing the whole read.
      }
    }
    return out
  }

  /** Records within an inclusive local-day range (`from`/`to` as `YYYY-MM-DD`). */
  async between(from: string, to: string): Promise<UsageRecord[]> {
    const all = await this.read()
    if (from === '' && to === '') return all
    return all.filter((r) => {
      const day = localDay(r.at)
      if (from !== '' && day < from) return false
      if (to !== '' && day > to) return false
      return true
    })
  }

  /** Per-day aggregates across every stored record. */
  async daily(): Promise<UsageDay[]> {
    const byDay = new Map<string, UsageRecord[]>()
    for (const record of await this.read()) {
      const day = localDay(record.at)
      const bucket = byDay.get(day)
      if (bucket === undefined) byDay.set(day, [record])
      else bucket.push(record)
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, records]) => ({ day, ...sumRecords(records) }))
  }

  /** Size of the detail file in bytes, for the UI's storage readout. */
  async size(): Promise<number> {
    try {
      return (await stat(this.file)).size
    } catch {
      return 0
    }
  }

  /**
   * Fold a day range into one summary record and drop the detail lines it
   * covers. Only ever called from an explicit human action; the summary is
   * written to a sibling file so the purge is auditable.
   */
  async compact(from: string, to: string, purge: boolean): Promise<{ folded: UsageTotals; purged: boolean }> {
    const all = await this.read()
    const keep: UsageRecord[] = []
    const covered: UsageRecord[] = []
    for (const record of all) {
      const day = localDay(record.at)
      if ((from === '' || day >= from) && (to === '' || day <= to)) covered.push(record)
      else keep.push(record)
    }
    const folded = sumRecords(covered)
    const summary = {
      at: this.stamp(),
      from: from === '' ? (covered[0]?.at ?? '') : from,
      to: to === '' ? (covered.at(-1)?.at ?? '') : to,
      ...folded,
    }
    await this.ensure()
    await appendFile(join(this.dir, 'usage-rollup.ndjson'), JSON.stringify(summary) + '\n', 'utf8')
    if (purge && keep.length !== all.length) {
      const temp = `${this.file}.compact`
      await writeFile(temp, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length > 0 ? '\n' : ''), 'utf8')
      await rename(temp, this.file)
    }
    return { folded, purged: purge && keep.length !== all.length }
  }

  /** Stored rollups, newest last. */
  async rollups(): Promise<unknown[]> {
    try {
      const raw = await readFile(join(this.dir, 'usage-rollup.ndjson'), 'utf8')
      return raw.split('\n').filter((l) => l.trim() !== '').flatMap((l) => {
        try {
          return [JSON.parse(l) as unknown]
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  }

  /** Delete the detail file (explicit purge only). */
  async clear(): Promise<void> {
    try {
      await unlink(this.file)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(error)
    }
  }

  /** Directory listing helper used by tests and the CLI. */
  static async files(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((f) => f.startsWith('usage-'))
    } catch {
      return []
    }
  }
}

/**
 * Wrap an SSE byte stream so it is both forwarded untouched and scanned for the
 * billing figures.
 *
 * Returns the same chunk stream the caller would have piped, plus a promise that
 * resolves with the record once the stream ends. Reading is done on a *clone* of
 * each chunk, so the forwarded bytes are byte-identical to the upstream's.
 */
export interface UsageTap {
  /** Digest one forwarded chunk; returns nothing, retains only counters. */
  push(chunk: Buffer): void
  /** Note that the downstream gave up (client abort). */
  abort(): void
  /** Finish and produce the record if any usage was seen. */
  finish(): UsageRecord | undefined
}

/** Create a tap that accumulates usage across one SSE stream. */
export function createUsageTap(context: {
  startedAt: number
  now: () => Date
  region: LedgerRegion
  uid: string
  model: string
}): UsageTap {
  let carry = ''
  let last: Record<string, unknown> | undefined
  let done = false
  let ended = false
  return {
    push(chunk: Buffer): void {
      if (ended) return
      const scan = scanSse(chunk.toString('utf8'), carry)
      carry = scan.rest
      if (scan.done) done = true
      if (scan.usages.length > 0) last = scan.usages[scan.usages.length - 1]
    },
    abort(): void {
      ended = true
    },
    finish(): UsageRecord | undefined {
      if (ended || last === undefined) return undefined
      ended = true
      return recordFrom(last, {
        at: context.now().toISOString(),
        region: context.region,
        uid: context.uid,
        model: context.model,
        ms: Date.now() - context.startedAt,
        done,
      })
    },
  }
}

/** Extract the upstream `model` string from a prepared chat body, if present. */
export function modelOf(bodyJson: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyJson)
    if (typeof parsed === 'object' && parsed !== null) {
      const model = (parsed as { model?: unknown }).model
      if (typeof model === 'string') return model
    }
  } catch {
    // fall through
  }
  return 'unknown'
}
