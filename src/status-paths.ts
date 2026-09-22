/** Node-free constants and types shared by the Host and browser halves. */

/** Plugin-owned status endpoint consumed by its browser half. */
export const WORKBUDDY_STATUS_PATH = '/plugins/dsh-workbuddy-connect/status'

/**
 * Plugin-owned probe control endpoint.
 *
 * Separate from the status route because it accepts writes: the status route's
 * loopback Host/Origin guard protects against a DNS-rebinding *page*, which is
 * not the same as authorizing a state-changing action. This route therefore
 * also requires the in-process key the browser half receives with the status
 * document.
 */
export const WORKBUDDY_PROBE_PATH = '/plugins/dsh-workbuddy-connect/probe'

/**
 * The international (WorkBuddy AI) variant's own pair of routes.
 *
 * Kept as separate constants rather than a computed suffix so both halves
 * reference literal strings: the browser bundle and the host bundle are built
 * independently, and a shared expression is one build-config drift away from
 * the desk asking a route the host never mounted.
 */
export const WORKBUDDY_AI_STATUS_PATH = '/plugins/dsh-workbuddy-connect/ai/status'
export const WORKBUDDY_AI_PROBE_PATH = '/plugins/dsh-workbuddy-connect/ai/probe'

/**
 * Plugin-owned sign-in endpoints, one per variant.
 *
 * Each variant signs in against its own realm, so each needs its own route: the
 * realm is chosen by which provider the user is looking at, never by a value the
 * browser sends. A POST here starts an attempt (or polls one, or signs out);
 * see {@link WorkBuddyWebLoginRequest}.
 */
export const WORKBUDDY_LOGIN_PATH = '/plugins/dsh-workbuddy-connect/login'
export const WORKBUDDY_AI_LOGIN_PATH = '/plugins/dsh-workbuddy-connect/ai/login'

/**
 * One action the sign-in route accepts.
 *
 * `begin` returns the URL the human must open; `poll` reports whether that visit
 * has finished; `logout` removes the stored credential; `import` adopts a
 * credential document the user already has (a `workbuddy.json` from the sibling
 * tooling, or one exported from another machine). All four are writes — `begin`
 * holds a pending attempt, `import` and `poll` commit a credential — which is why
 * they share this route's in-process key rather than the read-only status GET.
 */
export type WorkBuddyWebLoginAction = 'begin' | 'poll' | 'logout' | 'import'

/** Request body accepted by the sign-in route. */
export interface WorkBuddyWebLoginRequest {
  action: WorkBuddyWebLoginAction
  /** The attempt to poll; required for `poll` and ignored otherwise. */
  state?: string
  /**
   * The credential document to adopt; required for `import`.
   *
   * Travels as text rather than as a path because the browser has no filesystem:
   * the card reads the file the user picked and posts its contents. The host
   * parses and validates it before anything is written.
   */
  document?: string
}

/**
 * Progress of one sign-in attempt, as the card renders it.
 *
 * `pending` carries the URL to open so a card that lost the `begin` response
 * (a re-render, a second tab) can still show where to go. `imported` reports a
 * document that was adopted, with the account it belongs to. `failed` is a
 * diagnosis, not an error page: the upstream or the network refused, and the
 * message says which.
 */
export type WorkBuddyWebLoginResult =
  | { status: 'pending'; state: string; url?: string }
  | { status: 'complete'; nickname?: string }
  | { status: 'imported'; uid?: string; nickname?: string }
  | { status: 'signed-out' }
  | { status: 'failed'; message: string }

/** One model's recorded probe observation, as the card displays it. */
export interface WorkBuddyWebProbeModel {
  id: string
  name: string
  /** `validating` results carry efforts; the other states never do. */
  validation: 'validating' | 'non-validating' | 'unknown'
  efforts: readonly string[]
  probedAt: number
}

/** Probe section of the status document. */
export interface WorkBuddyWebProbeSection {
  /** Whether the user has authorized probing. */
  consent: boolean
  /** Whether a sweep is in flight right now. */
  running: boolean
  /** Models the user could probe by hand (undeclared yet reasoning-capable). */
  candidates: readonly string[]
  /** Recorded observations. */
  results: readonly WorkBuddyWebProbeModel[]
}

/** Action requested from the probe control route. */
export interface WorkBuddyProbeAction {
  /**
   * `probe` spends credit on one model; `clear` drops recorded observations;
   * `refresh` re-reads the credential and re-fetches the model catalog;
   * `set-maximum-context-window` persists the international card preference;
   * `clear-checkin-logs` clears the check-in history;
   * `checkin` triggers an immediate check-in attempt.
   *
   * All are writes, which is why they share this route's in-process key
   * and loopback guards rather than the read-only status GET.
   */
  action: 'probe' | 'clear' | 'refresh' | 'set-maximum-context-window' | 'clear-checkin-logs' | 'checkin'
  /** Target model id; required for `probe`. */
  model?: string
  /** Requested value for `set-maximum-context-window`. */
  enabled?: boolean
}

/**
 * Where the models a card is currently showing came from.
 *
 * The plan requires the card to distinguish a live catalog from the built-in
 * fallback, and to say when the last attempt failed — otherwise a stale list is
 * indistinguishable from an offline one, and a user cannot tell whether the
 * models they see still match the upstream.
 */
