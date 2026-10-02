/**
 * Integration tests for the usage ledger at the shim boundary.
 *
 * These assert the two properties that give the feature its value:
 *  1. a real chat round-trip lands one ledger row carrying the upstream's own
 *     `credit` plus the exact token split;
 *  2. the bytes forwarded to pi-ai are **identical** to what the upstream sent,
 *     so adding statistics cannot change model behaviour.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkBuddyCredentialStore } from '../src/auth.ts'
import { WorkBuddyCatalog } from '../src/catalog.ts'
import { createWorkBuddyShim, type WorkBuddyShim } from '../src/shim.ts'
import type { WorkBuddyChatResult } from '../src/upstream.ts'
import { UsageLedger } from '../src/usage-ledger.ts'

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(CLEANUP.splice(0).map((clean) => clean()))
})

/** Upstream answer whose final chunk carries the billed credit (real shape). */
function streamWithUsage(text = 'ok', usage: Record<string, unknown> = {}): string {
  const full = {
    prompt_tokens: 40008,
    completion_tokens: 1,
    total_tokens: 40009,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 40008,
    completion_tokens_details: { reasoning_tokens: 0 },
    credit: 1.14,
    ...usage,
  }
  return `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { content: '' } }], usage: { prompt_tokens: 40008, completion_tokens: 0, credit: 0 } })}\n\n`
    + `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: { content: text } }] })}\n\n`
    + `data: ${JSON.stringify({ id: 'c1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: full })}\n\n`
    + 'data: [DONE]\n\n'
}

interface Harness {
  shim: WorkBuddyShim
  ledger: UsageLedger
  raw: string
  bodies: string[]
}

async function start(streamText: string, opts: { withLedger?: boolean, region?: 'cn' | 'global' } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'wb-usage-'))
  const own = join(dir, 'own.json')
  await writeFile(own, JSON.stringify({
    version: 1,
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, domain: 'www.codebuddy.cn' },
    account: { uid: 'uid-42' },
  }))
  const store = new WorkBuddyCredentialStore({ ownPath: own, refresh: async () => ({ accessToken: 'unused' }) })
  const ledger = new UsageLedger({ dir: join(dir, 'usage') })
  // Drain the append queue before removing the directory: a pending write holds
  // a handle on it, and deleting underneath the queue fails with EBUSY.
  CLEANUP.push(async () => {
    await ledger.idle()
    await rm(dir, { recursive: true, force: true })
  })
  const bodies: string[] = []
  const shim = createWorkBuddyShim({
    store,
    catalog: new WorkBuddyCatalog(),
    ...(opts.withLedger === false ? {} : { ledger, region: opts.region ?? 'cn' }),
    client: {
      async chatStream(_credential, bodyJson): Promise<WorkBuddyChatResult> {
        bodies.push(bodyJson)
        return {
          ok: true,
          response: new Response(streamText, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
        }
      },
    },
  })
  await shim.ready
  CLEANUP.push(() => shim.close())
  return { shim, ledger, raw: streamText, bodies }
}

/** POST one chat completion through the shim and return what came back. */
async function chat(harness: Harness, model = 'deepseek-v4.1-flash'): Promise<string> {
  const response = await fetch(`${harness.shim.baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${harness.shim.token()}` },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  })
  expect(response.status).toBe(200)
  return await response.text()
}

