/**
 * WorkBuddy models for DeepSeek Harness, reusing the WorkBuddy desktop apps'
 * sign-in. Registers one provider per product variant — `workbuddy` for the CN
 * app and `workbuddy-ai` for the international one — while streaming, tool
 * calls, compaction, and permissions stay Harness-owned.
 *
 * The two variants are assembled by the same factory and differ only in their
 * {@link WorkBuddyVariant} descriptor: each gets its own credential store,
 * catalog, upstream client, shim, adapter, probe state, and routes. Neither
 * variant's startup, catalog fetch, or credential state can stop the other from
 * registering — a user with only one app installed sees only that group.
 *
 * @module dsh-workbuddy-connect
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-attachment'
import { WorkBuddyCredentialStore, WORKBUDDY_CREDENTIAL_SOURCE, type WorkBuddyCredential } from './auth.ts'
import { WorkBuddyLoginClient, resolveLoginRegion, type WorkBuddyLoginAttempt } from './login.ts'
import { registerWorkBuddyLoginRoute } from './login-route.ts'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, WorkBuddyCatalog } from './catalog.ts'
import { workbuddyCatalogPath, WorkBuddyCatalogStore } from './catalog-store.ts'
import { createWorkBuddyAdapter } from './adapter.ts'
import { createWorkBuddyShim } from './shim.ts'
import { WorkBuddyProbeService } from './probe-service.ts'
import { newestFirst, WorkBuddyProbeStore, workbuddyProbePath } from './probe-store.ts'
import { WorkBuddyUpstreamClient } from './upstream.ts'
import { registerWorkBuddyStatusRoute } from './web-status.ts'
import { createProbeKey, registerWorkBuddyProbeRoute } from './probe-route.ts'
import { createLoginKey } from './login-route.ts'
import type { WorkBuddyModelInfo } from './catalog.ts'
import type { WorkBuddyWebCatalog, WorkBuddyWebProbeSection } from './status-paths.ts'
import { clearHostHeartbeat, writeHostHeartbeat } from './host-heartbeat.ts'
import { WORKBUDDY_CONNECT_VERSION } from './version.ts'
import { WORKBUDDY_CONFIG_ENTRY_ID } from './config-entry.ts'
import { CN_VARIANT, WORKBUDDY_VARIANTS, type WorkBuddyVariant } from './variants.ts'
import { WorkBuddyCheckInService, type WorkBuddyCheckInResult } from './checkin.ts'
import { SettingsStore } from './settings-store.ts'
import {
  CheckInScheduler,
  DEFAULT_CHECK_IN_MINUTE,
  JsonFileCheckInStore,
  normalizeCheckInMinute,
} from './checkin-scheduler.ts'

export { WORKBUDDY_PROVIDER, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, createWorkBuddyAdapter, type WorkBuddyAdapter } from './adapter.ts'
export { createWorkBuddyShim, type WorkBuddyShim } from './shim.ts'
export {
  UsageLedger,
  createUsageTap,
  localDay,
  modelOf,
  recordFrom,
  scanSse,
  sumRecords,
  type LedgerRegion,
  type UsageDay,
  type UsageRecord,
  type UsageTap,
  type UsageTotals,
} from './usage-ledger.ts'
export {
  FALLBACK_WORKBUDDY_AI_MODELS,
  FALLBACK_WORKBUDDY_MODELS,
  WorkBuddyCatalog,
  type WorkBuddyModelInfo,
} from './catalog.ts'
export {
  WORKBUDDY_CATALOG_FILENAME,
  workbuddyCatalogPath,
  WorkBuddyCatalogStore,
} from './catalog-store.ts'
export {
  fingerprintModel,
  WorkBuddyProbeStore,
  workbuddyProbePath,
  WORKBUDDY_PROBE_FILENAME,
  type WorkBuddyProbeRecord,
  type WorkBuddyProbeValidation,
} from './probe-store.ts'
export {
  PROBE_EFFORT_CANDIDATES,
  randomSentinel,
  probeModel,
  type ProbeAttempt,
  type ProbeOutcome,
  type ProbeSender,
} from './probe.ts'
export { WorkBuddyProbeService, type WorkBuddyProbeStatus } from './probe-service.ts'
export {
  AI_VARIANT,
  CN_VARIANT,
  variantFor,
  WORKBUDDY_VARIANTS,
  type WorkBuddyVariant,
} from './variants.ts'
export {
  appUserAgent,
  installedAppVersion,
  readBundleVersion,
  resolveAppVersion,
  validAppVersion,
  WORKBUDDY_APP_VERSION_FILENAME,
  type AppVersionInfo,
  type WorkBuddyAppVersionSource,
} from './app-version.ts'
export {
  CN_APP_VERSION_FILENAME,
  FALLBACK_CN_APP_VERSION,
  chatUserAgent,
  fallbackChatIdentity,
  readCliVersion,
  resolveChatIdentity,
  validCliVersion,
  type ChatIdentity,
  type ResolveChatIdentityOptions,
} from './client-identity.ts'
export {
  parseWorkBuddyAuth,
  WORKBUDDY_AUTH_FILENAME,
  WORKBUDDY_CREDENTIAL_SOURCE,
  WORKBUDDY_DATA_DIR_ENV,
  WORKBUDDY_DATA_DIR_NAME,
  WorkBuddyCredentialStore,
  workbuddyOwnAuthPath,
  workbuddyPluginDataDir,
  type WorkBuddyAuthStatus,
  type WorkBuddyCredential,
} from './auth.ts'
export {
  LOGIN_PENDING_CODE,
  normalizeLoginRegion,
  resolveLoginRegion,
  WorkBuddyLoginClient,
  type WorkBuddyLoginAccount,
  type WorkBuddyLoginAttempt,
  type WorkBuddyLoginPoll,
  type WorkBuddyLoginTokens,
} from './login.ts'
export {
  createLoginKey,
  registerWorkBuddyLoginRoute,
  workBuddyLoginHandler,
  type WorkBuddyLoginRouteOptions,
} from './login-route.ts'
export {
  WORKBUDDY_AI_LOGIN_PATH,
  WORKBUDDY_LOGIN_PATH,
  type WorkBuddyWebLoginAction,
  type WorkBuddyWebLoginRequest,
  type WorkBuddyWebLoginResult,
} from './status-paths.ts'
export {
  classifyUpstreamError,
  modelWithCurrentPromotion,
  normalizeCredits,
  parseModelCatalog,
  prepareChatBody,
  prepareInternationalChatBody,
  regionOf,
  WorkBuddyUpstreamClient,
  type UpstreamErrorKind,
  type WorkBuddyCatalogFetch,
  type WorkBuddyChatResult,
  type WorkBuddyCredits,
  type WorkBuddyEffort,
  type WorkBuddyModelBilling,
  type WorkBuddyModelReasoning,
  type WorkBuddyPromotion,
  type WorkBuddyRefreshOutcome,
  type WorkBuddyUpstreamModel,
} from './upstream.ts'
export {
  WORKBUDDY_HOST_HEARTBEAT_FILENAME,
  clearHostHeartbeat,
  isHeartbeatProcessAlive,
  processStartTimeMs,
  readHostHeartbeat,
  workbuddyHostHeartbeatPath,
  type WorkBuddyHostHeartbeat,
} from './host-heartbeat.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-workbuddy'

/** The model registry required before the provider can register. */
export const inject = ['llm']

/**
 * Settings namespace owning the CN card's section.
 *
 * DSH 0.1.2 dropped the `settingsNamespace()` branding function: a namespace is
 * now a nominal string, validated by the type system where it is used rather
 * than at runtime by a function call. The brand is compile-time only, so this
 * stays the plain string it always was — every comparison, descriptor lookup,
 * and `dsh` config file still sees `'workbuddy'`. It is cast once here so the
 * public constant carries the seam's type without pulling the brand helper
 * into this package (upstream DSH plugins, `dsh-llm-pi-ai` included, pass
 * their namespaces as plain string literals).
 */
export const WORKBUDDY_SETTINGS_NS = 'workbuddy' as SettingsNamespace

/**
 * Settings namespace owning the international card's section.
 *
 * The international variant keeps its own namespace so its section (and the
 * card reading it) stays separate from the domestic one. The host's
 * per-namespace card dispatch (the 0.1.5 Plugins tab) is gone; both namespaces
 * remain served on the plugin's own settings face as section identities.
 */
export const WORKBUDDY_AI_SETTINGS_NS = 'workbuddy-ai' as SettingsNamespace

/**
 * Settings namespace owning the shared quota-card section.
 *
 * One card above the two variant cards configures both sidebar quota widgets
 * (CN and international) from a single place, so its toggles cannot live in
 * either variant's section — they are per-variant fields on a cross-variant
 * card.
 */
export const WORKBUDDY_QUOTA_SETTINGS_NS = 'workbuddy-quota' as SettingsNamespace

/**
 * Plugin-owned settings endpoint consumed by its browser half.
 *
 * GET answers the whole entry configuration as three layers (value/base/user)
 * plus the write key; POST applies one patch. This is the plugin's own settings
 * surface, replacing writes through the host's settings service — see
 * {@link ./settings-store.ts} for why.
 */
export const WORKBUDDY_SETTINGS_FACE_PATH = '/plugins/dsh-workbuddy-connect/settings'