export interface WorkBuddyWebCatalog {
  /**
   * Where the models on screen came from, in degradation order:
   * `live` (fetched now) → `saved` (this account's last successful fetch,
   * restored after a restart or a failed fetch) → `fallback` (the roster
   * compiled into the plugin). The card distinguishes them because "stale" and
   * "offline with a saved list" are different situations for the user.
   */
  source: 'live' | 'saved' | 'fallback'
  /** When the live catalog last succeeded, epoch ms. */
  fetchedAt?: number
  /** App version used as the catalog User-Agent, when the variant needed one. */
  appVersion?: string
  /** Why the most recent fetch failed, when it did, redacted for display. */
  error?: string
}

/** One billing package and its remaining credit. */
export interface WorkBuddyWebCreditAccount {
  packageName: string
  remain: number
  size: number
  unlimited?: true
  /**
   * The package's expiry as the upstream reported it (`"YYYY-MM-DD HH:mm:ss"`,
   * UTC+8 wall clock), absent when the upstream reported none. Renderers group
   * by it but never parse it into a date for display — an unparseable string
   * stays opaque rather than becoming a fabricated date.
   */
  packageEndTime?: string
}

/** Aggregated credit answer rendered by the plugin card. */
export interface WorkBuddyWebCredits {
  /** Summed remaining credit across all packages. */
  total: number
  /**
   * Summed per-package totals — the denominator of the dashboard's overall
   * bar. The upstream's `TotalDosage` floor is applied host-side when larger.
   * Absent from older host documents: the dashboard falls back to the
   * package sum and renders the overall bar as indeterminate when the sum
   * is 0.
   */
  totalSize?: number
  accounts: readonly WorkBuddyWebCreditAccount[]
  unlimited?: true
  cycleResetTime?: string
}

/** Billing convenience facts for one model, rendered as card badges. */
export interface WorkBuddyWebModelBadge {
  id: string
  name: string
  /** Whether the model is currently free (`x0.00` credits). */
  free?: boolean
  /** Promotional badges, e.g. `限时免费`, `夜间折扣`. */
  badges?: readonly string[]
  /**
   * Credits multiplier in display form, e.g. `x0.79`. Unlike the model
   * picker's copy, the card renders through the browser locale, so this value
   * may be interpolated into a localized sentence rather than shown bare.
   */
  credits?: string
  /**
   * The rate cannot be stated right now, and the card must say so.
   *
   * Set for a row whose price came from a promotion that has since ended: the
   * upstream bakes the discounted value into the cached row, and the original
   * price is not recoverable from it, so neither the old figure nor `free` may
   * be repeated. The card renders "refresh to see the price" instead.
   */
  rateUnknown?: true
  /**
   * Context capacity in tokens, taken verbatim from the upstream
   * `maxAllowedSize`/`maxInputTokens`, or from the international document's
   * `contextWindow.defaultLength` when it declares one.
   *
   * The international card can opt into the largest declared alternative. The
   * selected value is what DSH receives as its actual context budget.
   */
  contextWindow?: number
  /** The upstream default, when the card currently uses a selected maximum. */
  defaultContextWindow?: number
  /**
   * The international document's larger selectable window, when it declares
   * one, and the model's maximum input ceiling.
   *
   * Kept apart from {@link contextWindow} because they answer different
   * questions: `contextWindow` is the budget the plugin actually requests under,
   * while these are facts about what the upstream will accept. Showing the 1M
   * ceiling as though it were the working window would overstate the budget.
   */
  maxContextWindow?: number
  maxInputTokens?: number
}

/** The JSON document the plugin card renders. */
export type WorkBuddyWebStatus =
  | {
    status: 'signed-in'
    nickname?: string
    domain?: string
    /** Which realm the stored credential belongs to. */
    region?: 'cn' | 'global'
    expiresAt?: number
    credits?: WorkBuddyWebCredits
    creditsError?: string
    /** Billing convenience facts for the models the plugin serves. */
    models?: readonly WorkBuddyWebModelBadge[]
    /** Where those models came from, and whether the last fetch failed. */
    catalog?: WorkBuddyWebCatalog
    /** Reasoning-effort probe state, consent, and recorded observations. */
    probe?: WorkBuddyWebProbeSection
    /** International-card preference selecting larger declared context windows. */
    useMaximumContextWindow?: boolean
    /**
     * In-process key authorizing probe control writes. Handed to the card with
     * the status document (the card is same-origin and already had to pass the
     * loopback guard); it is never persisted and rotates per process.
     */
    probeKey?: string
    /**
     * Daily check-in status record and logs for this variant.
     */
    checkIn?: {
      lastDate: string
      lastAt: number
      status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error'
      amount?: number | undefined
      message?: string | undefined
      logs?: readonly {
        id: string
        date: string
        timestamp: number
        status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error'
        amount?: number | undefined
        message?: string | undefined
      }[] | undefined
    }
    /**
     * In-process key authorizing sign-in writes, including signing out. Travels
     * with the document for the same reason `probeKey` does.
     */
    loginKey?: string
  }
  | {
    /**
     * Nobody is signed in, and the card may sign in.
     *
     * Its own arm rather than an optional field on the signed-in document,
     * because the sign-in key below is exactly what a signed-out card needs and
     * a signed-in one does not: the two states ask for different actions, and a
     * single arm would let a card offer sign-out and sign-in at once.
     */
    status: 'signed-out'
    /**
     * Why no credential is usable, when that is diagnosable rather than simply
     * "nobody signed in" — today a credential belonging to the other product.
     * The card renders it in place of the generic sign-in hint.
     */
    reason?: string
    /**
     * In-process key authorizing sign-in writes; see the signed-in arm's
     * `probeKey` for why it travels with the document.
     */
    loginKey?: string
  }
  | { status: 'error'; message: string }
