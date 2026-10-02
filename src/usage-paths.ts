/** Constants shared by the usage route and the browser half. */

/**
 * Plugin-owned usage statistics endpoint (read-only GET).
 *
 * Query: `?from=YYYY-MM-DD&to=YYYY-MM-DD&days=N&tz=<offset-minutes>`.
 * Returns per-day aggregates, per-model aggregates, and storage figures.
 */
export const WORKBUDDY_USAGE_PATH = '/plugins/dsh-workbuddy-connect/usage'

/**
 * Usage maintenance endpoint (write).
 *
 * Separate from the read route because it changes state: folding a range into a
 * rollup, and — only when explicitly asked — deleting the detail it covers.
 * Like the probe and login routes it therefore also requires the in-process key
 * the browser half receives with the status document.
 */
export const WORKBUDDY_USAGE_MAINTENANCE_PATH = '/plugins/dsh-workbuddy-connect/usage/maintenance'

/** One action the maintenance route accepts. */
export type WorkBuddyUsageAction = 'compact' | 'clear'

/** Request body for {@link WorkBuddyUsageAction}. */
export interface WorkBuddyUsageMaintenanceRequest {
  action: WorkBuddyUsageAction
  /** Inclusive local-day range for `compact`, `YYYY-MM-DD`. */
  from?: string
  /** Inclusive local-day range for `compact`, `YYYY-MM-DD`. */
  to?: string
  /**
   * Whether `compact` should also delete the detail it folded.
   *
   * Defaults to `false`: folding is a *view* operation, and destroying raw data
   * must never be the silent side effect of asking for a summary.
   */
  purge?: boolean
}

/** Per-day row served to the browser half. */
export interface WorkBuddyUsageDayRow {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  requests: number
  /** Total prompt tokens (cached + uncached). */
  prompt: number
  /** Prompt tokens served from cache. */
  cacheHit: number
  /** Prompt tokens billed at full rate. */
  cacheMiss: number
  /** Generated tokens, reasoning included. */
  completion: number
  /** Reasoning tokens, when the upstream reported them. */
  reasoning: number
  /** Sum of the upstream's billed credits for the day (2-dp values). */
  credit: number
}

/** Per-model row served to the browser half. */
export interface WorkBuddyUsageModelRow {
  model: string
  requests: number
  prompt: number
  cacheHit: number
  cacheMiss: number
  completion: number
  credit: number
}

/** Storage and coverage figures for the ledger. */
export interface WorkBuddyUsageStorage {
  /** Byte size of the detail file. */
  bytes: number
  /** Number of stored records. */
  records: number
  /** Earliest record instant, absent when empty. */
  first?: string
  /** Latest record instant, absent when empty. */
  last?: string
  /** Rollups produced by explicit compaction. */
  rollups: number
}

/** The usage document the card renders. */
export interface WorkBuddyUsageDocument {
  /** Per-day aggregates, oldest first. */
  days: WorkBuddyUsageDayRow[]
  /** Per-model aggregates, largest credit first. */
  models: WorkBuddyUsageModelRow[]
  /** Totals over the requested window. */
  totals: Omit<WorkBuddyUsageDayRow, 'day'>
  storage: WorkBuddyUsageStorage
  /** The window actually applied, echoed back for the UI. */
  window: { from: string, to: string }
  /**
   * In-process key authorizing maintenance writes. Travels on this read
   * response for the same reason the probe key does: the response already
   * passed the loopback guard, and the key authorizes only ledger maintenance,
   * never credentials or completions.
   */
  key?: string
  /** Present when the ledger is unavailable in this composition. */
  unavailable?: string
}
