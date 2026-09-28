/**
 * Shared live flags for the quota cards, mirrored from the settings document.
 *
 * The settings scope lives in one place (the quota-settings card binds it),
 * but three surfaces read the derived values: the settings card itself, and
 * the two sidebar quota cards. This module is the meeting point — plain
 * mutable module state plus a revision counter, so React components can
 * subscribe through useSyncExternalStore and re-render when a saved toggle
 * flips, without prop-drilling through slot injections.
 *
 * Sign-in state: every surface that polls a status route (the settings card's
 * own lightweight probe, the sidebar cards, the dashboard) reports what it
 * saw through {@link noteQuotaSignIn}. The settings card polls on its own
 * because it must gate its toggles even while both sidebar cards are OFF —
 * the sidebar cards' polls do not run then.
 */

/* ---- the plugin-owned settings seam ---- */

/**
 * Client-side sync state of one settings section.
 *
 * Field-for-field the shape the host's settings face publishes over this
 * plugin's own route (status / value / writable). Only the members the cards
 * read are restated here.
 */
export interface SettingsScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  value: T | undefined
  /** Whether the host document accepts writes; memory mode never does. */
  writable: boolean
}

/**
 * One configuration section's controller, structurally re-stated.
 *
 * The browser half reaches this through the plugin's own settings face
 * (`./http-settings-scope.ts`), which speaks the same
 * snapshot/subscribe/set contract over the plugin's own JSON file — so a type
 * restatement keeps the cards branch-free without importing any host value.
 */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T>
  /** Observe snapshot replacements; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Queue one field write, in the section's own field names. */
  set(field: string, value: unknown): Promise<unknown>
}

/** Whether each variant is signed in, as far as the last status poll knows. */
export interface QuotaSignInState {
  cn: boolean
  ai: boolean
}

let pollIntervalMs = 300_000
const toggles = { cn: false, ai: false }
/**
 * Reference-stable views of the two mutable records below.
 *
 * `useSyncExternalStore` compares snapshots by IDENTITY, so a getter that
 * builds a fresh object on every call makes its subscriber re-render forever
 * and React kills the entry (error #185 — the same crash the settings card's
 * unstable projection caused). The snapshot objects are therefore replaced
 * wholesale only when the underlying record actually changes.
 */
let togglesSnapshot: QuotaSignInState = { cn: false, ai: false }
const signIn: QuotaSignInState = { cn: false, ai: false }
let signInSnapshot: QuotaSignInState = { cn: false, ai: false }
let revision = 0
const listeners = new Set<() => void>()

function bump(): void {
  revision += 1
  for (const listener of listeners) listener()
}

/** Update the shared poll interval (from the settings document). */
export function setQuotaPollMs(ms: number): void {
  if (Number.isFinite(ms) && ms >= 60_000 && pollIntervalMs !== ms) {
    pollIntervalMs = ms
    bump()
  }
}

/** Read the configured poll interval. */
export function quotaPollMs(): number {
  return pollIntervalMs
}

/** Update both sidebar toggles (from the settings document). */
export function setQuotaToggles(cn: boolean, ai: boolean): void {
  if (toggles.cn !== cn || toggles.ai !== ai) {
    toggles.cn = cn
    toggles.ai = ai
    togglesSnapshot = { ...toggles }
    bump()
  }
}

/** Read the current toggles. */
export function quotaToggles(): QuotaSignInState {
  return togglesSnapshot
}

/** Record a variant's sign-in state from any successful status poll. */
export function noteQuotaSignIn(variantId: string, signedIn: boolean): void {
  if (variantId === 'workbuddy' && signIn.cn !== signedIn) {
    signIn.cn = signedIn
    signInSnapshot = { ...signIn }
    bump()
  } else if (variantId === 'workbuddy-ai' && signIn.ai !== signedIn) {
    signIn.ai = signedIn
    signInSnapshot = { ...signIn }
    bump()
  }
}

/** Read the cached sign-in state. */
export function quotaSignInState(): QuotaSignInState {
  return signInSnapshot
}

