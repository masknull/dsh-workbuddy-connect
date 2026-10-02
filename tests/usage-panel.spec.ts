/**
 * Tests for the card's 「用量统计」 tab.
 *
 * The panel's whole value is that the numbers are *measured*, so these tests
 * drive it the way the card does — `react-test-renderer` with a stubbed
 * `fetch` — and assert the arithmetic and the maintenance contract, not
 * implementation details. No request leaves the process.
 */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { UsageStatsPanel } from '../src/client/UsageStatsPanel.tsx'
import { WORKBUDDY_USAGE_MAINTENANCE_PATH, WORKBUDDY_USAGE_PATH } from '../src/usage-paths.ts'
import type { WorkBuddyUsageDocument } from '../src/usage-paths.ts'

/** Locale lookup mirroring the injected `t` (params substituted, as the host does). */
const t = (key: keyof typeof en, params: Record<string, string | number> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )

/** A usage document with the shape the route serves. */
function document(overrides: Partial<WorkBuddyUsageDocument> = {}): WorkBuddyUsageDocument {
  return {
    days: [
      { day: '2026-10-01', requests: 3, prompt: 3000, cacheHit: 2400, cacheMiss: 600, completion: 90, reasoning: 0, credit: 1.5 },
      { day: '2026-10-02', requests: 2, prompt: 2000, cacheHit: 1600, cacheMiss: 400, completion: 60, reasoning: 0, credit: 3 },
    ],
    models: [
      { model: 'deepseek-v4.1-flash', requests: 4, prompt: 4000, cacheHit: 3200, cacheMiss: 800, completion: 120, credit: 4 },
      { model: 'glm-5.3', requests: 1, prompt: 1000, cacheHit: 800, cacheMiss: 200, completion: 30, credit: 0.5 },
    ],
    totals: { requests: 5, prompt: 5000, cacheHit: 4000, cacheMiss: 1000, completion: 150, reasoning: 0, credit: 4.5 },
    storage: { bytes: 2048, records: 5, rollups: 0, first: '2026-10-01T01:00:00.000Z', last: '2026-10-02T01:00:00.000Z' },
    window: { from: '2026-10-01', to: '2026-10-02' },
    key: 'maintenance-key',
    ...overrides,
  }
}

/** One stubbed reply: a body, a status, or a pending promise. */
interface Reply { status?: number, body?: unknown, hang?: boolean, invalidJson?: boolean }

let renderer: ReactTestRenderer | undefined
let calls: { url: string, init?: RequestInit }[] = []
let replies: Reply[] = []

/** Install a `fetch` stub that answers from {@link replies} in order. */
function stubFetch(): void {
  replies = []
  calls = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, ...(init === undefined ? {} : { init }) })
    const reply = replies.shift() ?? { body: document() }
    if (reply.hang === true) return await new Promise<Response>(() => {})
    if (reply.invalidJson === true) {
      return new Response('<html>not json</html>', { status: reply.status ?? 200 })
    }
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

/** Mount the panel and let its initial read settle. */
async function mount(open = true): Promise<ReactTestRenderer> {
  renderer = create(createElement(UsageStatsPanel, { t, open }))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return renderer
}

/** Every string the rendered tree shows, concatenated. */
function textOf(node: ReactTestRenderer): string {
  return collectText(node.toJSON())
}

/** Buttons in render order, with their labels. */
function buttons(node: ReactTestRenderer): { label: string, onClick: () => void, disabled: boolean }[] {
  const out: { label: string, onClick: () => void, disabled: boolean }[] = []
  const walk = (children: unknown): void => {
    if (Array.isArray(children)) { children.forEach(walk); return }
    if (children === null || typeof children !== 'object') return
    const element = children as { type?: unknown, props?: Record<string, unknown>, children?: unknown }
    if (element.type === 'button' && element.props !== undefined) {
      const label = collectText(element.children)
      out.push({
        label,
        onClick: element.props['onClick'] as () => void,
        disabled: element.props['disabled'] === true,
      })
    }
    if (element.children !== undefined) walk(element.children)
  }
  walk(node.toJSON())
  return out
}

