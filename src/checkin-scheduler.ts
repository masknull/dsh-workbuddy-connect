/**
 * Scheduling and catch-up orchestration for daily 10:00 (UTC+8) WorkBuddy check-in.
 *
 * @module dsh-workbuddy-connect/checkin-scheduler
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WorkBuddyCredential } from './auth.ts'
import { workbuddyStateDir } from './paths.ts'
import type { WorkBuddyUpstreamClient } from './upstream.ts'

export interface VariantCheckInTarget {
  variantId: string
  client: WorkBuddyUpstreamClient
  getCredential: () => Promise<WorkBuddyCredential | undefined>
  onClaimed?: () => void
}

export interface CheckInLogItem {
  id: string
  date: string
  timestamp: number
  status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error'
  amount?: number | undefined
  message?: string | undefined
}

export interface CheckInRecord {
  lastDate: string
  lastAt: number
  status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error'
  amount?: number | undefined
  message?: string | undefined
  logs?: CheckInLogItem[] | undefined
}

export interface CheckInStatusStore {
  read(variantId: string): CheckInRecord | undefined
  write(variantId: string, record: CheckInRecord): void
  clearLogs(variantId: string): void
}

export class JsonFileCheckInStore implements CheckInStatusStore {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(workbuddyStateDir(), 'checkin-status.json')
  }

  private readAll(): Record<string, CheckInRecord> {
    try {
      if (!existsSync(this.filePath)) return {}
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as Record<string, CheckInRecord>
    } catch {
      return {}
    }
  }

  read(variantId: string): CheckInRecord | undefined {
    return this.readAll()[variantId]
  }

  clearLogs(variantId: string): void {
    try {
      const all = this.readAll()
      if (all[variantId]) {
        all[variantId] = {
          ...all[variantId],
          logs: [],
        }
        mkdirSync(dirname(this.filePath), { recursive: true })
        writeFileSync(this.filePath, JSON.stringify(all, null, 2), 'utf-8')
      }
    } catch {
      // Best-effort persistence
    }
  }

  write(variantId: string, record: CheckInRecord): void {
    try {
      const all = this.readAll()
      const existing = all[variantId]
      const existingLogs = existing?.logs ?? []
      const newLog: CheckInLogItem = {
        id: `${record.lastDate}-${record.lastAt}`,
        date: record.lastDate,
        timestamp: record.lastAt,
        status: record.status,
        ...record.amount === undefined ? {} : { amount: record.amount },
        ...record.message === undefined ? {} : { message: record.message },
      }
      const updatedLogs = [newLog, ...existingLogs.filter(l => l.id !== newLog.id)].slice(0, 30)
      all[variantId] = {
        ...record,
        logs: updatedLogs,
      }
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(all, null, 2), 'utf-8')
    } catch {
      // Best-effort persistence
    }
  }
}

/**
 * Returns the current date in YYYY-MM-DD standardized on UTC+8 (Beijing Time).
 */
export function getUtc8DateString(nowMs: number = Date.now()): string {
  const d = new Date(nowMs)
  // Shift by timezone offset to UTC, then +8 hours (480 mins)
  const utc8 = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60_000)
  const y = utc8.getFullYear()
  const m = String(utc8.getMonth() + 1).padStart(2, '0')
  const day = String(utc8.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Calculates milliseconds until the next 10:00:05 AM in UTC+8.
 */
export function msUntilNext10amUtc8(nowMs: number = Date.now()): number {
  const d = new Date(nowMs)
  const utc8 = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60_000)

  // Target 10:00:05 today in UTC+8
  const targetUtc8 = new Date(utc8)
  targetUtc8.setHours(10, 0, 5, 0)

  // If already past 10:00:05 today, target tomorrow 10:00:05
  if (targetUtc8.getTime() <= utc8.getTime()) {
    targetUtc8.setDate(targetUtc8.getDate() + 1)
  }

  const diffMs = targetUtc8.getTime() - utc8.getTime()
  return Math.max(1_000, diffMs)
}

export interface CheckInSchedulerOptions {
  targets: VariantCheckInTarget[]
  isEnabled: (variantId: string) => boolean
  store?: CheckInStatusStore | undefined
}

export class CheckInScheduler {
  private readonly targets: VariantCheckInTarget[]
  private readonly isEnabled: (variantId: string) => boolean
  private readonly store: CheckInStatusStore
  private timer: NodeJS.Timeout | undefined
  private isDisposed = false

  constructor(options: CheckInSchedulerOptions) {
    this.targets = options.targets
    this.isEnabled = options.isEnabled
    this.store = options.store ?? new JsonFileCheckInStore()
  }

  start(): void {
    if (this.isDisposed) return
    // 1. Initial catch-up execution
    void this.executeOnce()
    // 2. Schedule next execution
    this.scheduleNext()
  }

  private scheduleNext(): void {
    if (this.isDisposed) return
    if (this.timer) clearTimeout(this.timer)

    const delay = msUntilNext10amUtc8()
    this.timer = setTimeout(() => {
      void this.executeOnce().finally(() => {
        this.scheduleNext()
      })
    }, delay)
    // Avoid blocking Node process exit in tests or tools
    if (this.timer.unref) {
      this.timer.unref()
    }
  }

  async executeOnce(): Promise<void> {
    const today = getUtc8DateString()
    const nowMs = Date.now()

    for (const target of this.targets) {
      if (!this.isEnabled(target.variantId)) continue

      const record = this.store.read(target.variantId)
      if (record && record.lastDate === today && (record.status === 'claimed' || record.status === 'already-claimed')) {
        continue
      }

      let credential: WorkBuddyCredential | undefined
      try {
        credential = await target.getCredential()
      } catch (err: unknown) {
        this.store.write(target.variantId, {
          lastDate: today,
          lastAt: nowMs,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      if (!credential || !credential.accessToken) {
        continue
      }

      try {
        const status = await target.client.fetchCheckinStatus(credential)
        if (!status.active) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'no-campaign',
            message: 'Check-in activity is not active',
          })
          continue
        }

        if (status.todayCheckedIn) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'already-claimed',
          })
          continue
        }

        const claim = await target.client.claimDailyCheckin(credential)
        if (claim.alreadyClaimed) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'already-claimed',
          })
          continue
        }
        if (claim.noCampaign) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'no-campaign',
            message: 'Check-in activity is not active',
          })
          continue
        }
        this.store.write(target.variantId, {
          lastDate: today,
          lastAt: nowMs,
          status: 'claimed',
          amount: claim.credit,
        })
        target.onClaimed?.()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('已签到') || message.includes('今天已签到') || message.includes('already')) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'already-claimed',
          })
          continue
        }
        if (message.includes('活动未开启') || message.includes('已过期') || message.includes('not active')) {
          this.store.write(target.variantId, {
            lastDate: today,
            lastAt: nowMs,
            status: 'no-campaign',
            message: 'Check-in activity is not active',
          })
          continue
        }
        this.store.write(target.variantId, {
          lastDate: today,
          lastAt: nowMs,
          status: 'error',
          message,
        })
      }
    }
  }

  dispose(): void {
    this.isDisposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