/**
 * How often the credential files are re-checked, in milliseconds.
 *
 * A startup-only catalog fetch cannot notice a sign-in that happens while DSH
 * is already running, so the model group would not appear until a restart. This
 * poll is a cheap existence/parse read of at most a few local files: it never
 * contacts the network and never runs a reasoning probe.
 *
 * `DSH_WORKBUDDY_POLL_MS` overrides it. That exists so the sweep can be
 * exercised end to end in tests and shortened while diagnosing a slow sign-in
 * on a real machine; it is not a product setting and no UI exposes it. The
 * value is clamped to a sane range so a mistaken override cannot turn the poll
 * into a busy loop.
 */
const CREDENTIAL_POLL_MS = 30_000

/** Floor and ceiling for the overridable poll interval. */
const MIN_POLL_MS = 100
const MAX_POLL_MS = 24 * 60 * 60 * 1000

/** Resolve the sweep interval, honoring the override when it is usable. */
function credentialPollMs(): number {
  const override = Number(process.env['DSH_WORKBUDDY_POLL_MS'])
  if (!Number.isFinite(override) || override < MIN_POLL_MS) return CREDENTIAL_POLL_MS
  return Math.min(override, MAX_POLL_MS)
}

/**
 * How long to wait before retrying a catalog fetch that failed.
 *
 * The credential sweep deliberately does not re-fetch a catalog it already has
 * (a same-identity token rotation carries no new model information). But a
 * *failed* fetch must not be treated the same way: without a retry, one
 * transient network blip at startup would leave the group on the built-in
 * fallback roster until the user noticed and pressed refresh. This bound keeps
 * that recovery automatic while still honoring the "not every round" rule — at
 * most one attempt per interval, and none at all once a live catalog lands.
 *
 * Expressed as a multiple of the sweep rather than a fixed duration so the two
 * stay in proportion under the `DSH_WORKBUDDY_POLL_MS` override.
 */
const CATALOG_RETRY_SWEEPS = 10

/** Plugin configuration. */
export interface Config {
  /**
   * Whether the user has authorized sending probe requests about reasoning
   * efforts. Off by default: a probe spends real credit, so nothing is sent
   * until the user explicitly agrees.
   */
  probeConsent?: boolean
  /** Use the largest context window the international catalog explicitly offers. */
  useMaximumContextWindow?: boolean
  /** Disabled model IDs for China variant. */
  disabledModelsCN?: string[]
  /** Disabled model IDs for international variant. */
  disabledModelsAI?: string[]
  /** Show the CN variant's sidebar quota card. */
  sidebarQuotaCN?: boolean
  /** Show the international variant's sidebar quota card. */
  sidebarQuotaAI?: boolean
  /** Automatically check in daily at 10:00 (UTC+8) to claim credits for China variant. */
  autoCheckInCN?: boolean
  /** Automatically check in daily at 10:00 (UTC+8) to claim credits for AI variant. */
  autoCheckInAI?: boolean
  /** When the China variant checks in, as minutes past midnight in UTC+8 (600 = 10:00). */
  checkInMinuteCN?: number
  /** When the AI variant checks in, as minutes past midnight in UTC+8 (600 = 10:00). */
  checkInMinuteAI?: number
  /**
   * Sidebar quota refresh interval in milliseconds. One shared value (both
   * cards poll on it) because the two widgets hit the same rate-limited
   * upstream family; the floor guards against a typo hammering the billing
   * endpoint, which serves no cache.
   */
  quotaPollMs?: number
}

/**
 * Mark one user-editable configuration field as volatile — where the running
 * schemastery knows what that means.
 *
 * DSH 0.1.7 projects a Config field into its settings form only when the field
 * carries `meta.volatile`, and parses such a field into a stable reference the
 * Host reads back through `.get()` (see {@link readField}). DSH 0.1.5's
 * schemastery has no `volatile` method at all, so an unconditional call would
 * throw a TypeError while this module is being imported and take the whole Host
 * half down with it. The method is therefore probed per field and a schema
 * without it is returned untouched: 0.1.5 keeps parsing and reading plain
 * values, which is exactly its old behaviour.
 *
 * Each editable field is marked WHOLE (one top-level field, one fixed path):
 * a volatile field may not enclose another, and the 0.1.7 client writes
 * single-segment paths (`path: ['sidebarQuotaCN']`) that the Host validates
 * against exactly this mark.
 *
 * @param field - the schemastery field to mark.
 * @returns the volatile schema on 0.1.7, the same schema unchanged on 0.1.5.
 */
function volatileField<T>(field: T): T {
  const candidate = field as { volatile?: () => T; extra?: (key: string, value: unknown) => T; meta?: Record<string, unknown> }
  if (typeof candidate.volatile === 'function') return candidate.volatile()
  if (typeof candidate.extra === 'function') return candidate.extra('volatile', true)
  if (candidate && typeof candidate === 'object') {
    candidate.meta = { ...candidate.meta, volatile: true }
    return candidate as T
  }
  return field
}

/**
 * Read one configuration field compatibly across both host lines.
 *
 * On 0.1.7 a field marked volatile is parsed into a `Volatile<T>` reference and
 * MUST be read through `.get()` — the built-in plugins do exactly that
 * (`dsh-agent-default-model`: `this.config.provider.get()`), and a raw read
 * yields the reference object rather than the value. On 0.1.5 the same field is
 * the plain value, so a raw read stays correct there. Every read of a volatile
 * field goes through this one reader, which is what keeps a single code path
 * correct on both lines.
 *
 * @param source - the configuration object (or section source) to read.
 * @param field - the field name.
 * @returns the field's value, or undefined when the source carries none.
 */
function readField<K extends keyof Config>(source: Config | undefined, field: K): Config[K] {
  const value = (source as Record<string, unknown> | undefined)?.[field]
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    return (value as { get: () => Config[K] }).get()
  }
  return value as Config[K]
}

/**
 * The seams one installed settings section reports through.
 *
 * `setSource` publishes the section's live reader (the Host scope once one
 * exists, the composition entry otherwise), and `onChange` is called whenever
 * that section's values move. Identical on both host lines that serve sections.
 */
interface SettingsSectionHooks {
  setSource(source: () => Config): void
  onChange(): void
}

/** Probe authorization (shared by the plugin schema and the CN section). */
const PROBE_CONSENT_FIELD = volatileField(z.boolean().default(false)
  .description('Authorize reasoning-effort probes (each probe sends real requests that may consume credit)'))
const MAXIMUM_CONTEXT_WINDOW_FIELD = volatileField(z.boolean().default(true)
  .description('Use the largest context window declared by WorkBuddy AI when alternatives are available (on by default)'))
const DISABLED_MODELS_FIELD = volatileField(z.array(z.string()).default([])
  .description('Disabled model IDs for this variant (empty by default)'))

/** Sidebar quota toggle (one per variant; both live on the shared quota card). */
const QUOTA_TOGGLE_FIELD = volatileField(z.boolean().default(false)
  .description('Show this variant’s remaining-credit card in the sidebar footer (off by default)'))
/** Automatic check-in toggle. */
const AUTO_CHECK_IN_FIELD = volatileField(z.boolean().default(false)
  .description('每天自动签到领取算力额度（默认关闭）'))
/**
 * When a variant checks in, as minutes past midnight in UTC+8.
 */
const CHECK_IN_MINUTE_FIELD = volatileField(z.number()
  .default(DEFAULT_CHECK_IN_MINUTE)
  .min(0)
  .max(1439)
  .description('每日自动签到的时刻（自 UTC+8 午夜起的分钟数，600 = 10:00）'))
/**
 * Quota poll interval: default 5 minutes, floor 1 minute. The status route
 * performs a live upstream billing call per request with no cache, so an
 * aggressively small interval translates directly into upstream load; the
 * floor is the smallest value the UI offers rather than a silent clamp —
 * smaller staged values fail Host validation and refuse to save.
 */
export const QUOTA_POLL_DEFAULT_MS = 300_000
export const QUOTA_POLL_MIN_MS = 60_000
const QUOTA_POLL_FIELD = volatileField(z.number()
  .default(QUOTA_POLL_DEFAULT_MS)
  .min(QUOTA_POLL_MIN_MS)
  .description('Sidebar quota card refresh interval in milliseconds (default 300000, minimum 60000)'))

export const Config: z<Config> = z.object({
  probeConsent: PROBE_CONSENT_FIELD,
  useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD,
  disabledModelsCN: DISABLED_MODELS_FIELD,
  disabledModelsAI: DISABLED_MODELS_FIELD,
  sidebarQuotaCN: QUOTA_TOGGLE_FIELD,
  sidebarQuotaAI: QUOTA_TOGGLE_FIELD,
  autoCheckInCN: AUTO_CHECK_IN_FIELD,
  autoCheckInAI: AUTO_CHECK_IN_FIELD,
  checkInMinuteCN: CHECK_IN_MINUTE_FIELD,
  checkInMinuteAI: CHECK_IN_MINUTE_FIELD,
  quotaPollMs: QUOTA_POLL_FIELD,
})

/**
 * The CN card's settings section: only the fields that card edits.
 *
 * A section is what makes its namespace "served", which is what the Plugins
 * tab dispatches a card by — so the schema and the card must stay split the
 * same way. `probeConsent` lives here because it predates the second variant;
 * it gates no current code path (only manual, per-click-confirmed probes run),
 * so it is left where existing users set it rather than moved and re-asked.
 */
