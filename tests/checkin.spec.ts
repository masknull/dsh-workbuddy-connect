import { describe, expect, it, vi } from 'vitest'
import {
  WorkBuddyCheckInService,
  getUtc8DateString,
  type WorkBuddyCheckInResult,
} from '../src/checkin.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'
import {
  CheckInScheduler,
  DEFAULT_CHECK_IN_MINUTE,
  isPastCheckInTime,
  msUntilNextCheckIn,
  normalizeCheckInMinute,
  type CheckInStatusStore,
  type CheckInRecord,
} from '../src/checkin-scheduler.ts'

describe('WorkBuddyCheckInService', () => {
  const fakeCredentialCN: WorkBuddyCredential = {
    accessToken: 'test-cn-token',
    refreshToken: 'test-cn-refresh',
    expiresAtMs: Date.now() + 3600_000,
    domain: 'workbuddy.cn',
    uid: 'user-123',
    source: 'login',
  }

  const fakeCredentialAI: WorkBuddyCredential = {
    accessToken: 'test-ai-token',
    refreshToken: 'test-ai-refresh',
    expiresAtMs: Date.now() + 3600_000,
    domain: 'workbuddy.ai',
    uid: 'user-456',
    source: 'login',
  }

  it('rejects with error result when credential has no token', async () => {
    const service = new WorkBuddyCheckInService()
    const result = await service.checkIn('workbuddy', undefined)
    expect(result.status).toBe('error')
    expect(result.message).toContain('No access token')
  })

  it('claims daily benefit when CN endpoint returns code 0 with credit', async () => {
    let capturedHeaders: Record<string, string> | undefined
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: { credit: 50 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const service = new WorkBuddyCheckInService({ fetch: mockFetch })
    const result = await service.checkIn('workbuddy', fakeCredentialCN)

    expect(result.status).toBe('claimed')
    expect(result.amount).toBe(50)
    expect(capturedHeaders?.['Authorization']).toBe('Bearer test-cn-token')
    expect(capturedHeaders?.['Origin']).toBe('https://www.workbuddy.cn')
    expect(capturedHeaders?.['Referer']).toBe('https://www.workbuddy.cn/profile/growth-center')
    // The same client UA the login and catalog paths send (the official
    // client's own token), never an invented browser one.
    expect(capturedHeaders?.['User-Agent']).toBe('CLI/2.63.2 CodeBuddy/2.63.2')
  })

  it('detects already-claimed when HTTP 400 and code 10001', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 10001,
        msg: '今天已签到，请明天再来',
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const service = new WorkBuddyCheckInService({ fetch: mockFetch })
    const result = await service.checkIn('workbuddy', fakeCredentialCN)

    expect(result.status).toBe('already-claimed')
    expect(result.message).toContain('今天已签到')
  })

  it('detects already-claimed when message contains 已签到 even on other status code', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        code: 10002,
        msg: '今日已签到',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const service = new WorkBuddyCheckInService({ fetch: mockFetch })
    const result = await service.checkIn('workbuddy', fakeCredentialCN)

    expect(result.status).toBe('already-claimed')
  })

  it('calls global endpoint with appropriate headers for international variant', async () => {
    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: { credit: 100 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const service = new WorkBuddyCheckInService({ fetch: mockFetch })
    const result = await service.checkIn('workbuddy-ai', fakeCredentialAI)

    expect(result.status).toBe('claimed')
    expect(result.amount).toBe(100)
    expect(capturedUrl).toBe('https://www.workbuddy.ai/v2/billing/meter/daily-checkin')
    expect(capturedHeaders?.['X-Domain']).toBe('www.workbuddy.ai')
    expect(capturedHeaders?.['X-No-Enterprise-Id']).toBe('1')
    expect(capturedHeaders?.['Accept-Language']).toBe('en-US')
  })

  it('returns error on HTTP 500 or transport error', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response('Server Error', { status: 500 })
    }) as unknown as typeof fetch

    const service = new WorkBuddyCheckInService({ fetch: mockFetch })
    const result = await service.checkIn('workbuddy', fakeCredentialCN)

    expect(result.status).toBe('error')
  })
})

