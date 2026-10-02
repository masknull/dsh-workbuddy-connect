/**
 * The card's 「用量统计」 tab: what the account has actually spent.
 *
 * Everything here is **measured**, not estimated: the numbers come from the
 * plugin's own usage ledger, whose rows carry the upstream's billed `credit`
 * and the exact token split (see `docs/usage-ledger.md`).
 *
 * The panel answers four questions the upstream console cannot:
 *   1. how much credit and how many tokens each day cost;
 *   2. which model the spend went to;
 *   3. what that is in yuan, at the user's own plan rate;
 *   4. how to fold a date range into a summary — deliberately an explicit
 *      action, because destroying raw detail must never be a silent side effect.
 *
 * @module dsh-workbuddy-connect/client/UsageStatsPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  WORKBUDDY_USAGE_MAINTENANCE_PATH,
  WORKBUDDY_USAGE_PATH,
  type WorkBuddyUsageDocument,
} from '../usage-paths.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/**
 * Translator surface the panel needs.
 *
 * Typed against the plugin's own key union rather than `string`, so a typo in a
 * key is a compile error instead of a key rendered verbatim in the UI.
 */
export interface UsageStatsTranslator {
  (key: WorkBuddySettingsKey, vars?: Record<string, string | number>): string
}

/** Props for {@link UsageStatsPanel}. */
export interface UsageStatsPanelProps {
  t: UsageStatsTranslator
  /** Only fetched while the tab is visible. */
  open: boolean
}

/**
 * Plan rates in yuan per credit.
 *
 * Kept here rather than fetched: the price page is a marketing surface with no
 * stable machine-readable endpoint, and these are the published discount rates
 * the card's own copy states. A user on another plan picks another row.
 */
const PLAN_RATES: readonly { id: string, yuanPerCredit: number, credits: number, label: string }[] = [
  { id: 'advanced-year', yuanPerCredit: 199 * 0.56 / 9000, credits: 9000, label: '高级版 · 连续包年 ¥111.44/月' },
  { id: 'advanced-month', yuanPerCredit: 140 / 9000, credits: 9000, label: '高级版 · 连续包月 ¥140/月' },
  { id: 'advanced-once', yuanPerCredit: 199 / 9000, credits: 9000, label: '高级版 · 单月 ¥199' },
  { id: 'standard-month', yuanPerCredit: 70 / 4000, credits: 4000, label: '标准版 · 连续包月 ¥70/月' },
  { id: 'flagship-month', yuanPerCredit: 700 / 50000, credits: 50000, label: '旗舰版 · 连续包月 ¥700/月' },
  { id: 'topup', yuanPerCredit: 50 / 1000, credits: 1000, label: '加量包 ¥50/1000 积分' },
]

/** Check whether an unknown value is a usage document. */
function isUsageDocument(value: unknown): value is WorkBuddyUsageDocument {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Partial<WorkBuddyUsageDocument>
  return Array.isArray(doc.days) && Array.isArray(doc.models) && typeof doc.totals === 'object' && doc.totals !== null
}

/** Compact token formatting: 12.3亿 / 4,567万 / 1,234. */
function tokens(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return String(Math.round(value))
}

/** Two-decimal credit, grouping thousands. */
function credits(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Yuan with configurable precision (per-million figures need four). */
function yuan(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Local `YYYY-MM-DD` for an offset in days from today. */
function dayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const panel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 16 }
const row: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, fontSize: 13 }
const muted: CSSProperties = { opacity: 0.62, fontSize: 12 }
const buttons: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }
const control: CSSProperties = {
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  opacity: 0.85,
}
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid currentColor',
  fontSize: 11.5,
  opacity: 0.8,
  whiteSpace: 'nowrap',
}

/** Heading style matching the card's own section headings. */
const heading: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 600, opacity: 0.9 }
const para: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55 }
const paraError: CSSProperties = { ...para, opacity: 0.9, color: '#e5484d' }

/**
 * One day's bar, scaled against the busiest day in the window.
 *
 * A DOM bar rather than a chart canvas: this renders inside several dense
 * card layouts, and a fixed-height div needs no measurement to stay correct.
 */
function DayBar(props: { day: string, credit: number, max: number, yuanPerCredit: number }): JSX.Element {
  const { day, credit, max, yuanPerCredit } = props
  const pct = max > 0 ? Math.max(2, (credit / max) * 100) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={row}>
        <span style={muted}>{day}</span>
        <span>
          {credits(credit)} 积分
          <span style={muted}> · ¥{yuan(credit * yuanPerCredit)}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'currentColor', opacity: 0.14 }}>
        <div style={{ width: `${pct.toFixed(1)}%`, height: '100%', borderRadius: 3, background: 'currentColor', opacity: 0.85 }} />
      </div>
    </div>
  )
}