/** Concatenated text of a React child subtree. */
function collectText(children: unknown): string {
  if (children === null || children === undefined) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(collectText).join('')
  const element = children as { children?: unknown }
  return element.children === undefined ? '' : collectText(element.children)
}

beforeEach(() => { stubFetch() })
afterEach(() => {
  renderer?.unmount()
  renderer = undefined
  vi.unstubAllGlobals()
})

describe('UsageStatsPanel', () => {
  it('renders nothing while the tab is closed and fetches nothing', async () => {
    const node = await mount(false)
    expect(node.toJSON()).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('reads the usage route with the default 7-day window', async () => {
    await mount()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${WORKBUDDY_USAGE_PATH}?days=7`)
  })

  it('shows measured totals, not estimates', async () => {
    const text = textOf(await mount())
    expect(text).toContain('4.50')            // credit total
    expect(text).toContain('5150')            // tokens (5000 + 150); below 1e4, so ungrouped
    expect(text).toContain('80.0')            // cache hit 4000/5000 — the % is its own node
    expect(text).toContain('80.0%')
  })

  it('abbreviates token totals at 万/亿 and leaves small ones exact', async () => {
    const big = document({
      totals: { requests: 1, prompt: 123_000_000, cacheHit: 0, cacheMiss: 123_000_000, completion: 1_000_000, reasoning: 0, credit: 9 },
    })
    replies = [{ body: big }]
    const text = textOf(await mount())
    expect(text).toContain('1.24亿')          // 124e6 tokens
  })

  it('computes the effective credit rate per million tokens', async () => {
    const text = textOf(await mount())
    // 4.5 credit over 5,150 tokens
    expect(text).toContain((4.5 / (5150 / 1e6)).toFixed(3))
  })

  it('shows the default plan price per million tokens (advanced monthly)', async () => {
    const text = textOf(await mount())
    const rate = 4.5 / (5150 / 1e6)
    const yuanPerCredit = 140 / 9000
    expect(text).toContain((rate * yuanPerCredit).toFixed(4))
  })

  it('lists each day and each model', async () => {
    const text = textOf(await mount())
    expect(text).toContain('2026-10-01')
    expect(text).toContain('2026-10-02')
    expect(text).toContain('deepseek-v4.1-flash')
    expect(text).toContain('glm-5.3')
  })

  it('switches the window and refetches', async () => {
    const node = await mount()
    replies = [{ body: document() }]
    const today = buttons(node).find(entry => entry.label === en.usageToday)!
    await act(async () => { today.onClick() })
    await act(async () => { await Promise.resolve() })
    expect(calls.at(-1)!.url).toBe(`${WORKBUDDY_USAGE_PATH}?days=1`)
  })

  it('refetches the whole ledger for the all-time window', async () => {
    const node = await mount()
    replies = [{ body: document() }]
    const all = buttons(node).find(entry => entry.label === en.usageAllTime)!
    await act(async () => { all.onClick() })
    await act(async () => { await Promise.resolve() })
    expect(calls.at(-1)!.url).toBe(WORKBUDDY_USAGE_PATH)
  })

  it('explains an unavailable ledger instead of showing zeroes', async () => {
    replies = [{ body: document({ unavailable: 'usage ledger is not enabled' }) }]
    const text = textOf(await mount())
    expect(text).toContain(en.usageUnavailable)
  })

  it('surfaces a transport failure with a retry affordance', async () => {
    replies = [{ status: 500, body: { error: 'boom' } }]
    const node = await mount()
    expect(textOf(node)).toContain('HTTP 500')
    expect(buttons(node).some(entry => entry.label === en.usageRefresh)).toBe(true)
  })

  it('rejects a 200 whose body is not a usage document', async () => {
    replies = [{ invalidJson: true }]
    const node = await mount()
    expect(buttons(node).some(entry => entry.label === en.usageRefresh)).toBe(true)
  })

  it('says so when the window holds no records', async () => {
    replies = [{
      body: document({
        days: [], models: [],
        totals: { requests: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, reasoning: 0, credit: 0 },
      }),
    }]
    expect(textOf(await mount())).toContain(en.usageEmpty)
  })

  it('posts a fold with the in-process key and the selected range', async () => {
    const node = await mount()
    replies = [{ body: { ok: true, folded: { requests: 5, credit: 4.5 }, purged: false } }]
    const fold = buttons(node).find(entry => entry.label === en.usageFold)!
    await act(async () => { fold.onClick() })
    await act(async () => { await Promise.resolve() })

    const post = calls.find(call => call.url === WORKBUDDY_USAGE_MAINTENANCE_PATH)!
    expect(post.init?.method).toBe('POST')
    const headers = post.init?.headers as Record<string, string>
    expect(headers['x-workbuddy-key']).toBe('maintenance-key')
    const body = JSON.parse(String(post.init?.body)) as Record<string, unknown>
    expect(body['action']).toBe('compact')
    expect(body['purge']).toBe(false)
    expect(typeof body['from']).toBe('string')
    expect(typeof body['to']).toBe('string')
  })

  it('reports the fold outcome including that raw records were kept', async () => {
    const node = await mount()
    replies = [{ body: { ok: true, folded: { requests: 5, credit: 4.5 }, purged: false } }]
    const fold = buttons(node).find(entry => entry.label === en.usageFold)!
    await act(async () => { fold.onClick() })
    await act(async () => { await Promise.resolve() })
    const text = textOf(node)
    expect(text).toContain('5')
    expect(text).toContain('4.50')
    expect(text).toContain(en.usageFoldedKept)
  })

  it('does not send purge unless the box is ticked', async () => {
    const node = await mount()
    const box = JSON.stringify(node.toJSON()).includes('"type":"checkbox"')
    expect(box).toBe(true)
    replies = [{ body: { ok: true, folded: { requests: 0, credit: 0 }, purged: false } }]
    const fold = buttons(node).find(entry => entry.label === en.usageFold)!
    await act(async () => { fold.onClick() })
    await act(async () => { await Promise.resolve() })
    const post = calls.find(call => call.url === WORKBUDDY_USAGE_MAINTENANCE_PATH)!
    expect((JSON.parse(String(post.init?.body)) as Record<string, unknown>)['purge']).toBe(false)
  })

  it('disables maintenance when the host sent no key', async () => {
    // `key` is omitted rather than set to undefined: the project compiles with
    // exactOptionalPropertyTypes, and the route omits the field too.
    const withoutKey = document()
    delete (withoutKey as { key?: string }).key
    replies = [{ body: withoutKey }]
    const node = await mount()
    const fold = buttons(node).find(entry => entry.label === en.usageFold)!
    expect(fold.disabled).toBe(true)
  })

  it('shows ledger storage and coverage', async () => {
    const text = textOf(await mount())
    expect(text).toContain('2.0')              // 2048 bytes -> KB
    expect(text).toContain('2026-10-01T01:00:00.000Z')
  })

  it('mentions folded ranges when the ledger has rollups', async () => {
    replies = [{ body: document({ storage: { bytes: 100, records: 5, rollups: 2 } }) }]
    expect(textOf(await mount())).toContain('2')
  })

  it('retries through the refresh button', async () => {
    replies = [{ status: 503, body: {} }]
    const node = await mount()
    replies = [{ body: document() }]
    const refresh = buttons(node).find(entry => entry.label === en.usageRefresh)!
    await act(async () => { refresh.onClick() })
    await act(async () => { await Promise.resolve() })
    expect(textOf(node)).toContain('4.50')
  })
})