const CN_SECTION: z<Config> = z.object({
  probeConsent: PROBE_CONSENT_FIELD,
  disabledModelsCN: DISABLED_MODELS_FIELD,
})

/** The international card's settings section and its context-window preference. */
const AI_SECTION: z<Config> = z.object({
  useMaximumContextWindow: MAXIMUM_CONTEXT_WINDOW_FIELD,
  disabledModelsAI: DISABLED_MODELS_FIELD,
})

/**
 * The shared quota card's section: both sidebar toggles and the poll interval.
 *
 * Only these fields — the card edits nothing else, and the Plugins tab pairs a
 * card with the section whose namespace it names, so a stray field here would
 * render as a control no other surface reads.
 */
const QUOTA_SECTION: z<Config> = z.object({
  sidebarQuotaCN: QUOTA_TOGGLE_FIELD,
  sidebarQuotaAI: QUOTA_TOGGLE_FIELD,
  autoCheckInCN: AUTO_CHECK_IN_FIELD,
  autoCheckInAI: AUTO_CHECK_IN_FIELD,
  checkInMinuteCN: CHECK_IN_MINUTE_FIELD,
  checkInMinuteAI: CHECK_IN_MINUTE_FIELD,
  quotaPollMs: QUOTA_POLL_FIELD,
})

export const CN_SECTION_KEYS = [
  'probeConsent',
  'disabledModelsCN',
] as const satisfies readonly (keyof Config)[]

export const AI_SECTION_KEYS = [
  'useMaximumContextWindow',
  'disabledModelsAI',
] as const satisfies readonly (keyof Config)[]

export const QUOTA_SECTION_KEYS = [
  'sidebarQuotaCN',
  'sidebarQuotaAI',
  'autoCheckInCN',
  'autoCheckInAI',
  'checkInMinuteCN',
  'checkInMinuteAI',
  'quotaPollMs',
] as const satisfies readonly (keyof Config)[]

/** Every declared configuration field, across all sections. */
const CONFIG_KEYS = [
  ...CN_SECTION_KEYS,
  ...AI_SECTION_KEYS,
  ...QUOTA_SECTION_KEYS,
] as const satisfies readonly (keyof Config)[]

/**
 * The schema defaults, READ off each field's own `meta.default`.
 *
 * Two ways this was got wrong before, both silent and both destructive: a
 * hand-written table drifted from the schema (so the schema's own defaults
 * were classified as real overrides and the legacy settings document could
 * never win), and `validate({})` was then tried instead — which on this
 * schemastery answers with hollow `{}` per field instead of applying the
 * defaults, which is worse than nothing because it looks like it worked.
 * Walking `Config.dict` for `meta.default` is the only honest source: it is
 * the value schemastery itself substituted during validation.
 */
const DEFAULT_FOR_FIELD: Partial<Record<keyof Config, unknown>> = (() => {
  const out: Partial<Record<keyof Config, unknown>> = {}
  try {
    for (const [key, field] of Object.entries(Config.dict ?? {})) {
      const fallback = (field as { meta?: { default?: unknown } } | undefined)?.meta?.default
      if (fallback !== undefined) (out as Record<string, unknown>)[key] = fallback
    }
  } catch {
    // An unreadable schema leaves the map partial: every field then reads as
    // "no default", which keeps the entry authoritative — the pre-migration
    // behaviour — rather than guessing.
  }
  if (Object.keys(out).length === 0) {
    // A schema that cannot be walked keeps the literal table below.
    return {
      probeConsent: false,
      useMaximumContextWindow: true,
      disabledModelsCN: [],
      disabledModelsAI: [],
      sidebarQuotaCN: false,
      sidebarQuotaAI: false,
      autoCheckInCN: false,
      autoCheckInAI: false,
      checkInMinuteCN: 600,
      checkInMinuteAI: 600,
      quotaPollMs: 300_000,
    }
  }
  return out
})()

