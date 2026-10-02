/**
 * Usage statistics routes for the plugin card.
 *
 * Two routes, mirroring the status/probe split the plugin already uses:
 *
 * - `GET  /plugins/dsh-workbuddy-connect/usage` — aggregates, loopback-guarded;
 * - `POST /plugins/dsh-workbuddy-connect/usage/maintenance` — fold a range into
 *   a rollup (and optionally purge the folded detail). This one changes state,
 *   so it additionally requires the in-process key the browser half receives
 *   with the read document. The loopback Host/Origin guard protects against a
 *   DNS-rebinding *page*, which is not the same as authorizing a deletion.
 *
 * @module dsh-workbuddy-connect/usage-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostIsLoopback, originIsLoopback } from './loopback.ts'
import {
  WORKBUDDY_USAGE_MAINTENANCE_PATH,
  WORKBUDDY_USAGE_PATH,
  type WorkBuddyUsageDayRow,
  type WorkBuddyUsageDocument,
  type WorkBuddyUsageMaintenanceRequest,
  type WorkBuddyUsageModelRow,
} from './usage-paths.ts'
import { localDay, sumRecords, type UsageLedger, type UsageRecord } from './usage-ledger.ts'

/** Constructor dependencies. */
export interface WorkBuddyUsageRouteOptions {
  /** The ledger to read. Absent compositions answer `unavailable`. */
  ledger?: UsageLedger
  /** In-process key authorizing maintenance writes. */
  key?: string
  /** Override the read path (tests). */
  path?: string
  /** Override the maintenance path (tests). */
  maintenancePath?: string
}

/** Loopback-only guard, identical to the status route's. */
function loopbackRequest(req: IncomingMessage): boolean {
  return hostIsLoopback(req.headers.host) && originIsLoopback(req.headers.origin)
}

/** Respond with JSON; never throws on a closed socket. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Read a request body with a small bound. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** `YYYY-MM-DD` or the empty string. */
function dayParam(value: string | null): string {
  if (value === null || value.trim() === '') return ''
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : ''
}

/** Group records by model, largest billed credit first. */
function byModel(records: readonly UsageRecord[]): WorkBuddyUsageModelRow[] {
  const map = new Map<string, WorkBuddyUsageModelRow>()
  for (const record of records) {
    const key = record.model === '' ? 'unknown' : record.model
    const row = map.get(key) ?? { model: key, requests: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, credit: 0 }
    row.requests += 1
    row.prompt += record.prompt
    row.cacheHit += record.cacheHit
    row.cacheMiss += record.cacheMiss
    row.completion += record.completion
    row.credit += record.credit
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.credit - a.credit || b.requests - a.requests)
}

