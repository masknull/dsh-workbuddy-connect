import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  CheckInScheduler,
  JsonFileCheckInStore,
  getUtc8DateString,
  msUntilNext10amUtc8,
  type CheckInRecord,
  type CheckInStatusStore,
} from '../src/checkin-scheduler.ts'
import { WorkBuddyUpstreamClient } from '../src/upstream.ts'
import { WORKBUDDY_CREDENTIAL_SOURCE, type WorkBuddyCredential } from '../src/auth.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('WorkBuddy Check-in & Scheduler', () => {
  const dummyCredential: WorkBuddyCredential = {
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    expiresAtMs: Date.now() + 3600_000,
    domain: 'copilot.tencent.com',
    uid: 'user-123',
    source: WORKBUDDY_CREDENTIAL_SOURCE,
  }

  const dummyGlobalCredential: WorkBuddyCredential = {
    accessToken: 'test-global-token',
    refreshToken: 'test-global-refresh',
    expiresAtMs: Date.now() + 3600_000,
    domain: 'workbuddy.ai',
    uid: 'user-456',
    source: WORKBUDDY_CREDENTIAL_SOURCE,
  }

  describe('WorkBuddyUpstreamClient checkin methods', () => {
    let client: WorkBuddyUpstreamClient

    beforeEach(() => {
      client = new WorkBuddyUpstreamClient()
    })

    it('fetches checkin status correctly on CN gateway', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url)
        expect(urlStr).toContain('https://www.codebuddy.cn/v2/billing/meter/checkin-activity-status')
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe('{}')
        return new Response(JSON.stringify({
          code: 0,
          data: {
            active: true,
            today_checked_in: false,
            streak_days: 5,
            daily_credit: 100,
            today_credit: 100,
            is_streak_day: false,
            next_streak_day: 7,
            streak_bonus_days: 7,
            streak_bonus_credit: 500,
            claim_button_text: '签到领 100 积分',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = mockFetch as unknown as typeof fetch
      try {
        const status = await client.fetchCheckinStatus(dummyCredential)
        expect(status.active).toBe(true)
        expect(status.todayCheckedIn).toBe(false)
        expect(status.streakDays).toBe(5)
        expect(status.dailyCredit).toBe(100)
        expect(status.claimButtonText).toBe('签到领 100 积分')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('claims daily checkin successfully', async () => {
      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url)
        expect(urlStr).toContain('https://www.codebuddy.cn/v2/billing/meter/daily-checkin')
        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({
          code: 0,
          data: {
            credit: 100,
            streak_days: 6,
            is_streak_day: false,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = mockFetch as unknown as typeof fetch
      try {
        const claim = await client.claimDailyCheckin(dummyCredential)
        expect(claim.credit).toBe(100)
        expect(claim.streakDays).toBe(6)
        expect(claim.isStreakDay).toBe(false)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('throws when upstream returns non-zero envelope code', async () => {
      const mockFetch = vi.fn(async () => {
        return new Response(JSON.stringify({
          code: 10001,
          message: 'activity expired',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      })

      const originalFetch = globalThis.fetch
      globalThis.fetch = mockFetch as unknown as typeof fetch
      try {
        await expect(client.fetchCheckinStatus(dummyCredential)).rejects.toThrow('activity expired')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('JsonFileCheckInStore', () => {
    let tempDir: string
    let storeFile: string
    let store: JsonFileCheckInStore

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'wb-checkin-test-'))
      storeFile = join(tempDir, 'state', 'checkin-status.json')
      store = new JsonFileCheckInStore(storeFile)
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('writes and reads checkin record', () => {
      expect(store.read('workbuddy')).toBeUndefined()
      const record: CheckInRecord = {
        lastDate: '2026-09-22',
        lastAt: 1790000000000,
        status: 'claimed',
        amount: 100,
      }
      store.write('workbuddy', record)
      const read = store.read('workbuddy')
      expect(read).toBeDefined()
      expect(read?.lastDate).toBe('2026-09-22')
      expect(read?.status).toBe('claimed')
      expect(read?.amount).toBe(100)
      expect(read?.logs?.length).toBe(1)
      expect(read?.logs?.[0]?.status).toBe('claimed')
    })

    it('caps log entries to 30 items', () => {
      for (let i = 0; i < 35; i++) {
        store.write('workbuddy', {
          lastDate: `2026-09-${String(i + 1).padStart(2, '0')}`,
          lastAt: 1790000000000 + i * 1000,
          status: 'claimed',
          amount: 100,
        })
      }
      const read = store.read('workbuddy')
      expect(read?.logs?.length).toBe(30)
    })

    it('clears logs', () => {
      store.write('workbuddy', {
        lastDate: '2026-09-22',
        lastAt: 1790000000000,
        status: 'claimed',
      })
      expect(store.read('workbuddy')?.logs?.length).toBe(1)
      store.clearLogs('workbuddy')
      expect(store.read('workbuddy')?.logs).toEqual([])
    })
  })

  describe('Time helpers', () => {
    it('formats date in UTC+8', () => {
      // 2026-09-22T00:00:00.000Z is 08:00 on 2026-09-22 in UTC+8
      const dateUtc = new Date('2026-09-22T00:00:00.000Z').getTime()
      expect(getUtc8DateString(dateUtc)).toBe('2026-09-22')

      // 2026-09-21T23:59:59.000Z is 07:59:59 on 2026-09-22 in UTC+8
      const dateEarly = new Date('2026-09-21T23:59:59.000Z').getTime()
      expect(getUtc8DateString(dateEarly)).toBe('2026-09-22')
    })

    it('calculates delay until next 10:00:05 in UTC+8', () => {
      // 09:00:00 in UTC+8 -> 1 hour + 5 sec until 10:00:05
      const at9am = new Date('2026-09-22T01:00:00.000Z').getTime() // 09:00 UTC+8
      const delay = msUntilNext10amUtc8(at9am)
      expect(delay).toBe(3605 * 1000)

      // 11:00:00 in UTC+8 -> 23 hours + 5 sec until tomorrow 10:00:05
      const at11am = new Date('2026-09-22T03:00:00.000Z').getTime() // 11:00 UTC+8
      const delayTomorrow = msUntilNext10amUtc8(at11am)
      expect(delayTomorrow).toBe(23 * 3600 * 1000 + 5 * 1000)
    })
  })

  describe('CheckInScheduler orchestration', () => {
    class MemoryStore implements CheckInStatusStore {
      records = new Map<string, CheckInRecord>()
      read(id: string) { return this.records.get(id) }
      write(id: string, record: CheckInRecord) { this.records.set(id, record) }
      clearLogs(id: string) {
        const r = this.records.get(id)
        if (r) r.logs = []
      }
    }

    it('skips disabled variants', async () => {
      const store = new MemoryStore()
      const mockClient = {
        fetchCheckinStatus: vi.fn(),
        claimDailyCheckin: vi.fn(),
      } as unknown as WorkBuddyUpstreamClient

      const scheduler = new CheckInScheduler({
        targets: [{
          variantId: 'workbuddy',
          client: mockClient,
          getCredential: async () => dummyCredential,
        }],
        isEnabled: () => false,
        store,
      })

      await scheduler.executeOnce()
      expect(mockClient.fetchCheckinStatus).not.toHaveBeenCalled()
      expect(store.read('workbuddy')).toBeUndefined()
    })

    it('skips when today is already claimed', async () => {
      const store = new MemoryStore()
      const today = getUtc8DateString()
      store.write('workbuddy', {
        lastDate: today,
        lastAt: Date.now(),
        status: 'claimed',
        amount: 100,
      })

      const mockClient = {
        fetchCheckinStatus: vi.fn(),
        claimDailyCheckin: vi.fn(),
      } as unknown as WorkBuddyUpstreamClient

      const scheduler = new CheckInScheduler({
        targets: [{
          variantId: 'workbuddy',
          client: mockClient,
          getCredential: async () => dummyCredential,
        }],
        isEnabled: () => true,
        store,
      })

      await scheduler.executeOnce()
      expect(mockClient.fetchCheckinStatus).not.toHaveBeenCalled()
    })

    it('records already-claimed when upstream says todayCheckedIn: true', async () => {
      const store = new MemoryStore()
      const mockClient = {
        fetchCheckinStatus: vi.fn(async () => ({
          active: true,
          todayCheckedIn: true,
          streakDays: 3,
          dailyCredit: 100,
          todayCredit: 100,
          isStreakDay: false,
          nextStreakDay: 7,
          streakBonusDays: 7,
          streakBonusCredit: 500,
        })),
        claimDailyCheckin: vi.fn(),
      } as unknown as WorkBuddyUpstreamClient

      const scheduler = new CheckInScheduler({
        targets: [{
          variantId: 'workbuddy',
          client: mockClient,
          getCredential: async () => dummyCredential,
        }],
        isEnabled: () => true,
        store,
      })

      await scheduler.executeOnce()
      expect(mockClient.fetchCheckinStatus).toHaveBeenCalledTimes(1)
      expect(mockClient.claimDailyCheckin).not.toHaveBeenCalled()
      expect(store.read('workbuddy')?.status).toBe('already-claimed')
    })

    it('claims and notifies onClaimed when checkin is available', async () => {
      const store = new MemoryStore()
      const onClaimed = vi.fn()
      const mockClient = {
        fetchCheckinStatus: vi.fn(async () => ({
          active: true,
          todayCheckedIn: false,
          streakDays: 3,
          dailyCredit: 100,
          todayCredit: 100,
          isStreakDay: false,
          nextStreakDay: 7,
          streakBonusDays: 7,
          streakBonusCredit: 500,
        })),
        claimDailyCheckin: vi.fn(async () => ({
          credit: 100,
          streakDays: 4,
          isStreakDay: false,
        })),
      } as unknown as WorkBuddyUpstreamClient

      const scheduler = new CheckInScheduler({
        targets: [{
          variantId: 'workbuddy',
          client: mockClient,
          getCredential: async () => dummyCredential,
          onClaimed,
        }],
        isEnabled: () => true,
        store,
      })

      await scheduler.executeOnce()
      expect(mockClient.fetchCheckinStatus).toHaveBeenCalledTimes(1)
      expect(mockClient.claimDailyCheckin).toHaveBeenCalledTimes(1)
      expect(store.read('workbuddy')?.status).toBe('claimed')
      expect(store.read('workbuddy')?.amount).toBe(100)
      expect(onClaimed).toHaveBeenCalledTimes(1)
    })

    it('records error status when fetching or claiming fails', async () => {
      const store = new MemoryStore()
      const mockClient = {
        fetchCheckinStatus: vi.fn(async () => {
          throw new Error('Network timeout')
        }),
        claimDailyCheckin: vi.fn(),
      } as unknown as WorkBuddyUpstreamClient

      const scheduler = new CheckInScheduler({
        targets: [{
          variantId: 'workbuddy',
          client: mockClient,
          getCredential: async () => dummyCredential,
        }],
        isEnabled: () => true,
        store,
      })

      await scheduler.executeOnce()
      expect(store.read('workbuddy')?.status).toBe('error')
      expect(store.read('workbuddy')?.message).toBe('Network timeout')
    })
  })
})