/**
 * The statistics panel.
 *
 * Reads the ledger route when the tab becomes visible and on demand. A
 * maintenance action posts with the in-process key the read document carried —
 * which is why this component never mints a key of its own.
 */
export function UsageStatsPanel(props: UsageStatsPanelProps): JSX.Element | null {
  const { t, open } = props
  const [doc, setDoc] = useState<WorkBuddyUsageDocument | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [planId, setPlanId] = useState<string>('advanced-month')
  const [windowDays, setWindowDays] = useState<number>(7)
  const [rangeFrom, setRangeFrom] = useState<string>(dayOffset(6))
  const [rangeTo, setRangeTo] = useState<string>(dayOffset(0))
  const [purge, setPurge] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const query = useMemo(() => (windowDays > 0 ? `?days=${String(windowDays)}` : ''), [windowDays])

  const read = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`${WORKBUDDY_USAGE_PATH}${query}`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      if (!isUsageDocument(value)) throw new Error(t('usageResponseInvalid'))
      if (!mounted.current) return
      setDoc(value)
      setFailure(undefined)
    } catch (error: unknown) {
      if (!mounted.current) return
      setFailure(error instanceof Error ? error.message : t('usageResponseInvalid'))
    }
  }, [query, t])

  useEffect(() => {
    if (!open) return
    void read()
  }, [open, read])

  const maintain = useCallback(async (action: 'compact' | 'clear'): Promise<void> => {
    const key = doc?.key
    if (key === undefined) return
    setBusy(true)
    setNotice(undefined)
    try {
      const response = await fetch(WORKBUDDY_USAGE_MAINTENANCE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workbuddy-key': key },
        credentials: 'same-origin',
        body: JSON.stringify(action === 'clear' ? { action } : { action, from: rangeFrom, to: rangeTo, purge }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      if (!mounted.current) return
      const folded = (value as { folded?: { requests?: number, credit?: number } }).folded
      setNotice(action === 'clear'
        ? t('usageCleared')
        : t('usageFolded', {
          requests: folded?.requests ?? 0,
          credit: credits(folded?.credit ?? 0),
          purged: purge ? t('usageFoldedPurged') : t('usageFoldedKept'),
        }))
      await read()
    } catch (error: unknown) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : t('usageResponseInvalid'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [doc?.key, purge, rangeFrom, rangeTo, read, t])

  if (!open) return null

  if (failure !== undefined && doc === undefined) {
    return (
      <div style={stack}>
        <p style={paraError}>{failure}</p>
        <div style={buttons}>
          <button type="button" style={control} onClick={() => { void read() }}>{t('usageRefresh')}</button>
        </div>
      </div>
    )
  }

  if (doc === undefined) return <p style={para}>{t('usageLoading')}</p>
  if (doc.unavailable !== undefined) return <p style={para}>{t('usageUnavailable')}</p>

  const plan = PLAN_RATES.find((entry) => entry.id === planId) ?? PLAN_RATES[1]!
  const maxDay = doc.days.reduce((max, day) => Math.max(max, day.credit), 0)
  const totalTokens = doc.totals.prompt + doc.totals.completion
  const creditPerMillion = totalTokens > 0 ? doc.totals.credit / (totalTokens / 1e6) : 0
  const cacheHitPct = doc.totals.prompt > 0 ? (doc.totals.cacheHit / doc.totals.prompt) * 100 : 0
  const windowLabel = doc.window.from === '' && doc.window.to === ''
    ? t('usageAllTime')
    : `${doc.window.from === '' ? '…' : doc.window.from} → ${doc.window.to === '' ? '…' : doc.window.to}`

  return (
    <div style={panel}>
      <div style={stack}>
        <div style={row}>
          <h3 style={heading}>{t('usageHeading')}</h3>
          <button type="button" style={control} disabled={busy} onClick={() => { void read() }}>
            {t('usageRefresh')}
          </button>
        </div>
        <div style={buttons}>
          {([{ id: 'usageToday', days: 1 }, { id: 'usage7Days', days: 7 }, { id: 'usage30Days', days: 30 }, { id: 'usageAllTime', days: 0 }] as const).map(entry => (
            <button
              key={entry.id}
              type="button"
              style={{ ...control, opacity: windowDays === entry.days ? 1 : 0.55 }}
              onClick={() => { setWindowDays(entry.days) }}
            >
              {t(entry.id)}
            </button>
          ))}
          <span style={muted}>{windowLabel}</span>
        </div>
      </div>

      <div style={stack}>
        <div style={row}>
          <span>{t('usageRequests')}</span>
          <span>{doc.totals.requests.toLocaleString('zh-CN')}</span>
        </div>
        <div style={row}>
          <span>{t('usageTokens')}</span>
          <span>
            {tokens(totalTokens)} token
            <span style={muted}> · 输入 {tokens(doc.totals.prompt)} / 输出 {tokens(doc.totals.completion)}</span>
          </span>
        </div>
        <div style={row}>
          <span>{t('usageCacheHit')}</span>
          <span>
            {cacheHitPct.toFixed(1)}%
            <span style={muted}> · {tokens(doc.totals.cacheHit)} token</span>
          </span>
        </div>
        <div style={row}>
          <span>{t('usageCredits')}</span>
          <span>
            {credits(doc.totals.credit)} 积分
            {doc.storage.rollups > 0
              ? <span style={muted}> · {t('usageRollupNote', { n: doc.storage.rollups })}</span>
              : null}
          </span>
        </div>
        <div style={row}>
          <span>{t('usageRate')}</span>
          <span style={muted}>{creditPerMillion > 0 ? `${creditPerMillion.toFixed(3)} 积分/1M token` : '—'}</span>
        </div>
      </div>

      {/* Yuan conversion at the plan rate the user picks. */}
      <div style={stack}>
        <div style={row}>
          <h3 style={heading}>{t('usageYuanHeading')}</h3>
          <select value={planId} onChange={(event) => { setPlanId(event.target.value) }} style={control}>
            {PLAN_RATES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </div>
        <div style={row}>
          <span>{t('usageYuanSpent')}</span>
          <span>¥{yuan(doc.totals.credit * plan.yuanPerCredit)}</span>
        </div>
        <div style={row}>
          <span>{t('usageYuanPerMillion')}</span>
          <span style={muted}>
            {creditPerMillion > 0 ? `¥${yuan(creditPerMillion * plan.yuanPerCredit, 4)} / 1M token` : '—'}
          </span>
        </div>
        <div style={buttons}>
          <span style={chip}>{t('usageQuota', { n: plan.credits.toLocaleString('zh-CN') })}</span>
        </div>
      </div>

      {doc.days.length > 0
        ? (
          <div style={stack}>
            <h3 style={heading}>{t('usageByDay')}</h3>
            {doc.days.map(day => (
              <DayBar key={day.day} day={day.day} credit={day.credit} max={maxDay} yuanPerCredit={plan.yuanPerCredit} />
            ))}
          </div>
        )
        : <p style={para}>{t('usageEmpty')}</p>}

      {doc.models.length > 0
        ? (
          <div style={stack}>
            <h3 style={heading}>{t('usageByModel')}</h3>
            {doc.models.map(model => (
              <div key={model.model} style={row}>
                <span style={{ fontSize: 12.5 }}>{model.model}</span>
                <span style={muted}>
                  {credits(model.credit)} 积分 · {model.requests.toLocaleString('zh-CN')} 次 · {tokens(model.prompt + model.completion)} token
                </span>
              </div>
            ))}
          </div>
        )
        : null}

      {/* Explicit maintenance: folding is a view action; purging is a choice. */}
      <div style={stack}>
        <h3 style={heading}>{t('usageMaintenanceHeading')}</h3>
        <p style={muted}>{t('usageMaintenanceHint')}</p>
        <div style={buttons}>
          <input type="date" value={rangeFrom} onChange={(event) => { setRangeFrom(event.target.value) }} style={control} />
          <span style={muted}>→</span>
          <input type="date" value={rangeTo} onChange={(event) => { setRangeTo(event.target.value) }} style={control} />
          <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={purge} onChange={(event) => { setPurge(event.target.checked) }} />
            {t('usagePurgeLabel')}
          </label>
          <button type="button" style={control} disabled={busy || doc.key === undefined} onClick={() => { void maintain('compact') }}>
            {t('usageFold')}
          </button>
          <button type="button" style={control} disabled={busy || doc.key === undefined} onClick={() => { void maintain('clear') }}>
            {t('usageClearAll')}
          </button>
        </div>
        <p style={muted}>{t('usageStorage', { kb: (doc.storage.bytes / 1024).toFixed(1), n: doc.storage.records })}</p>
        <p style={muted}>
          {doc.storage.first === undefined ? t('usageNoData') : `${doc.storage.first} → ${doc.storage.last ?? ''}`}
        </p>
        {notice === undefined ? null : <p style={para}>{notice}</p>}
      </div>
    </div>
  )
}