/** Group records by local day, oldest first. */
function byDay(records: readonly UsageRecord[]): WorkBuddyUsageDayRow[] {
  const map = new Map<string, WorkBuddyUsageDayRow>()
  for (const record of records) {
    const day = localDay(record.at)
    const row = map.get(day) ?? {
      day, requests: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, reasoning: 0, credit: 0,
    }
    row.requests += 1
    row.prompt += record.prompt
    row.cacheHit += record.cacheHit
    row.cacheMiss += record.cacheMiss
    row.completion += record.completion
    row.reasoning += record.reasoning
    row.credit += record.credit
    map.set(day, row)
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/** Assemble the usage document for a window. */
export async function workBuddyUsageDocument(
  deps: WorkBuddyUsageRouteOptions,
  window: { from: string, to: string },
): Promise<WorkBuddyUsageDocument> {
  const empty: WorkBuddyUsageDocument = {
    days: [],
    models: [],
    totals: { requests: 0, prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, reasoning: 0, credit: 0 },
    storage: { bytes: 0, records: 0, rollups: 0 },
    window,
  }
  if (deps.ledger === undefined) {
    return { ...empty, unavailable: 'usage ledger is not enabled in this composition' }
  }
  const all = await deps.ledger.read()
  const scoped = all.filter((record) => {
    const day = localDay(record.at)
    if (window.from !== '' && day < window.from) return false
    if (window.to !== '' && day > window.to) return false
    return true
  })
  const totals = sumRecords(scoped)
  const first = all[0]?.at
  const last = all.at(-1)?.at
  return {
    days: byDay(scoped),
    models: byModel(scoped),
    totals,
    storage: {
      bytes: await deps.ledger.size(),
      records: all.length,
      rollups: (await deps.ledger.rollups()).length,
      ...(first === undefined ? {} : { first }),
      ...(last === undefined ? {} : { last }),
    },
    window,
    ...(deps.key === undefined ? {} : { key: deps.key }),
  }
}

/** The read route's handler, extracted so tests can mount it on a bare server. */
export function workBuddyUsageHandler(
  deps: WorkBuddyUsageRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!loopbackRequest(req)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const days = Number(url.searchParams.get('days') ?? '')
      let from = dayParam(url.searchParams.get('from'))
      let to = dayParam(url.searchParams.get('to'))
      // `days=N` is a convenience window: N days back from the newest record,
      // so the card can offer 今天 / 7天 / 30天 without computing dates itself.
      if (from === '' && to === '' && Number.isFinite(days) && days > 0) {
        const all = deps.ledger === undefined ? [] : await deps.ledger.read()
        const newest = all.at(-1)?.at
        if (newest !== undefined) {
          const end = new Date(newest)
          const start = new Date(end.getTime() - (days - 1) * 86_400_000)
          from = localDay(start.toISOString())
          to = localDay(end.toISOString())
        }
      }
      json(res, 200, await workBuddyUsageDocument(deps, { from, to }))
    } catch (error: unknown) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** The maintenance route's handler. */
export function workBuddyUsageMaintenanceHandler(
  deps: WorkBuddyUsageRouteOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    if (!loopbackRequest(req)) {
      json(res, 403, { error: 'request-not-trusted' })
      return
    }
    if (deps.ledger === undefined) {
      json(res, 409, { error: 'usage ledger is not enabled in this composition' })
      return
    }
    let body: WorkBuddyUsageMaintenanceRequest
    try {
      body = await readJson(req) as WorkBuddyUsageMaintenanceRequest
    } catch (error: unknown) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    // Writes carry the in-process key; a page that merely reached loopback
    // cannot fold or delete a ledger.
    if (deps.key !== undefined && (req.headers['x-workbuddy-key'] ?? '') !== deps.key) {
      json(res, 403, { error: 'bad-key' })
      return
    }
    try {
      if (body.action === 'clear') {
        await deps.ledger.clear()
        json(res, 200, { ok: true, cleared: true })
        return
      }
      if (body.action !== 'compact') {
        json(res, 400, { error: 'unknown action' })
        return
      }
      const from = dayParam(body.from ?? null)
      const to = dayParam(body.to ?? null)
      if (from === '' && to === '') {
        json(res, 400, { error: 'compact needs a date range' })
        return
      }
      const result = await deps.ledger.compact(from, to, body.purge === true)
      json(res, 200, { ok: true, ...result })
    } catch (error: unknown) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Mount both usage routes on an optional webServer context. */
export function registerWorkBuddyUsageRoutes(ctx: Context, deps: WorkBuddyUsageRouteOptions): void {
  const readPath = deps.path ?? WORKBUDDY_USAGE_PATH
  const writePath = deps.maintenancePath ?? WORKBUDDY_USAGE_MAINTENANCE_PATH
  ctx.effect(() => {
    const disposeRead = ctx.webServer.register({ kind: 'exact', path: readPath, handler: workBuddyUsageHandler(deps) })
    const disposeWrite = ctx.webServer.register({ kind: 'exact', path: writePath, handler: workBuddyUsageMaintenanceHandler(deps) })
    return () => {
      disposeRead()
      disposeWrite()
    }
  }, 'dsh-workbuddy-connect: Web usage routes')
}