/** Subscribe to any flag change; returns the disposer. */
export function onQuotaSettingsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current revision — the useSyncExternalStore snapshot value. */
export function quotaSettingsRevision(): number {
  return revision
}

/** Which variant a status route belongs to, from the route path. */
export function variantOfStatusPath(statusPath: string): 'workbuddy' | 'workbuddy-ai' {
  return statusPath.includes('/ai/') ? 'workbuddy-ai' : 'workbuddy'
}

/* ---- shared status documents ---- */

/**
 * The last status document per variant, shared by EVERY quota surface.
 *
 * The sidebar cards and the dashboard each used to fetch independently, so a
 * dashboard refresh updated the panel while the sidebar card kept showing its
 * previous read until its own next tick — two different numbers for one
 * account on one screen. One store, one write path
 * ({@link noteQuotaStatus}), and every subscriber re-renders through the
 * same revision: whatever surface refreshed last, all of them show it.
 *
 * Documents are kept by identity (never mutated), so reference comparisons
 * in useSyncExternalStore selectors stay cheap and stable.
 */
const statusDocuments: { cn: import('../status-paths.ts').WorkBuddyWebStatus | undefined; ai: import('../status-paths.ts').WorkBuddyWebStatus | undefined } = { cn: undefined, ai: undefined }

/**
 * Publish one variant's freshly fetched status document. Downstream
 * subscribers (both sidebar cards and the dashboard, through whichever
 * observable wraps this store) re-render on the revision bump.
 */
export function noteQuotaStatus(variantId: string, status: import('../status-paths.ts').WorkBuddyWebStatus): void {
  if (variantId === 'workbuddy' && statusDocuments.cn !== status) {
    statusDocuments.cn = status
    statusFetchedAt.cn = Date.now()
    bump()
  } else if (variantId === 'workbuddy-ai' && statusDocuments.ai !== status) {
    statusDocuments.ai = status
    statusFetchedAt.ai = Date.now()
    bump()
  }
  // Also record the sign-in fact the toggles gate on.
  noteQuotaSignIn(variantId, status.status === 'signed-in')
}

/** Read one variant's latest status document. */
export function quotaStatus(variantId: 'workbuddy' | 'workbuddy-ai'): import('../status-paths.ts').WorkBuddyWebStatus | undefined {
  return variantId === 'workbuddy' ? statusDocuments.cn : statusDocuments.ai
}

/** When each variant's document was last fetched (per publish, not per read). */
const statusFetchedAt: { cn: number | undefined; ai: number | undefined } = { cn: undefined, ai: undefined }

/** Read the time a variant's current document was fetched, if any. */
export function quotaStatusFetchedAt(variantId: 'workbuddy' | 'workbuddy-ai'): number | undefined {
  return variantId === 'workbuddy' ? statusFetchedAt.cn : statusFetchedAt.ai
}

/**
 * Whether ONE variant's shared document is fresh enough to skip a fetch:
 * the user's rule — a click/mount/interval tick within the configured
 * interval of the last successful read reuses the cached document, and only
 * a variant with NO result yet (or a failed read that never landed one)
 * forces the upstream call. The interval is a cache lifetime, not a metronome.
 *
 * A `maxAgeMs` of the poll interval comes from the settings document; a
 * failed last read is NOT tracked here (callers gate failures themselves),
 * because "the last read failed" still means "no usable result".
 *
 * @param variantId - which variant's freshness to test.
 * @param maxAgeMs - the configured poll interval (cache lifetime).
 */
export function quotaStatusIsFresh(variantId: 'workbuddy' | 'workbuddy-ai', maxAgeMs: number): boolean {
  const fetchedAt = variantId === 'workbuddy' ? statusFetchedAt.cn : statusFetchedAt.ai
  const document = variantId === 'workbuddy' ? statusDocuments.cn : statusDocuments.ai
  // No document yet = never a result = always stale, whatever the clock says.
  if (fetchedAt === undefined || document === undefined) return false
  return Date.now() - fetchedAt < maxAgeMs
}