/** Copy the declared fields off one section's source, skipping absent ones. */
function pickFields<K extends keyof Config>(
  source: () => Config,
  keys: readonly K[],
): Partial<Config> {
  const value = source()
  const out: Partial<Config> = {}
  for (const k of keys) {
    // Through `readField`: a section source is either the running Config
    // (volatile references on 0.1.7) or a Host scope's resolved section.
    const v = readField(value, k)
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** One variant's live runtime, assembled by {@link createVariantRuntime}. */
interface VariantRuntime {
  variant: WorkBuddyVariant
  store: WorkBuddyCredentialStore
  client: WorkBuddyUpstreamClient
  checkIn: (signal?: AbortSignal) => Promise<WorkBuddyCheckInResult>
  catalog: WorkBuddyCatalog
  probeStore: WorkBuddyProbeStore
  probeService: WorkBuddyProbeService
  /**
   * The last catalogs that loaded, keyed by account.
   *
   * Sits between the live fetch and the built-in roster in the degradation
   * order: a restart, or a fetch that fails while offline, serves what this
   * account was last actually shown instead of the one-off snapshot compiled
   * into the plugin.
   */
  savedCatalogs: WorkBuddyCatalogStore
  /** The static roster this variant falls back to. */
  fallback: readonly WorkBuddyModelInfo[]
  /**
   * Where the served models came from, in degradation order:
   * `live` (fetched now) → `saved` (this account's last successful fetch) →
   * `fallback` (the roster compiled into the plugin).
   */
  catalogSource: 'live' | 'saved' | 'fallback'
  /** When the served catalog was fetched, for `live` and `saved`. */
  catalogFetchedAtMs: number | undefined
  /** Why the last catalog attempt failed, when it did. */
  catalogError: string | undefined
  /** When the last catalog attempt started, for the retry backoff. */
  lastFetchAtMs: number
  /**
   * Bumped whenever this variant's catalog generation changes — an account
   * switch, a sign-out, or a new fetch superseding an older one. A request
   * carries the generation it started under and refuses to write back if the
   * generation has moved on, so a slow answer can never resurrect data the
   * plugin has since decided to drop (spec §5: late responses are discarded).
   */
  catalogGeneration: number
  /**
   * The in-flight catalog fetch, scoped to the identity and generation it began
   * under. A caller may only join the same scope; an account change cancels the
   * old request and immediately starts one for the newly adopted account.
   */
  inflightFetch: CatalogFetch | undefined
  /** Notify the model directory that this variant's answers changed. */
  invalidate: () => void
  /** Whether the provider registered successfully. */
  registered: boolean
}

/** One catalog request plus the identity state it is allowed to update. */
interface CatalogFetch {
  identity: string
  generation: number
  controller: AbortController
  promise: Promise<void>
}

/** Stable identity key used by credentials, probe records, and catalog entries. */
function credentialIdentity(credential: Pick<WorkBuddyCredential, 'uid' | 'enterpriseId'>): string {
  return `${credential.uid}:${credential.enterpriseId ?? ''}`
}

/** The settings namespace a variant's card and provider directory entry use. */
function settingsNamespaceFor(variant: WorkBuddyVariant): SettingsNamespace {
  return variant.id === CN_VARIANT.id ? WORKBUDDY_SETTINGS_NS : WORKBUDDY_AI_SETTINGS_NS
}

/**
 * The static catalog a variant serves before its first successful fetch.
 *
 * Each variant has its own roster: the two endpoints share several model ids
 * but not their billing, context windows, or reasoning sets, so one shared
 * fallback would misdescribe whichever variant it was not captured from.
 */
function fallbackFor(variant: WorkBuddyVariant): readonly WorkBuddyModelInfo[] {
  return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS : FALLBACK_WORKBUDDY_AI_MODELS
}

/** Build one variant's stores and probe state. */
function createVariantRuntime(
  config: Config,
  variant: WorkBuddyVariant,
  current: () => Config,
  identityOf: (variantId: string) => string | undefined,
): VariantRuntime {
  const client = new WorkBuddyUpstreamClient()
  const store = new WorkBuddyCredentialStore({
    variant,
    refresh: credential => client.refreshToken(credential),
  })
  const fallback = fallbackFor(variant)
  const catalog = new WorkBuddyCatalog(fallback)
  // The initial preferences come from the caller's LIVE configuration view
  // (`current()`), never the bare entry config: the plugin-owned settings file
  // is the live source, and reading the entry here made every restart forget
  // the disabled-model list — the entry is empty by then (its row was cleaned
  // up), so the catalog came back "all models enabled" and the picker offered
  // models the user had switched off.
  const initial = current()
  if (variant.id !== CN_VARIANT.id) {
    catalog.setUseMaximumContextWindow(initial.useMaximumContextWindow === true)
    const disabledAI = initial.disabledModelsAI
    if (disabledAI !== undefined) catalog.setDisabledModels(disabledAI)
  } else {
    const disabledCN = initial.disabledModelsCN
    if (disabledCN !== undefined) catalog.setDisabledModels(disabledCN)
  }
  // Start hidden: a variant must serve no models until an account has actually
  // been adopted, so a signed-out variant is empty rather than showing a roster
  // whose models could only fail. `adoptIdentity` is what reveals it, and it
  // treats "never seen, still signed out" as no change — which is only correct
  // if the pre-adoption state is already hidden.
  catalog.setVisible(false)
  const probeStore = new WorkBuddyProbeStore({
    pluginVersion: WORKBUDDY_CONNECT_VERSION,
    path: workbuddyProbePath(variant.probeFilename),
  })
  // One file per variant, for the same reason the probe records are split: the
  // two endpoints disagree about rates and windows for shared model ids, so a
  // saved CN roster must never be served as an international one.
  const savedCatalogs = new WorkBuddyCatalogStore(
    workbuddyCatalogPath(variant.catalogFilename),
  )
  const checkInService = new WorkBuddyCheckInService()
  const probeService = new WorkBuddyProbeService({
    store: probeStore,
    catalog,
    credentials: store,
    client,
    consent: () => readField(current(), 'probeConsent') === true,
    // Observations are per account: the service reads and writes its records
    // against this identity, so one account's detected levels never answer for
    // another's, and an in-flight sweep cannot store under a new account.
    account: () => identityOf(variant.id),
  })
  return {
    variant,
    store,
    client,
    checkIn: async (signal?: AbortSignal) => {
      const credential = await store.current()
      return checkInService.checkIn(variant.id, credential, signal)
    },
    catalog,
    probeStore,
    probeService,
    savedCatalogs,
    fallback,
    catalogSource: 'fallback',
    catalogFetchedAtMs: undefined,
    catalogError: undefined,
    lastFetchAtMs: 0,
    catalogGeneration: 0,
    inflightFetch: undefined,
    invalidate: () => {},
    registered: false,
  }
}

/** The catalog provenance the card displays. */
function catalogSection(runtime: VariantRuntime): WorkBuddyWebCatalog {
  const fetch = runtime.client.lastCatalog
  return {
    // The source is what the models on screen actually came from, so the card
    // can distinguish a fresh fetch from a saved one from the built-in roster —
    // "stale" and "offline" are different problems for the user.
    source: runtime.catalogSource,
    // The served catalog's own fetch time, which for a saved list is when it
    // was fetched, not when the process started.
    ...runtime.catalogFetchedAtMs === undefined ? {} : { fetchedAt: runtime.catalogFetchedAtMs },
    ...fetch?.appVersion === undefined ? {} : { appVersion: fetch.appVersion.version },
    ...runtime.catalogError === undefined ? {} : { error: runtime.catalogError },
  }
}

/**
 * Whether a model can be probed by hand: it reasons and the upstream declares
 * no effort set for it.
 *
 * Deliberately *not* filtered by whether a result already exists. Dropping a
 * model once it has been detected made the list shrink with use, so
 * re-detecting one model — after an upstream change, say — meant clearing every
 * other result first. The list stays stable and the card marks which entries
 * already have an answer.
 */
function isProbeCandidate(info: WorkBuddyModelInfo): boolean {
  if (info.reasoning?.supports !== true) return false
  return (info.reasoning.supportedEfforts?.length ?? 0) === 0
}

/** Compact probe state for one card: consent, candidates, observations. */
function probeSection(runtime: VariantRuntime, consent: boolean): WorkBuddyWebProbeSection {
  const models = runtime.catalog.current()
  // Read results through the *same* judgement the adapter uses, rather than
  // straight from the store. A raw record can be stale in ways the adapter
  // already discounts — its catalog row changed, it aged past the TTL, or the
  // upstream has since declared an effort set (which always wins) — and showing
  // one would have the card promise levels the model picker does not offer. A
  // model the upstream dropped leaves the catalog entirely, so it drops out
  // here too.
  const results = models.flatMap(info => {
    const record = runtime.probeService.recordFor(info.id)
    if (record === undefined) return []
    return [{
      id: info.id,
      name: info.name,
      validation: record.validation,
      efforts: record.efforts,
      probedAt: record.probedAtMs,
    }]
  })
  return {
    consent,
    running: runtime.probeService.isRunning(),
    candidates: models.filter(isProbeCandidate).map(info => info.id),
    // Newest first: a detection the user just ran belongs at the top, not
    // appended below every earlier one.
    results: newestFirst(results),
  }
}

/**
 * Start one variant: its loopback endpoint, provider registration, and
 * configuration-card wiring.
 *
 * Registration waits for the shim to hold a port, because the provider's
 * models read the shim origin at construction time. A failure here is
 * contained to this variant: the caller logs it and the other keeps working.
 *
 * @returns whether the provider registered.
 */
async function startVariant(ctx: Context, runtime: VariantRuntime, seedCatalog: () => Promise<void>): Promise<boolean> {
  const { variant, store, client, catalog, probeService } = runtime
  const shim = createWorkBuddyShim({ store, client, catalog, logger: ctx.logger })
  try {
    await shim.ready
  } catch (error: unknown) {
    ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} loopback endpoint failed to start`, error)
    return false
  }

  let invalidate: (() => void) | undefined
  try {
    // Constructed only once the listener holds a port: the provider's models
    // read the shim origin at construction time.
    const workbuddy = createWorkBuddyAdapter({
      providerId: variant.id,
      displayName: variant.displayName,
      shim,
      store,
      catalog,
      resolveAttachments: () => ctx.get('attachments'),
      observe: modelId => probeService.recordFor(modelId),
    })
    invalidate = workbuddy.invalidate
    runtime.invalidate = () => {
      workbuddy.invalidate()
      ctx.emit('llm/adapters-updated')
    }

    let releaseAdapter: (() => void) | undefined
    let releaseDirectory: (() => void) | undefined
    try {
      releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter)
      // The settings namespace the Models page resolves this directory row
      // against differs by host line, and the difference is not cosmetic:
      //
      //  - 0.1.7 serves one settings form per profile ENTRY, keyed by
      //    `entry.options.id` (dsh-settings `describe()`), so the row must name
      //    that id — naming a 0.1.5 namespace (`workbuddy` / `workbuddy-ai`)
      //    makes the page resolve a name the Host never served, and the row
      //    renders with no configuration at all.
      //  - 0.1.5 serves the namespaces this plugin installs, which is what
      //    `settingsNamespaceFor` returns.
      //
      // `configEditor` exists only on 0.1.7, which is the same probe the write
      // path and the migration use.
      const host017 = ((): boolean => {
        try {
          const probe = ctx as unknown as { get?: (name: string) => unknown }
          return probe.get?.('configEditor') !== undefined
        } catch {
          return false
        }
      })()
      const entryId = (ctx as unknown as { fiber?: { entry?: { options?: { id?: string } } } }).fiber?.entry?.options?.id
      const settingsNs = host017 && entryId !== undefined ? (entryId as SettingsNamespace) : settingsNamespaceFor(variant)
      releaseDirectory = ctx.llm.registerConfigurableProviders([{
        provider: variant.id,
        displayName: variant.displayName,
        // Each variant's directory entry joins its own settings form; the
        // Models settings page resolves `settingsNs` against the served forms,
        // so the name must be the one THIS host serves (see above).
        settingsNs,
        settingsPath: [],
        declared: false,
      }])
    } finally {
      if (releaseAdapter === undefined || releaseDirectory === undefined) {
        // Registration threw; release whichever half landed.
        releaseAdapter?.()
        releaseDirectory?.()
      }
    }
    try {
      ctx.effect(() => () => {
        releaseAdapter?.()
        releaseDirectory?.()
        void shim.close()
      })
    } catch {
      // The plugin was disposed during registration; release immediately — the
      // plugin-level disposer already closed every shim.
      releaseAdapter?.()
      releaseDirectory?.()
      void shim.close()
    }
    runtime.registered = true
    // Seed the catalog BEFORE returning, not in the later sweep: a 0.1.7
    // settings write hot-reloads this fiber, and the card's post-write refresh
    // must not land in the window where the fresh runtime's catalog is still
    // hidden ("暂无可配置的模型" until the user presses refresh).
    void (async () => {
      try { await seedCatalog() } catch { /* contained: the sweep still seeds */ }
    })()
    return true
  } catch (error: unknown) {
    ctx.logger.error(`dsh-workbuddy-connect: ${variant.displayName} provider registration failed`, error)
    void shim.close()
    return false
  }
}

/**
 * Start both variants: their loopback endpoints, the `workbuddy` and
 * `workbuddy-ai` providers, their configuration cards, and their
 * credential-driven catalog lifecycles.
 *
 * Each variant registers unconditionally; what varies is whether its catalog is
 * *visible*. An empty catalog is how DSH hides a model group (the host filters
 * out groups with no models), which keeps a sign-in that happens after startup
 * working without re-registering the provider.
 */
/**
 * State that MUST survive a fiber reload, module-level on purpose.
 *
 * DSH 0.1.7's configuration write (`configEditor.edit`) reconciles the profile
 * tree, which hot-reloads the entry's fiber — `apply()` runs again with a fresh
 * closure. Anything re-minted per apply is invalidated by every settings write:
 * the browser cards hold the keys the status document handed them, so a
 * per-apply key turns each write into a wave of 403s ("刷新失败"), and a
 * per-apply identity map makes the sweep re-fetch the catalog from upstream on
 * every write. Both are per-PROCESS secrets and caches, so they live here once.
 */

/** The in-process control keys, minted once per process. */
let processKeys: { probe: string; login: string } | undefined
function controlKeys(): { probe: string; login: string } {
  processKeys ??= { probe: createProbeKey(), login: createLoginKey() }
  return processKeys
}

/** The account identity each variant last published a catalog for, across reloads. */
const lastIdentities = new Map<string, string>()

/** The loopback guard the probe and status routes use, restated for settings. */
function trustedSettingsRequest(req: { method?: string | undefined; headers: Record<string, string | string[] | undefined> }): boolean {
  const host = req.headers.host ?? ''
  const origin = req.headers.origin
  if (!/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(String(host))) return false
  return origin === undefined || /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(String(origin))
}

/** JSON response helper for the settings face. */
function jsonFace(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

/** Read the request body, or undefined when absent or oversized. */
function readFaceBody(req: { on: (event: string, handler: (chunk?: unknown) => void) => void }): Promise<string | undefined> {
  return new Promise(resolve => {
    let body = ''
    req.on('data', (chunk: unknown) => {
      body += String(chunk)
      if (body.length > 1e6) { resolve(undefined) }
    })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(undefined))
  })
}

/** Schema-level validation of one settings patch; the reason, or undefined. */
function validateSettingsPatch(patch: Record<string, unknown>): string | undefined {
  for (const [field, value] of Object.entries(patch)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(field)) return `unknown field ${field}`
    if (value === null) continue
    switch (field) {
      case 'probeConsent':
      case 'useMaximumContextWindow':
      case 'sidebarQuotaCN':
      case 'sidebarQuotaAI':
      case 'autoCheckInCN':
      case 'autoCheckInAI':
        if (typeof value !== 'boolean') return `${field} must be a boolean`
        break
      case 'disabledModelsCN':
      case 'disabledModelsAI':
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return `${field} must be an array of strings`
        break
      case 'checkInMinuteCN':
      case 'checkInMinuteAI':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) return `${field} must be an integer minute 0..1439`
        break
      case 'quotaPollMs':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 60_000) return `${field} must be an integer of at least 60000 ms`
        break
    }
  }
  return undefined
}

/** One settings-face write: type-checked, then persisted and applied. */
interface SettingsFaceTarget {
  store: SettingsStore
  current: () => Config
  apply: (next: Config) => void
  rearm: () => void
}

/**
 * Register the settings face (GET/POST) the browser cards read and write
 * through, answering the whole entry configuration as three layers.
 *
 * `value` carries every declared field, so the quota card sees the same merged
 * view the host itself reads; `user` is the settings file exactly as stored
 * (presence marks an override). A POST validates the fields it may touch,
 * writes the file, applies the new view in memory, and re-arms the check-in
 * scheduler (the section `onChange` behaviour this plugin used to rely on).
 */
function registerSettingsFace(ctx: Context, deps: SettingsFaceTarget): void {
  const { store, current, apply, rearm } = deps
  const key = createProbeKey()
  /** The document both routes answer with. */
  const view = () => {
    const merged = current()
    const value: Record<string, unknown> = {}
    const baseOut: Record<string, unknown> = {}
    for (const field of CONFIG_KEYS) {
      if (merged[field] !== undefined) value[field] = merged[field]
      baseOut[field] = DEFAULT_FOR_FIELD[field]
    }
    return { key, value, base: baseOut, user: store.values() }
  }
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: WORKBUDDY_SETTINGS_FACE_PATH,
      handler: async (req, res) => {
        if (!trustedSettingsRequest(req)) { jsonFace(res, 403, { error: 'request-not-trusted' }); return }
        if (req.method === 'GET') { jsonFace(res, 200, view()); return }
        if (req.method !== 'POST') { jsonFace(res, 405, { error: 'method not allowed' }); return }
        if (req.headers['x-workbuddy-settings-key'] !== key) { jsonFace(res, 403, { error: 'invalid-key' }); return }
        const body = await readFaceBody(req)
        if (body === undefined) { jsonFace(res, 413, { error: 'body too large' }); return }
        let patch: unknown
        try { patch = JSON.parse(body || '{}') } catch { jsonFace(res, 400, { error: 'invalid json' }); return }
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          jsonFace(res, 400, { error: 'invalid patch' }); return
        }
        const invalid = validateSettingsPatch(patch as Record<string, unknown>)
        if (invalid !== undefined) { jsonFace(res, 400, { error: invalid }); return }
        // A card write: the file holds live user edits from here on (see the
        // seed rule on `apply`), so a stale profile row can never regress it.
        store.patch(patch as Record<string, unknown>, true)
        apply(current())
        rearm()
        jsonFace(res, 200, view())
      },
    })
    return () => { dispose() }
  }, 'dsh-workbuddy-connect: settings face')
}

/**
 * Delete this plugin's own fields from the profile entry config, leaving every
 * other key of the row untouched.
 *
 * One-time, right after the settings file has been seeded: the entry returns to
 * its shipped state, so no second source of truth remains. The write rides
 * `configEditor` — the profile-patch editor — probed on the plugin context
 * first and on the settings service's owner context second, because that is
 * where the host root mounts it.
 *
 * @param ctx - plugin context.
 * @param ownKeys - this plugin's declared config fields.
 */
async function cleanupEntryConfig(ctx: Context, ownKeys: readonly string[]): Promise<void> {
  // RETRIES, deliberately: `configEditor.edit` writes under the profile's
  // package.json lock, and every plugin migrating on the same boot contends for
  // that ONE lock — four sibling plugins seeding at once measured exactly one
  // winner and three "timed out waiting for the writer lock" failures. The
  // write is idempotent, so backing off (with jitter) makes the rest land.
  const attempts = 10
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 2_000 + Math.random() * 1_000))
      const probe = ctx as unknown as {
        get?: (name: string) => unknown
        fiber?: { entry?: unknown }
      }
      // configEditor 双路探测：本 ctx 直取（官方写法），失败再从 settings
      // 服务的 ownerContext（宿主根 ctx，configEditor 挂在那里）取。
      const own: unknown = typeof probe.get === 'function'
        ? (() => { try { return probe.get.call(ctx, 'configEditor') as unknown } catch { return undefined } })()
        : undefined
      const editor = (own ?? await new Promise<unknown>(resolve => {
        ctx.inject(['settings'], settingsCtx => {
          // `ownerContext` is private on the 0.1.7 SettingsForms class, so it
          // reaches this probe through the double cast rather than the typed
          // face — the shape the host's own root context mounts it as.
          const owner = (settingsCtx.settings as unknown as { ownerContext?: { get?: (name: string) => unknown } } | undefined)?.ownerContext
          const viaOwner = typeof owner?.get === 'function'
            ? (() => { try { return owner.get.call(owner, 'configEditor') as unknown } catch { return undefined } })()
            : undefined
          resolve(viaOwner)
        })
      })) as { edit(entry: unknown, change: (raw: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void> } | undefined
      const entry = probe.fiber?.entry
      if (editor !== undefined && entry !== undefined) {
        // INHERITED 为基底 + 行内外来键：平台的组合校验
        // （isDeepStrictEqual(next, inherited)）因此恒真，编辑器得以整块删除
        // 用户层——手写空对象会在 bundle 层仍带 config 时校验失败。
        // 其他插件/用户在该行上的键原样保留。
        await editor.edit(entry, (raw, inherited) => {
          const next: Record<string, unknown> = { ...(inherited ?? {}) }
          for (const [key, value] of Object.entries(raw ?? {})) {
            if ((ownKeys as readonly string[]).includes(key)) continue
            if (!Object.hasOwn(next, key)) next[key] = value
          }
          return next
        })
        return
      }
      // No editor and no entry: nothing this plugin can address, so the row
      // keeps its values and the seed rule simply never re-seeds them.
      return
    } catch (error: unknown) {
      if (attempt === attempts - 1) {
        ctx.logger?.warn?.('dsh-workbuddy-connect: entry config cleanup failed', error)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1) + Math.random() * 500))
    }
  }
}

/**
 * Start both variants: their loopback endpoints, the `workbuddy` and
 * `workbuddy-ai` providers, their configuration cards, and their
 * credential-driven catalog lifecycles.
 *
 * Each variant registers unconditionally; what varies is whether its catalog is
 * *visible*. An empty catalog is how DSH hides a model group (the host filters
 * out groups with no models), which keeps a sign-in that happens after startup
 * working without re-registering the provider.
 */
export function apply(ctx: Context, config: Config): void {
  // 插件自有配置：唯一事实源（见 settings-store.ts）。
  //
  // Live configuration source: the composition entry (the profile row, read
  // through the volatile indirection — on 0.1.7 every projected field is a
  // reference object whose value comes from `.get()`) with the plugin-owned
  // settings file layered on top.
  //
  // The entry stays as the fallback layer so a hand-edited profile row still
  // seeds a fresh install; the file is where every write lands.
  const store = new SettingsStore()
  let current = (): Config => withOwnValues(config)

  /**
   * Overlay the plugin-owned settings file on the entry's config view.
   *
   * `readField` unwraps the volatile references 0.1.7 hands out, so this
   * answers plain values on both host lines.
   */
  const withOwnValues = (base: Config): Config => {
    const out = { ...base } as Record<string, unknown>
    for (const key of CONFIG_KEYS) {
      const value = readField(base, key)
      if (value !== undefined) out[key] = value
    }
    for (const [key, value] of Object.entries(store.values())) {
      if (key.startsWith('__')) continue
      out[key] = value
    }
    return out as Config
  }

  /**
   * One-time migration: per field — the file never held it → take the entry;
   * the card HAS written this file → keep the file; the entry carries a
   * NON-DEFAULT value → take the entry; the entry only carries the schema
   * default → keep the file.
   *
   * That last clause is load-bearing: a bundle layer's insert config does NOT
   * reach the composition (verified with `dsh --dump-config`), so once the
   * one-time cleanup has emptied the entry row the entry answers pure defaults —
   * treating those as authoritative would erase the user's values on the next
   * boot. Re-checked on every apply, which is also what closes the volatile
   * commit timing window.
   *
   * When the entry is authoritative, its own fields are then deleted from the
   * profile row, so no second source of truth remains.
   */
  const migrateOwnSettings = (): void => {
    const seeded: Record<string, unknown> = {}
    for (const key of CONFIG_KEYS) {
      const entryValue = readField(config, key)
      const holds = Object.hasOwn(store.user, key)
      if (!holds) {
        // First seed — the first NON-DEFAULT candidate, and only then an
        // explicit default so the stored layer stays complete. A schema
        // default (an empty array, `true` for a toggle that defaults on) is
        // NOT a value to seed on.
        if (entryValue !== undefined && JSON.stringify(entryValue) !== JSON.stringify(DEFAULT_FOR_FIELD[key])) seeded[key] = entryValue
        else if (entryValue !== undefined) seeded[key] = entryValue
        continue
      }
      if (store.edited) continue
      if (entryValue !== undefined && JSON.stringify(entryValue) !== JSON.stringify(DEFAULT_FOR_FIELD[key])) {
        seeded[key] = entryValue
      }
    }
    if (Object.keys(seeded).length === 0) return
    store.patch(seeded)
    void cleanupEntryConfig(ctx, CONFIG_KEYS)
  }
  migrateOwnSettings()

  // A volatile-only configuration change — every field of this Config is
  // `.volatile()` — commits through the loader's volatile fast path: the
  // references are updated IN PLACE and `apply()` is NOT run again. Seeding
  // only inside `apply` would never observe values arriving that way. This
  // event fires on exactly that commit (the same mechanism the built-in
  // `dsh-llm-pi-ai` uses), so the seed rule re-evaluates. The event is a
  // Host-internal channel the typings do not declare, so it reaches `on`
  // through the string-keyed escape hatch rather than the typed event map.
  const eventSink = ctx as unknown as { on: (event: string, listener: () => void) => void }
  eventSink.on('loader/volatile-update', () => { migrateOwnSettings() })

  /** Timers and in-flight work belonging to this plugin instance. */
  let stopped = false
  const timers: NodeJS.Timeout[] = []

  const runtimes = WORKBUDDY_VARIANTS.map(variant => createVariantRuntime(
    config,
    variant,
    () => current(),
    id => lastIdentities.get(id),
  ))

  const checkInStore = new JsonFileCheckInStore()
  const checkInScheduler = new CheckInScheduler({
    targets: runtimes.map(runtime => ({
      variantId: runtime.variant.id,
      checkIn: (signal?: AbortSignal) => runtime.checkIn(signal),
      minuteOfDay: () => {
        const cfg = current()
        const stored = readField(
          cfg,
          runtime.variant.id === CN_VARIANT.id ? 'checkInMinuteCN' : 'checkInMinuteAI',
        )
        return normalizeCheckInMinute(stored ?? DEFAULT_CHECK_IN_MINUTE)
      },
      onClaimed: () => {
        const cred = runtime.store.status()
        void cred.then(status => {
          if (status.state === 'signed-in') {
            void runtime.store.current().then(c => {
              if (c) void runtime.client.fetchCredits(c).catch(() => undefined)
            })
          }
        })
      },
    })),
    isEnabled: variantId => {
      const cfg = current()
      if (variantId === CN_VARIANT.id) return readField(cfg, 'autoCheckInCN') === true
      return readField(cfg, 'autoCheckInAI') === true
    },
    store: checkInStore,
  })
  checkInScheduler.start()

  let startupCatchUpDone = false
  const runStartupCatchUpOnce = (): void => {
    if (startupCatchUpDone) return
    startupCatchUpDone = true
    checkInScheduler.catchUp()
  }

  // Same-origin routes backing each Plugin-configuration card; the webServer
  // service is optional (a headless profile serves no browser).
  // Keys are per-process (see {@link controlKeys}): a 0.1.7 settings write
  // reloads this fiber, and per-apply keys would invalidate every card's key.
  const { probe: probeKey, login: loginKey } = controlKeys()
  /** The device-authorization client; one instance serves both realms. */
  const loginClient = new WorkBuddyLoginClient()
  /**
   * The one in-flight sign-in attempt per variant, keyed by provider id.
   *
   * One per variant because a second attempt for the same realm would issue a
   * second state and leave the first polling forever; a user who wants to
   * restart signs out or reloads, which discards this.
   */
  const loginAttempts = new Map<string, WorkBuddyLoginAttempt>()
  let setMaximumContextWindow: ((enabled: boolean) => Promise<{ state: string; reason?: string }>) | undefined
  let setDisabledModelsForVariant: ((variantId: string, disabled: readonly string[]) => Promise<{ state: string; reason?: string }>) | undefined
  /**
   * Point a variant at an account identity, invalidating whatever the previous
   * one left behind.
   *
   * One helper for all four transitions (sweep sign-in, sweep sign-out, manual
   * refresh, manual refresh sign-out) because each of them used to do its own
   * partial version, and the manual path forgot pieces the sweep did. Every
   * transition bumps {@link VariantRuntime.catalogGeneration}, which is what
   * makes an in-flight request from before the change refuse to write back.
   *
   * Probe observations are dropped whenever the account actually changes —
   * including sign-out, and including the "signed out, then in as someone else"
   * sequence that used to look like a first sighting and let the new account
   * inherit the old one's detected levels. They are deliberately NOT cleared on
   * a first sign-in: no previous account's data could leak there, and clearing
   * would delete records this very account owns (written before a restart, or
   * seeded while all of this is running).
   *
   * @param identity - the account now in effect, or `undefined` when signed out.
   */
  const adoptIdentity = (runtime: VariantRuntime, identity: string | undefined): void => {
    const id = runtime.variant.id
    const known = lastIdentities.get(id)
    // "Same identity" may only short-circuit when THIS runtime has already
    // adopted: a fresh catalog starts hidden (`createVariantRuntime` sets
    // `visible=false`), and DSH 0.1.7's configuration write hot-reloads the
    // fiber, so every settings write produces exactly such a fresh runtime.
    // Short-circuiting on identity alone there skips the seeding AND the
    // `setVisible(true)`, the provider registers with zero models, and the
    // card's model list and context-window section go empty — and stay empty,
    // because `all()` answers nothing while hidden even after a later fetch
    // succeeds, and the refresh button routes through this same function.
    if (known === identity && runtime.catalog.isVisible()) return
    const hadCredential = known !== undefined
    if (identity === undefined) lastIdentities.delete(id)
    else lastIdentities.set(id, identity)
    // Any change of identity invalidates in-flight work and recorded answers.
    runtime.catalogGeneration += 1
    runtime.inflightFetch?.controller.abort()
    runtime.inflightFetch = undefined
    if (hadCredential && known !== identity) {
      // Drop the PREVIOUS account's observations, never the whole file: the
      // account taking over keeps its own records — written before a restart,
      // or seeded while all of this is running. Signing out keeps nothing, so
      // the departing account's records go with it.
      if (identity === undefined) runtime.probeStore.clear()
      else runtime.probeStore.clearOthers(identity)
      runtime.invalidate()
    }
    if (identity === undefined) {
      // Signed out: hide the group, and drop the models so they are not left
      // registered-but-invisible if visibility ever flips back. The signed-out
      // account's saved catalog is forgotten as well — it is that account's
      // data, and it is keyed by identity so nothing else can serve it, but
      // keeping it would only be useful if that same account returned, and the
      // file is not a place to accumulate departed accounts' catalogs.
      if (known !== undefined) runtime.savedCatalogs.delete(known)
      runtime.catalog.set(runtime.fallback)
      runtime.catalogSource = 'fallback'
      runtime.catalogFetchedAtMs = undefined
      runtime.catalogError = undefined
      if (runtime.catalog.setVisible(false)) runtime.invalidate()
      return
    }
    // Serve this account's best-known catalog until a fetch lands. The saved
    // catalog is preferred over the built-in roster: the roster is a snapshot
    // taken once, while the saved one is what this account (from this source)
    // was actually served. This covers both a switch and a restart — on a
    // restart `hadCredential` is false, and the saved catalog is exactly what
    // stops the group from falling back to the compiled-in list.
    const saved = runtime.savedCatalogs.get(identity)
    if (saved !== undefined) {
      runtime.catalog.set([...saved.models])
      runtime.catalogSource = 'saved'
      runtime.catalogFetchedAtMs = saved.fetchedAtMs
    } else {
      runtime.catalog.set(runtime.fallback)
      runtime.catalogSource = 'fallback'
      runtime.catalogFetchedAtMs = undefined
    }
    runtime.catalogError = undefined
    runtime.catalog.setVisible(true)
    runtime.invalidate()
  }

  ctx.inject(['webServer'], webCtx => {
    for (const runtime of runtimes) {
      registerWorkBuddyStatusRoute(webCtx, {
        path: runtime.variant.statusPath,
        store: runtime.store,
        client: runtime.client,
        models: () => runtime.catalog.all(),
        catalog: () => catalogSection(runtime),
        probe: () => probeSection(runtime, readField(current(), 'probeConsent') === true),
        probeKey,
        loginKey,
        ...runtime.variant.id === CN_VARIANT.id ? {} : { useMaximumContextWindow: () => readField(current(), 'useMaximumContextWindow') === true },
        disabledModels: () => runtime.catalog.disabledModels(),
        checkIn: () => {
          const record = checkInStore.read(runtime.variant.id)
          if (record === undefined) return undefined
          const nextRunAt = checkInScheduler.nextRunAt(runtime.variant.id)
          return {
            ...record,
            ...nextRunAt === undefined ? {} : { nextRunAt },
          }
        },
      })
      registerWorkBuddyLoginRoute(webCtx, {
        path: runtime.variant.loginPath,
        begin: async () => {
          // Replace rather than join an existing attempt: a user who pressed
          // sign-in again wants a fresh URL, and the previous state is already
          // unreachable from the card.
          const previous = loginAttempts.get(runtime.variant.id)
          if (previous !== undefined) loginClient.forget(previous.state)
          const attempt = await loginClient.begin(runtime.variant.region)
          loginAttempts.set(runtime.variant.id, attempt)
          return { state: attempt.state, url: attempt.authUrl }
        },
        poll: async state => {
          const attempt = loginAttempts.get(runtime.variant.id)
          if (attempt === undefined || attempt.state !== state) {
            return { status: 'failed', message: 'this sign-in attempt is no longer active; start again' }
          }
          const outcome = await loginClient.poll(attempt)
          if (outcome.status === 'pending') return { status: 'pending', state }
          loginClient.forget(state)
          loginAttempts.delete(runtime.variant.id)
          const region = resolveLoginRegion(runtime.variant.region, outcome.tokens.domain)
          const credential: WorkBuddyCredential = {
            accessToken: outcome.tokens.accessToken,
            refreshToken: outcome.tokens.refreshToken,
            // A zero `expiresIn` leaves the credential with no usable expiry,
            // which the store treats as "refresh now" — the honest reading of an
            // upstream that declined to say when the token dies.
            expiresAtMs: outcome.tokens.expiresInSec > 0 ? Date.now() + outcome.tokens.expiresInSec * 1000 : 0,
            domain: outcome.tokens.domain,
            uid: outcome.account.uid,
            ...outcome.account.enterpriseId === undefined ? {} : { enterpriseId: outcome.account.enterpriseId },
            ...outcome.account.nickname === undefined ? {} : { nickname: outcome.account.nickname },
            source: WORKBUDDY_CREDENTIAL_SOURCE,
          }
          // The realm the credential actually belongs to decides which store may
          // hold it: a login against the international realm that answered with a
          // CN domain would otherwise be written where it can never be used.
          if (region !== runtime.variant.region) {
            return {
              status: 'failed',
              message: `this sign-in returned a ${region === 'cn' ? 'WorkBuddy (CN)' : 'WorkBuddy AI'} account,`
                + ` which belongs to the other provider; sign in from that one's card instead`,
            }
          }
          try {
            await runtime.store.save(credential)
          } catch (error: unknown) {
            return { status: 'failed', message: error instanceof Error ? error.message.slice(0, 300) : String(error) }
          }
          // A sign-in is the one transition the sweep would otherwise only notice
          // on its next tick; adopt it here so the model group appears at once.
          const identity = credentialIdentity(credential)
          adoptIdentity(runtime, identity)
          void fetchCatalog(runtime, identity)
          return {
            status: 'complete',
            ...outcome.account.nickname === undefined ? {} : { nickname: outcome.account.nickname },
          }
        },
        logout: async () => {
          const attempt = loginAttempts.get(runtime.variant.id)
          if (attempt !== undefined) loginClient.forget(attempt.state)
          loginAttempts.delete(runtime.variant.id)
          await runtime.store.logout()
          adoptIdentity(runtime, undefined)
        },
        importDocument: async document => {
          // The store validates the realm before writing, so a CN document
          // offered to the international card is refused with a message naming
          // the product it belongs to.
          const credential = await runtime.store.importDocument(document)
          // Publishing the account is the same transition a completed sign-in
          // performs, so the model group appears without waiting for the sweep.
          const identity = credentialIdentity(credential)
          adoptIdentity(runtime, identity)
          void fetchCatalog(runtime, identity)
          return {
            ...credential.uid === '' ? {} : { uid: credential.uid },
            ...credential.nickname === undefined ? {} : { nickname: credential.nickname },
          }
        },
      }, loginKey)
      registerWorkBuddyProbeRoute(webCtx, {
        path: runtime.variant.probePath,
        probe: async modelId => {
          // The authenticated manual endpoint is called only after per-model confirmation.
          const result = await runtime.probeService.probe(modelId, true)
          if (result.state === 'ok') runtime.invalidate()
          return result
        },
        clear: () => { runtime.probeStore.clear(); runtime.invalidate() },
        refresh: async () => {
          if (stopped) return { state: 'failed', reason: 'plugin is stopping' }
          // Re-read the credential first: the user pressed this because the list
          // looks wrong, and a sign-in that happened since the last sweep is the
          // common cause. Re-registering is unnecessary — visibility is what
          // changes, and the sweep owns that.
          let credential
          try {
            credential = await runtime.store.current()
          } catch (error: unknown) {
            // A refused credential (wrong region, unreadable file) is a report,
            // not a crash out of the route.
            return {
              state: 'failed',
              reason: error instanceof Error ? error.message.slice(0, 300) : String(error),
            }
          }
          if (credential === undefined) {
            adoptIdentity(runtime, undefined)
            return { state: 'signed-out' }
          }
          const identity = credentialIdentity(credential)
          // Same transition the sweep performs: a switch reached through the
          // manual path must drop the previous account's data *now*, not when
          // the fetch lands, or a failed fetch leaves those models pickable.
          adoptIdentity(runtime, identity)
          await fetchCatalog(runtime, identity)
          return runtime.catalogError === undefined
            ? { state: 'refreshed', reason: `${runtime.catalog.current().length} models` }
            : { state: 'failed', reason: runtime.catalogError }
        },
        clearCheckInLogs: () => {
          checkInStore.clearLogs(runtime.variant.id)
        },
        checkIn: async () => {
          const result = await runtime.checkIn()
          if (result.status !== 'error') {
            checkInStore.write(runtime.variant.id, {
              lastDate: result.date,
              lastAt: result.timestamp,
              status: result.status,
              ...result.amount === undefined ? {} : { amount: result.amount },
              ...result.message === undefined ? {} : { message: result.message },
            })
            if (result.status === 'claimed') {
              const cred = await runtime.store.current()
              if (cred) void runtime.client.fetchCredits(cred).catch(() => undefined)
            }
          }
          return {
            state: result.status,
            ...result.amount === undefined ? {} : { amount: result.amount },
            ...result.message === undefined ? {} : { reason: result.message },
          }
        },
        setDisabledModels: async disabled => {
          if (setDisabledModelsForVariant === undefined) return { state: 'failed', reason: 'settings are unavailable' }
          return setDisabledModelsForVariant(runtime.variant.id, disabled)
        },
        ...runtime.variant.id === CN_VARIANT.id ? {} : {
          setMaximumContextWindow: async enabled => {
            if (setMaximumContextWindow === undefined) return { state: 'failed', reason: 'settings are unavailable' }
            return setMaximumContextWindow(enabled)
          },
        },
      }, probeKey)
    }

    // The settings face the browser cards read and write through. It answers
    // the whole entry's configuration as three layers (value = effective,
    // base = schema defaults, user = the settings file), which is exactly the
    // shape the 0.1.7 configForm used to mirror — the client-side cards keep
    // their staged-edit form untouched.
    registerSettingsFace(webCtx, {
      store, current,
      apply: applyCatalogSettings,
      rearm: () => { checkInScheduler.rearm(); runStartupCatchUpOnce() },
    })
  })


  // 插件的配置写入口只有一个：插件自有文件（见 settings-store.ts）。
  //
  // 曾经这里按宿主形态分岔——0.1.5 用 `installSection` + `settings.update`
  // （watch 回调原地生效、毫秒级），0.1.7 用 `configEditor.edit`（每次写入都
  // reconcile 整棵 loader 树 + fiber 热重载，约 1~1.5 秒，并刷新所有客户端
  // 镜像）。现在两侧都不再向宿主编程配置：写落自有 JSON 文件，随后原地
  // apply（catalog 偏好、签到定时器重排、invalidate）。
  //
  // `configure({auto:false})` 保留：它只关掉宿主为这个 entry 自动生成的表单页
  // （本插件自带卡片），与持久化通路无关。
  /** Apply catalog preferences from a configuration view, in memory. */
  const applyCatalogSettings = (next: Config): void => {
    const aiRuntime = runtimes.find(candidate => candidate.variant.id !== CN_VARIANT.id)
    if (aiRuntime?.catalog.setUseMaximumContextWindow(next.useMaximumContextWindow === true)) aiRuntime.invalidate()
    for (const runtime of runtimes) {
      const disabled = runtime.variant.id === CN_VARIANT.id
        ? (next.disabledModelsCN ?? [])
        : (next.disabledModelsAI ?? [])
      if (runtime.catalog.setDisabledModels(disabled)) {
        runtime.invalidate()
      }
    }
  }

  ctx.inject(['settings'], settingsCtx => {
    const settings = settingsCtx.settings as unknown as {
      configure?: (presentation: { auto?: boolean }, owner?: unknown) => unknown
    }
    if (typeof settings.configure === 'function') {
      try {
        settingsCtx.effect((): (() => void) => {
          const dispose = settings.configure!({ auto: false }, ctx.fiber)
          return typeof dispose === 'function' ? (dispose as () => void) : () => {}
        })
      } catch (error: unknown) {
        console.error('[dsh-workbuddy-connect] settings.configure failed (own settings file still serves):', error)
      }
    }

    /**
     * The setters, one implementation: write the plugin-owned settings file,
     * then apply the new view in memory. No profile-patch write means no tree
     * reconcile, no fiber reload, and no client-mirror storm per toggle.
     */
    const write = (patch: Record<string, unknown>): void => {
      // A card-originated write (every caller here is a user action on the
      // settings card), so the file becomes authoritative from this point on.
      store.patch(patch, true)
      applyCatalogSettings(current())
      checkInScheduler.rearm()
      runStartupCatchUpOnce()
    }
    setMaximumContextWindow = async enabled => {
      write({ useMaximumContextWindow: enabled })
      return { state: 'updated' }
    }
    setDisabledModelsForVariant = async (variantId, disabled) => {
      const key = variantId === CN_VARIANT.id ? 'disabledModelsCN' : 'disabledModelsAI'
      write({ [key]: [...disabled] })
      return { state: 'updated' }
    }
  })

  ctx.effect(() => () => {
    stopped = true
    checkInScheduler.dispose()
    for (const timer of timers) clearInterval(timer)
    timers.length = 0
    void clearHostHeartbeat()
  })

  /**
   * Fetch one variant's catalog for the current credential.
   *
   * Shared by the credential sweep and the card's manual refresh, and written
   * so that concurrent callers cost one request and cannot interleave badly:
   *
   * - **One request at a time.** A second caller joins the in-flight fetch
   *   instead of starting its own (spec §5: one catalog request per variant at
   *   a time).
   * - **Generation-checked write-back.** The request records the generation it
   *   started under and writes nothing if the generation moved on — which is
   *   what a slow answer from a superseded account must not do. Checking only
   *   the *identity* was not enough: two refreshes for the same account can
   *   still finish out of order, and the older one would win.
   * - **`resolve()`, not `current()`.** Only `resolve()` performs the locked,
   *   single-flight token renewal. Reading `current()` meant an expired token
   *   made every catalog request fail until something else happened to refresh
   *   it, leaving the group on the fallback roster.
   */
  const fetchCatalog = async (runtime: VariantRuntime, identity: string): Promise<void> => {
    const inflight = runtime.inflightFetch
    const generation = runtime.catalogGeneration
    if (inflight !== undefined && inflight.identity === identity && inflight.generation === generation) {
      return inflight.promise
    }
    // A caller should normally reach this only after `adoptIdentity()` has
    // already cancelled a previous generation. Keep this guard local as well:
    // no stale request may prevent the current account from fetching now.
    inflight?.controller.abort()
    const controller = new AbortController()
    let run: Promise<void>
    run = (async (): Promise<void> => {
      let models: readonly WorkBuddyModelInfo[]
      try {
        const credential = await runtime.store.resolve()
        const resolvedIdentity = credentialIdentity(credential)
        // `current()` established the identity that owns this fetch, but
        // `resolve()` reads the desktop file again. The App can switch accounts
        // between those reads; never send or persist B's directory as A's.
        if (resolvedIdentity !== identity) {
          adoptIdentity(runtime, resolvedIdentity)
          await fetchCatalog(runtime, resolvedIdentity)
          return
        }
        models = await runtime.client.fetchModels(credential, controller.signal)
        // The account can also change while the upstream request is in flight.
        // Re-read before publishing so the just-finished document still belongs
        // to the account that is currently selected in the desktop App.
        const latest = await runtime.store.current()
        const latestIdentity = latest === undefined ? undefined : credentialIdentity(latest)
        if (latestIdentity !== identity) {
          adoptIdentity(runtime, latestIdentity)
          if (latestIdentity !== undefined) await fetchCatalog(runtime, latestIdentity)
          return
        }
      } catch (error: unknown) {
        // Report only if this attempt is still the current one; a failure from
        // a superseded attempt must not overwrite the newer state's error.
        if (stopped || runtime.catalogGeneration !== generation) return
        runtime.lastFetchAtMs = Date.now()
        runtime.catalogError = error instanceof Error ? error.message.slice(0, 300) : String(error)
        ctx.logger.warn(
          `dsh-workbuddy-connect: ${runtime.variant.displayName} catalog unavailable; serving the fallback list`,
          error,
        )
        runtime.invalidate()
        return
      }
      if (stopped || runtime.catalogGeneration !== generation) return
      runtime.lastFetchAtMs = Date.now()
      runtime.catalog.set([...models])
      runtime.catalogSource = 'live'
      runtime.catalogFetchedAtMs = runtime.client.lastCatalog?.fetchedAtMs ?? Date.now()
      runtime.catalogError = undefined
      // Remember it for this account, so a restart — or a later fetch that
      // fails — can serve what this account was actually shown rather than the
      // snapshot compiled into the plugin.
      if (lastIdentities.get(runtime.variant.id) === identity) {
        runtime.savedCatalogs.set(identity, {
          source: runtime.client.lastCatalog?.source ?? 'unknown',
          fetchedAtMs: runtime.client.lastCatalog?.fetchedAtMs ?? Date.now(),
          models: [...models],
          ...runtime.client.lastCatalog?.appVersion === undefined
            ? {}
            : { appVersion: runtime.client.lastCatalog.appVersion.version },
        })
      }
      runtime.invalidate()
    })().finally(() => {
      if (runtime.inflightFetch?.promise === run) runtime.inflightFetch = undefined
    })
    runtime.inflightFetch = { identity, generation, controller, promise: run }
    return run
  }

  /**
   * Reconcile one variant with its credentials.
   *
   * Four transitions matter, and each is a different action:
   *
   * - **none → some** (first sighting): reveal the group and fetch a catalog.
   * - **none → some, identity changed**: additionally drop the previous
   *   account's observations, so another user's probe answers cannot be read as
   *   the new account's.
   * - **some → none**: hide the group and stop serving its models.
   * - **same identity**: nothing to do — the store refreshes tokens on demand,
   *   and re-fetching on every rotation would hit the catalog endpoint for no
   *   new information.
   */
  const syncVariant = async (runtime: VariantRuntime): Promise<void> => {
    if (stopped || !runtime.registered) return
    const credential = await runtime.store.current().catch((error: unknown) => {
      // A region mismatch or an unreadable file is reported, not swallowed as
      // "signed out": the user needs to know which file to fix.
      ctx.logger.warn(`dsh-workbuddy-connect: ${runtime.variant.displayName} credential read failed`, error)
      return undefined
    })
    if (stopped) return

    if (credential === undefined) {
      adoptIdentity(runtime, undefined)
      return
    }

    const identity = credentialIdentity(credential)
    const known = lastIdentities.get(runtime.variant.id)
    if (known === identity && runtime.catalog.isVisible()) {
      // Same account, already showing something. One case still needs a fetch:
      // an earlier attempt failed, so the group is on the fallback roster and
      // nothing else will ever replace it. Retry on a slow backoff rather than
      // every sweep, so a persistent outage does not become a request loop.
      // Any non-live source is stale: both the saved catalog and the built-in
      // roster are worth replacing with a fresh fetch on the same backoff.
      const stale = runtime.catalogSource !== 'live'
      const due = Date.now() - runtime.lastFetchAtMs >= credentialPollMs() * CATALOG_RETRY_SWEEPS
      if (stale && due) await fetchCatalog(runtime, identity)
      return
    }

    adoptIdentity(runtime, identity)
    await fetchCatalog(runtime, identity)
  }

  /** Run one reconcile sweep across both variants. */
  const syncAll = async (): Promise<void> => {
    for (const runtime of runtimes) await syncVariant(runtime)
  }

  void Promise.all(runtimes.map(async runtime => startVariant(ctx, runtime, async () => {
    // The immediate seed: adopt whatever credential is in effect right now, so
    // a reloaded fiber never serves an empty catalog while the sweep catches up.
    // (A 0.1.7 settings write hot-reloads this fiber; the fresh runtime's
    // catalog starts hidden, and the card's post-write refresh would otherwise
    // land in that window and show "暂无可配置的模型".)
    if (stopped) return
    let credential
    try {
      credential = await runtime.store.current()
    } catch {
      return
    }
    if (credential === undefined) return
    const identity = credentialIdentity(credential)
    if (lastIdentities.get(runtime.variant.id) !== identity || !runtime.catalog.isVisible()) {
      adoptIdentity(runtime, identity)
    }
  }))).then(() => {
    if (stopped) return
    // The host bundle is live: write a heartbeat so the status CLI can report
    // host health without a browser. Cleared on disposal; a stale heartbeat
    // after a crash is detected by PID in the reader. Written when at least one
    // variant registered, since that is what "the host bundle serves models"
    // means for this plugin.
    if (runtimes.some(runtime => runtime.registered)) void writeHostHeartbeat()

    void syncAll()
    const timer = setInterval(() => { void syncAll() }, credentialPollMs())
    timer.unref?.()
    timers.push(timer)
  })
}
