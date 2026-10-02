import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WORKBUDDY_USAGE_MAINTENANCE_PATH,
  WORKBUDDY_USAGE_PATH,
} from '../src/usage-paths.ts'
import {
  workBuddyUsageDocument,
  workBuddyUsageHandler,
  workBuddyUsageMaintenanceHandler,
} from '../src/usage-route.ts'
import { UsageLedger, type UsageRecord } from '../src/usage-ledger.ts'

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map((clean) => clean()))
})

const record = (at: string, model = 'deepseek-v4.1-flash', credit = 1, prompt = 100, cacheHit = 80): UsageRecord => ({
  at, region: 'cn', uid: 'u1', model,
  prompt, cacheHit, cacheMiss: prompt - cacheHit,
  completion: 10, reasoning: 0, credit, ms: 50, done: true,
})

async function makeLedger(seed: readonly UsageRecord[]): Promise<UsageLedger> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-usage-route-'))
  const ledger = new UsageLedger({ dir })
  for (const r of seed) await ledger.append(r)
  CLEANUP.push(async () => {
    // Drain pending writes first: a queued append holds a handle on the dir.
    await ledger.idle()
    await rm(dir, { recursive: true, force: true })
  })
  return ledger
}

/** Mount the read + maintenance handlers on a bare server. */
async function mount(opts: { ledger?: UsageLedger, key?: string }): Promise<string> {
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]
    if (url === WORKBUDDY_USAGE_PATH) {
      void workBuddyUsageHandler(opts)(req, res)
      return
    }
    if (url === WORKBUDDY_USAGE_MAINTENANCE_PATH) {
      void workBuddyUsageMaintenanceHandler(opts)(req, res)
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  CLEANUP.push(() => new Promise<void>((resolve) => {
    // `fetch` keeps connections alive by default, and `close()` alone waits for
    // them to drain — so without this, every mounted server lingers for the
    // keep-alive window. The plugin's own shim closes the same way.
    server.close(() => resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return `http://127.0.0.1:${address.port}`
}

/**
 * Raw HTTP request with full header control.
 *
 * `fetch` silently drops a manually-set `Host` header (it is a forbidden
 * header), so the DNS-rebinding guard can only be exercised through a raw
 * socket — the same reason the shim's own spec carries this helper.
 */
function rawRequest(options: {
  port: number
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: options.port,
      method: options.method,
      path: options.path,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

/** GET with a loopback Host header (required by the guard). */
async function get(base: string, query = ''): Promise<{ status: number, body: any }> {
  const response = await fetch(`${base}${WORKBUDDY_USAGE_PATH}${query}`, {
    headers: { host: new URL(base).host },
  })
  return { status: response.status, body: await response.json() }
}

/** POST maintenance with an optional key. */
async function post(base: string, body: unknown, key?: string): Promise<{ status: number, body: any }> {
  const response = await fetch(`${base}${WORKBUDDY_USAGE_MAINTENANCE_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: new URL(base).host,
      ...(key === undefined ? {} : { 'x-workbuddy-key': key }),
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

describe('workBuddyUsageDocument', () => {
  it('aggregates by day and model over the whole ledger', async () => {
    const ledger = await makeLedger([
      record(new Date(2026, 9, 1, 10).toISOString(), 'deepseek-v4.1-flash', 1.5),
      record(new Date(2026, 9, 1, 11).toISOString(), 'glm-5.3', 2.5),
      record(new Date(2026, 9, 2, 9).toISOString(), 'deepseek-v4.1-flash', 4),
    ])
    const doc = await workBuddyUsageDocument({ ledger }, { from: '', to: '' })
    expect(doc.days.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02'])
    expect(doc.days[0]).toMatchObject({ requests: 2, credit: 4 })
    expect(doc.models.map((m) => m.model)).toEqual(['deepseek-v4.1-flash', 'glm-5.3'])
    expect(doc.models[0]).toMatchObject({ requests: 2, credit: 5.5 })
    expect(doc.totals).toMatchObject({ requests: 3, credit: 8 })
    expect(doc.storage.records).toBe(3)
    expect(doc.storage.bytes).toBeGreaterThan(0)
  })

  it('restricts to the requested window', async () => {
    const ledger = await makeLedger([
      record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1),
      record(new Date(2026, 9, 2, 10).toISOString(), 'm', 2),
    ])
    const doc = await workBuddyUsageDocument({ ledger }, { from: '2026-10-02', to: '2026-10-02' })
    expect(doc.days).toHaveLength(1)
    expect(doc.totals.credit).toBe(2)
    // storage always describes the whole ledger, not the window
    expect(doc.storage.records).toBe(2)
  })

  it('reports the cache split and reasoning separately', async () => {
    const ledger = await makeLedger([{ ...record(new Date(2026, 9, 1, 10).toISOString(), 'm', 3, 1000, 960), reasoning: 7 }])
    const doc = await workBuddyUsageDocument({ ledger }, { from: '', to: '' })
    expect(doc.totals).toMatchObject({ prompt: 1000, cacheHit: 960, cacheMiss: 40, completion: 10, reasoning: 7 })
  })

  it('answers unavailable when no ledger is composed', async () => {
    const doc = await workBuddyUsageDocument({}, { from: '', to: '' })
    expect(doc.unavailable).toMatch(/not enabled/)
    expect(doc.days).toEqual([])
    expect(doc.totals.requests).toBe(0)
  })

  it('carries the maintenance key only when one exists', async () => {
    const ledger = await makeLedger([])
    expect((await workBuddyUsageDocument({ ledger }, { from: '', to: '' })).key).toBeUndefined()
    expect((await workBuddyUsageDocument({ ledger, key: 'k' }, { from: '', to: '' })).key).toBe('k')
  })

  it('buckets an empty model string as unknown', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), '')])
    const doc = await workBuddyUsageDocument({ ledger }, { from: '', to: '' })
    expect(doc.models[0]!.model).toBe('unknown')
  })
})

describe('usage read route', () => {
  it('serves the document', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), 'm', 2)])
    const base = await mount({ ledger })
    const { status, body } = await get(base)
    expect(status).toBe(200)
    expect(body.totals.credit).toBe(2)
    expect(body.days).toHaveLength(1)
  })

  it('supports ?days=N relative to the newest record', async () => {
    const ledger = await makeLedger([
      record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1),
      record(new Date(2026, 9, 3, 10).toISOString(), 'm', 2),
      record(new Date(2026, 9, 5, 10).toISOString(), 'm', 4),
    ])
    const base = await mount({ ledger })
    const { body } = await get(base, '?days=3')
    // 3 days back from 10-05 inclusive = 10-03..10-05
    expect(body.days.map((d: { day: string }) => d.day)).toEqual(['2026-10-03', '2026-10-05'])
    expect(body.totals.credit).toBe(6)
  })

  it('ignores a malformed date and falls back to the whole ledger', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), 'm', 5)])
    const base = await mount({ ledger })
    const { body } = await get(base, '?from=not-a-date&to=also-bad')
    expect(body.totals.credit).toBe(5)
  })

  it('rejects non-GET', async () => {
    const base = await mount({ ledger: await makeLedger([]) })
    const response = await fetch(`${base}${WORKBUDDY_USAGE_PATH}`, { method: 'POST', headers: { host: new URL(base).host } })
    expect(response.status).toBe(405)
  })

  it('refuses a non-loopback Host (DNS-rebinding guard)', async () => {
    const base = await mount({ ledger: await makeLedger([]) })
    const port = Number(new URL(base).port)
    const result = await rawRequest({
      port, method: 'GET', path: WORKBUDDY_USAGE_PATH, headers: { host: 'evil.example.com' },
    })
    expect(result.status).toBe(403)
    expect(result.body).toContain('request-not-trusted')
  })

  it('answers 200 with unavailable when no ledger is present', async () => {
    const base = await mount({})
    const { status, body } = await get(base)
    expect(status).toBe(200)
    expect(body.unavailable).toMatch(/not enabled/)
  })

  it('does not leak a key when none is configured', async () => {
    const base = await mount({ ledger: await makeLedger([]) })
    expect((await get(base)).body.key).toBeUndefined()
  })
})

describe('usage maintenance route', () => {
  it('folds a range into a rollup without deleting detail by default', async () => {
    const ledger = await makeLedger([
      record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1),
      record(new Date(2026, 9, 2, 10).toISOString(), 'm', 2),
    ])
    const base = await mount({ ledger, key: 'k' })
    const { status, body } = await post(base, { action: 'compact', from: '2026-10-01', to: '2026-10-01' }, 'k')
    expect(status).toBe(200)
    expect(body.folded).toMatchObject({ requests: 1, credit: 1 })
    expect(body.purged).toBe(false)
    // the UI-visible document now reports the rollup too
    const doc = await get(base)
    expect(doc.body.storage.rollups).toBe(1)
    expect(doc.body.storage.records).toBe(2)
  })

  it('purges only when explicitly requested', async () => {
    const ledger = await makeLedger([
      record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1),
      record(new Date(2026, 9, 2, 10).toISOString(), 'm', 2),
    ])
    const base = await mount({ ledger, key: 'k' })
    const { body } = await post(base, { action: 'compact', from: '2026-10-01', to: '2026-10-01', purge: true }, 'k')
    expect(body.purged).toBe(true)
    expect((await get(base)).body.storage.records).toBe(1)
  })

  it('refuses a write without the in-process key', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1)])
    const base = await mount({ ledger, key: 'k' })
    const { status } = await post(base, { action: 'clear' })
    expect(status).toBe(403)
    expect((await get(base)).body.storage.records).toBe(1)   // untouched
  })

  it('refuses a write with the wrong key', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1)])
    const base = await mount({ ledger, key: 'k' })
    expect((await post(base, { action: 'clear' }, 'nope')).status).toBe(403)
  })

  it('clear empties the ledger when authorized', async () => {
    const ledger = await makeLedger([record(new Date(2026, 9, 1, 10).toISOString(), 'm', 1)])
    const base = await mount({ ledger, key: 'k' })
    expect((await post(base, { action: 'clear' }, 'k')).status).toBe(200)
    expect((await get(base)).body.storage.records).toBe(0)
  })

  it('rejects compact without a range', async () => {
    const base = await mount({ ledger: await makeLedger([]), key: 'k' })
    expect((await post(base, { action: 'compact' }, 'k')).status).toBe(400)
  })

  it('rejects an unknown action', async () => {
    const base = await mount({ ledger: await makeLedger([]), key: 'k' })
    expect((await post(base, { action: 'nuke' }, 'k')).status).toBe(400)
  })

  it('rejects non-POST', async () => {
    const base = await mount({ ledger: await makeLedger([]) })
    const response = await fetch(`${base}${WORKBUDDY_USAGE_MAINTENANCE_PATH}`, { headers: { host: new URL(base).host } })
    expect(response.status).toBe(405)
  })

  it('refuses a non-loopback Host', async () => {
    const base = await mount({ ledger: await makeLedger([]) })
    const port = Number(new URL(base).port)
    const result = await rawRequest({
      port,
      method: 'POST',
      path: WORKBUDDY_USAGE_MAINTENANCE_PATH,
      headers: { host: 'evil.example.com', 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(result.status).toBe(403)
    expect(result.body).toContain('request-not-trusted')
  })

  it('answers 409 when no ledger is composed', async () => {
    const base = await mount({ key: 'k' })
    expect((await post(base, { action: 'clear' }, 'k')).status).toBe(409)
  })

  it('rejects a malformed JSON body', async () => {
    const base = await mount({ ledger: await makeLedger([]), key: 'k' })
    const response = await fetch(`${base}${WORKBUDDY_USAGE_MAINTENANCE_PATH}`, {
      method: 'POST',
      headers: { host: new URL(base).host, 'Content-Type': 'application/json', 'x-workbuddy-key': 'k' },
      body: '{not json',
    })
    expect(response.status).toBe(400)
  })
})