/** Wait for the ledger's serialised append queue to drain. */
async function settle(harness: Harness, expected = 1): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await harness.ledger.read()).length >= expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('shim usage ledger', () => {
  it('records one row per chat with the upstream credit and token split', async () => {
    const harness = await start(streamWithUsage())
    await chat(harness)
    await settle(harness)

    const rows = await harness.ledger.read()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      region: 'cn',
      uid: 'uid-42',
      model: 'deepseek-v4.1-flash',
      prompt: 40008,
      cacheMiss: 40008,
      cacheHit: 0,
      completion: 1,
      credit: 1.14,
      done: true,
    })
    expect(rows[0]!.ms).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(Date.parse(rows[0]!.at))).toBe(false)
  })

  it('forwards the upstream bytes unchanged (statistics must not alter the stream)', async () => {
    const harness = await start(streamWithUsage('你好世界'))
    const received = await chat(harness)
    expect(received).toBe(harness.raw)
  })

  it('records a global-region row when configured for the international account', async () => {
    const harness = await start(streamWithUsage(), { region: 'global' })
    await chat(harness)
    await settle(harness)
    expect((await harness.ledger.read())[0]).toMatchObject({ region: 'global' })
  })

  it('records the cache-hit split when the upstream reports one', async () => {
    const harness = await start(streamWithUsage('ok', {
      prompt_tokens: 1000, prompt_cache_hit_tokens: 960, prompt_cache_miss_tokens: 40, completion_tokens: 12, credit: 0.09,
    }))
    await chat(harness)
    await settle(harness)
    expect((await harness.ledger.read())[0]).toMatchObject({ prompt: 1000, cacheHit: 960, cacheMiss: 40, completion: 12, credit: 0.09 })
  })

  it('accumulates one row per request across several chats', async () => {
    const harness = await start(streamWithUsage())
    await chat(harness)
    await chat(harness)
    await chat(harness)
    await settle(harness, 3)
    const rows = await harness.ledger.read()
    expect(rows).toHaveLength(3)
    expect(rows.reduce((s, r) => s + r.credit, 0)).toBeCloseTo(3.42, 5)
  })

  it('writes nothing when the shim is built without a ledger (opt-in)', async () => {
    const harness = await start(streamWithUsage(), { withLedger: false })
    await chat(harness)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(await harness.ledger.read()).toEqual([])
  })

  it('records the model actually requested, not a guess', async () => {
    const harness = await start(streamWithUsage())
    await chat(harness, 'glm-5.3')
    await settle(harness)
    expect((await harness.ledger.read())[0]!.model).toBe('glm-5.3')
  })

  it('skips a stream that carried no usage chunk', async () => {
    const harness = await start('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n')
    await chat(harness)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await harness.ledger.read()).toEqual([])
  })

  it('survives a usage chunk split across TCP reads', async () => {
    // A ReadableStream that emits one byte at a time exercises the carry logic.
    const text = streamWithUsage()
    const bytes = Buffer.from(text, 'utf8')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.subarray(i, i + 1))
        controller.close()
      },
    })
    const dir = await mkdtemp(join(tmpdir(), 'wb-usage-split-'))
    const own = join(dir, 'own.json')
    await writeFile(own, JSON.stringify({
      version: 1,
      auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, domain: 'www.codebuddy.cn' },
      account: { uid: 'uid-9' },
    }))
    const ledger = new UsageLedger({ dir: join(dir, 'usage') })
    CLEANUP.push(async () => {
      await ledger.idle()
      await rm(dir, { recursive: true, force: true })
    })
    const shim = createWorkBuddyShim({
      store: new WorkBuddyCredentialStore({ ownPath: own, refresh: async () => ({ accessToken: 'x' }) }),
      catalog: new WorkBuddyCatalog(),
      ledger,
      region: 'cn',
      client: {
        async chatStream(): Promise<WorkBuddyChatResult> {
          return { ok: true, response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) }
        },
      },
    })
    await shim.ready
    CLEANUP.push(() => shim.close())
    const harness = { shim, ledger, raw: text, bodies: [] } satisfies Harness
    expect(await chat(harness)).toBe(text)
    await settle(harness)
    expect((await ledger.read())[0]).toMatchObject({ credit: 1.14, prompt: 40008 })
  })

  it('exposes per-day aggregates that match the recorded rows', async () => {
    const harness = await start(streamWithUsage())
    await chat(harness)
    await chat(harness)
    await settle(harness, 2)
    const daily = await harness.ledger.daily()
    expect(daily).toHaveLength(1)
    expect(daily[0]).toMatchObject({ requests: 2 })
    expect(daily[0]!.credit).toBeCloseTo(2.28, 5)
    expect(daily[0]!.prompt).toBe(80016)
  })
})