describe('CheckInScheduler', () => {
  function createMockStore(initial?: Record<string, CheckInRecord>): CheckInStatusStore {
    const records = new Map<string, CheckInRecord>(Object.entries(initial ?? {}))
    return {
      read: vi.fn(variantId => records.get(variantId)),
      write: vi.fn((variantId, record) => { records.set(variantId, record) }),
      clearLogs: vi.fn(variantId => {
        const existing = records.get(variantId)
        if (existing) records.set(variantId, { ...existing, logs: [] })
      }),
    }
  }

  it('normalizes minute of day and defaults to 10:00 (600)', () => {
    expect(DEFAULT_CHECK_IN_MINUTE).toBe(600)
    expect(normalizeCheckInMinute(undefined)).toBe(600)
    expect(normalizeCheckInMinute(-10)).toBe(600)
    expect(normalizeCheckInMinute(1500)).toBe(600)
    expect(normalizeCheckInMinute(480)).toBe(480)
  })

  it('correctly detects whether configured UTC+8 time has passed', () => {
    // 2026-09-22 10:30:00 UTC+8 (epoch ms: 1790044200000)
    // In UTC: 2026-09-22 02:30:00 UTC
    const d = new Date('2026-09-22T02:30:00.000Z')
    const nowMs = d.getTime()

    // 10:00 (600) has passed at 10:30
    expect(isPastCheckInTime(600, nowMs)).toBe(true)
    // 11:00 (660) has not passed at 10:30
    expect(isPastCheckInTime(660, nowMs)).toBe(false)
  })

  it('calculates milliseconds until next check-in', () => {
    // 2026-09-22 09:30:00 UTC+8 (01:30:00 UTC)
    const d = new Date('2026-09-22T01:30:00.000Z')
    const nowMs = d.getTime()

    // Target: 10:00:05 UTC+8 (30 mins + 5 secs = 1805 seconds = 1,805,000 ms)
    const ms = msUntilNextCheckIn(600, nowMs)
    expect(ms).toBe(30 * 60 * 1000 + 5000)
  })

  it('performs catch-up when startup occurs after configured time and not settled', async () => {
    const store = createMockStore()
    // Simulated time: 10:30 UTC+8 (past 10:00)
    const simulatedNow = new Date('2026-09-22T02:30:00.000Z').getTime()
    const checkInFn = vi.fn(async () => ({
      variantId: 'workbuddy',
      date: getUtc8DateString(simulatedNow),
      timestamp: simulatedNow,
      status: 'claimed' as const,
      amount: 100,
    }))

    const scheduler = new CheckInScheduler({
      targets: [{
        variantId: 'workbuddy',
        checkIn: checkInFn,
        minuteOfDay: () => 600,
      }],
      isEnabled: () => true,
      store,
      now: () => simulatedNow,
    })

    scheduler.start()
    // Await async sweep
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(checkInFn).toHaveBeenCalledTimes(1)
    expect(store.write).toHaveBeenCalledWith('workbuddy', expect.objectContaining({
      status: 'claimed',
      amount: 100,
    }))

    scheduler.dispose()
  })

  it('skips catch-up when startup occurs before configured time', async () => {
    const store = createMockStore()
    // Simulated time: 09:30 UTC+8 (before 10:00)
    const simulatedNow = new Date('2026-09-22T01:30:00.000Z').getTime()
    const checkInFn = vi.fn(async () => ({
      variantId: 'workbuddy',
      date: getUtc8DateString(simulatedNow),
      timestamp: simulatedNow,
      status: 'claimed' as const,
    }))

    const scheduler = new CheckInScheduler({
      targets: [{
        variantId: 'workbuddy',
        checkIn: checkInFn,
        minuteOfDay: () => 600,
      }],
      isEnabled: () => true,
      store,
      now: () => simulatedNow,
    })

    scheduler.start()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(checkInFn).not.toHaveBeenCalled()
    scheduler.dispose()
  })
})
