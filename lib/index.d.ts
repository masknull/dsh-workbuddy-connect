import z from "@deepseek-ai/schemastery";
import "@earendil-works/pi-ai";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { IncomingMessage, ServerResponse } from "node:http";
import { Context } from "@deepseek-ai/cordis";
import { SettingsNamespace } from "@deepseek-ai/dsh-settings";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
//#region src/paths.d.ts
/**
 * The plugin's data directory — the ONE place every file the plugin owns
 * lives.
 *
 * Layout: `<profile>/.dsh-workbuddy-connect/config/` (the profile discovered
 * the same way the credential store always did). Everything — credentials,
 * saved catalogs, probe results, the host heartbeat, App-version caches —
 * writes there, so a profile directory never collects loose `.workbuddy-*`
 * files and the whole plugin's footprint is one folder.
 *
 * Fallbacks, in order: `DSH_WORKBUDDY_DATA_DIR` env override → the discovered
 * profile → the Harness home (a checkout running its own tests, or a host
 * loading the plugin from outside any profile).
 *
 * Split out of `auth.ts` so catalog/probe/heartbeat stores can import the
 * directory without pulling in the credential code (and its upstream
 * dependency) — these modules stay leaf-light on purpose.
 *
 * @module dsh-workbuddy-connect/paths
 */
/** The per-profile directory the plugin's data folder lives under. */
declare const WORKBUDDY_DATA_DIR_NAME = ".dsh-workbuddy-connect";
/** Environment override for the whole data directory. */
declare const WORKBUDDY_DATA_DIR_ENV = "DSH_WORKBUDDY_DATA_DIR";
/**
 * The plugin's data directory: `<profile>/.dsh-workbuddy-connect`.
 *
 * Falls back to the Harness home when no profile can be discovered — a
 * checkout running its own tests, or a host that loads the plugin from
 * outside a profile — so the plugin always has somewhere to write, and
 * `DSH_WORKBUDDY_DATA_DIR` overrides either way.
 */
declare function workbuddyPluginDataDir(): string;
//#endregion
//#region src/app-version.d.ts
/** Basename of the saved version under `$DSH_HOME`. */
declare const WORKBUDDY_APP_VERSION_FILENAME = ".workbuddy-ai-version.json";
/** Where the version came from, for `doctor` output. */
type WorkBuddyAppVersionSource = 'installed' | 'saved' | 'fallback';
/** Resolved version plus provenance. */
interface AppVersionInfo {
  version: string;
  source: WorkBuddyAppVersionSource;
  /** Basename of the App bundle the version was read from, when installed. */
  bundle?: string;
}
/**
 * Whether a string is safe to interpolate into an HTTP header.
 *
 * Strict on purpose: the value reaches a header, so anything that could split
 * the request (CR, LF, spaces beyond the separator) or inject a second UA
 * token must never pass. The App's own version is always `N.N.N` or `N.N.N.N`.
 */
declare function validAppVersion(value: unknown): value is string;
/**
 * Read `CFBundleShortVersionString` out of an `Info.plist`.
 *
 * Parsed as XML rather than grepped, because the plist contains several
 * `<string>` values and a regex would be one unrelated key away from
 * returning the wrong one. A binary plist has no `<dict>` in its bytes and is
 * reported as unreadable (the saved value then applies) rather than guessed at.
 */
declare function readBundleVersion(plistPath: string): Promise<string | undefined>;
/**
 * The installed international App's version, or `undefined` when it is not
 * installed (or not readable).
 *
 * Windows and Linux have no verified bundle-metadata location yet, so this
 * returns `undefined` there and the saved/fallback value is used instead of
 * guessing a path — the same discipline the credential discovery follows.
 */
declare function installedAppVersion(): Promise<{
  version: string;
  bundle: string;
} | undefined>;
/** Constructor dependencies; all injectable so tests never touch the real FS. */
interface ResolveAppVersionOptions {
  /** Installed-version reader; defaults to {@link installedAppVersion}. */
  installed?: () => Promise<{
    version: string;
    bundle: string;
  } | undefined>;
  /** Saved-version path; defaults to {@link appVersionPath}. */
  path?: string;
}
/**
 * Resolve the UA version: installed App first, then the last saved value, then
 * the compiled-in fallback.
 *
 * A value read from the App is written back immediately, so an uninstalled App
 * or an unreadable plist later still has the last real version to fall back
 * on. The write is best-effort: failing to cache a version must never fail the
 * catalog request that asked for it.
 */
declare function resolveAppVersion(options?: ResolveAppVersionOptions): Promise<AppVersionInfo>;
/**
 * Build the App-shaped User-Agent for catalog requests.
 *
 * `WorkBuddyAI/<version>` with no space is the form measured to reach the App
 * document; the space form is rejected with 400/12403. Throws on an invalid
 * version rather than sending a malformed header.
 */
declare function appUserAgent(version: string): string;
//#endregion
//#region src/client-identity.d.ts
/**
 * Compiled-in CN fallback for the `WorkBuddy/<v>` tokens.
 *
 * Observed on the CN desktop app installed here (research §3.1, verified
 * 2026-09-11); like the international fallback it is a shape requirement,
 * not a currency claim — the gateway has not been observed to branch on it.
 */
declare const FALLBACK_CN_APP_VERSION = "5.5.6";
/**
 * Basename of the CN saved-version cache under `$DSH_HOME`.
 *
 * Deliberately not the international `.workbuddy-ai-version.json`: that file
 * feeds the international catalog's User-Agent, and a CN App writing its
 * version into it would relabel that request. The two caches stay isolated
 * the way the per-variant catalog files are.
 */
declare const CN_APP_VERSION_FILENAME = ".workbuddy-app-version.json";
/** The resolved identity a chat request presents as. */
interface ChatIdentity {
  /** Desktop App version; drives both `WorkBuddy/<v>` product tokens. */
  clientVersion: string;
  /** Bundled agent-CLI version; absent drops the `CLI/…` UA token. */
  cliVersion?: string;
}
/**
 * Whether a value is a CLI version that may reach a header.
 *
 * Tolerates a prerelease suffix (`2.137.1-rc.1`) because the bundled CLI's
 * own metadata uses that spelling; anything with whitespace, CR or LF never
 * passes — the value is interpolated into an HTTP header.
 */
declare function validCliVersion(value: unknown): value is string;
/**
 * The bundled agent CLI's real version, or `undefined` when it does not resolve.
 *
 * `cli/package.json` ships a `0.0.0` placeholder in `version` with the real
 * version in `publishConfig.customPackage.version`; a valid non-placeholder
 * `version` wins, otherwise the custom-package value applies, and unreadable
 * or invalid metadata yields `undefined` (the caller drops the `CLI/…` UA
 * token rather than guessing).
 */
declare function readCliVersion(bundle: string): Promise<string | undefined>;
/**
 * Build the chat User-Agent for one region.
 *
 * Throws on an invalid version rather than interpolating one into a header;
 * `resolveChatIdentity` never produces such an identity, so the throw is a
 * last gate against future call-site mistakes, not an expected path.
 */
declare function chatUserAgent(identity: ChatIdentity, region: WorkBuddyRegion): string;
/** Constructor dependencies; every reader is injectable so tests never touch a real App or home. */
interface ResolveChatIdentityOptions {
  /** Installed CN desktop-bundle reader; defaults to the macOS probe. */
  installedCn?: () => Promise<{
    version: string;
    bundle: string;
  } | undefined>;
  /** International version resolver; defaults to `app-version.ts`'s chain. */
  resolveIntl?: () => Promise<AppVersionInfo>;
  /** CLI-version reader; defaults to reading the bundle's `cli/package.json`. */
  cliVersion?: (bundle: string) => Promise<string | undefined>;
  /** CN saved-cache path; defaults to `$DSH_HOME/.workbuddy-app-version.json`. */
  cnSavedPath?: string;
}
/**
 * Resolve the chat identity for one region: installed App → region's saved
 * value → compiled-in fallback. Never throws — a missing App, an unreadable
 * plist, a failed cache write, or a reader that throws outright all degrade
 * to {@link fallbackChatIdentity}; resolution never blocks a message.
 *
 * The production path caches per region (a message must not re-read the
 * install tree); any injected option bypasses the cache entirely so tests
 * with different readers cannot observe each other's resolutions.
 */
declare function resolveChatIdentity(region: WorkBuddyRegion, options?: ResolveChatIdentityOptions): Promise<ChatIdentity>;
/**
 * The region's compiled-in fallback identity: the desktop form with the
 * built-in version and no `CLI/…` segment. This is the single degraded
 * shape every failure path converges on — a thrown reader, an unreadable
 * bundle, or a missing cache all present this, never the legacy CLI UA.
 */
declare function fallbackChatIdentity(region: WorkBuddyRegion): ChatIdentity;
//#endregion
//#region src/probe.d.ts
/**
 * The canonical values a probe tests, in a fixed order.
 *
 * `minimal` is absent: it appears in no upstream vocabulary. `off` is absent
 * by policy — disabling thinking is a separate capability the upstream must
 * declare through `canDisableThinking`, never something probing may infer.
 */
declare const PROBE_EFFORT_CANDIDATES: readonly WorkBuddyEffort[];
/** Sentinel generator; injectable so tests get deterministic values. */
type SentinelFactory = () => string;
/** Default sentinel: unmistakably non-canonical, different on every call. */
declare function randomSentinel(): string;
/**
 * One response as the probe sees it, split into the only distinctions the
 * attribution rule needs.
 */
interface ProbeAttempt {
  /** HTTP status, or 0 for a transport failure. */
  status: number;
  /** True when a parseable SSE event arrived. */
  streamed: boolean;
  /** `extError.code` from a JSON error body, when present. */
  errorCode?: string;
  /** Free-form detail for logs; never shown as a capability claim. */
  detail?: string;
}
/** How one attempt is performed; the caller owns credentials and HTTP. */
type ProbeSender = (effort: string | undefined, signal: AbortSignal) => Promise<ProbeAttempt>;
/** The outcome of probing one model. */
type ProbeOutcome = {
  validation: 'validating';
  efforts: readonly WorkBuddyEffort[];
  requests: number;
} | {
  validation: 'non-validating';
  efforts: readonly [];
  requests: number;
} | {
  validation: 'unknown';
  efforts: readonly [];
  requests: number;
  reason: string;
};
/**
 * Probe one model.
 *
 * `options.candidates` exists so tests can shorten the sweep; production always
 * uses {@link PROBE_EFFORT_CANDIDATES}.
 */
declare function probeModel(options: {
  send: ProbeSender;
  sentinel?: SentinelFactory;
  candidates?: readonly WorkBuddyEffort[];
  timeoutMs?: number;
}): Promise<ProbeOutcome>;
//#endregion
//#region src/upstream.d.ts
/** WorkBuddy region selected by the credential's login domain. */
type WorkBuddyRegion = 'cn' | 'global';
/** Upstream failure classes the shim maps onto distinct HTTP answers. */
type UpstreamErrorKind = 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client';
/** One CLI-usable model as the upstream catalog describes it. */
interface WorkBuddyUpstreamModel {
  id: string;
  name: string;
  contextWindow: number;
  /** The upstream's preferred window before an optional maximum is selected. */
  defaultContextWindow?: number;
  maxInputTokens?: number;
  supportedContextWindows?: readonly number[];
  promotions?: readonly WorkBuddyPromotion[];
  maxTokens: number;
  /**
   * Upstream-declared image input capability. Missing or false upstream data
   * resolves to false, so an unknown model stays text-only: over-claiming
   * admits an image the provider then rejects after the message is durable.
   */
  supportsImages: boolean;
  /**
   * Reasoning metadata the upstream catalog declares per model. The wire
   * effort values (`low`, `medium`, `high`, `xhigh`, `max`) map directly onto
   * pi-ai's thinking levels, and the supported set decides which levels the
   * DSH model selector offers.
   */
  reasoning?: WorkBuddyModelReasoning;
  /**
   * Billing convenience metadata: the credits multiplier string the upstream
   * reports (e.g. `"x0.00"` for free) and promotional badges like
   * `badge:限时免费:#FF0000` or `badge:夜间折扣:#1E90FF`.
   *
   * The multiplier reaches the browser through the host LLM seam, which has no
   * locale service, so {@link normalizeCredits} trims it to a
   * language-neutral display form (`x0.79`) that reads the same in every UI
   * language. The raw upstream string (which may spell `x0.79 credits`) stays
   * on {@link WorkBuddyModelBilling.credits} for diagnostics.
   */
  billing?: WorkBuddyModelBilling;
}
/** Reasoning metadata the upstream catalog declares for one model. */
interface WorkBuddyModelReasoning {
  /** Whether the model does any reasoning at all (upstream `supportsReasoning`). */
  supports: boolean;
  /** Whether the model can only think (upstream `onlyReasoning`). */
  onlyReasoning: boolean;
  /** Selectable effort values; absent means the model has no explicit set. */
  supportedEfforts?: readonly WorkBuddyEffort[];
  /** Default effort the upstream uses when none is chosen. */
  defaultEffort?: WorkBuddyEffort;
  /** Whether thinking can be switched off; false means it is always on. */
  canDisableThinking: boolean;
}
/** The concrete effort spellings WorkBuddy exposes on the wire. */
type WorkBuddyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Billing convenience metadata reported for one model. */
interface WorkBuddyModelBilling {
  /** Credits multiplier, e.g. `"x0.00"` (free) or `"x0.79"`. */
  credits?: string;
  /** Promotional tags, e.g. `"限时免费"`, `"夜间折扣"`. */
  badges?: readonly string[];
  /** Whether the model is currently free (`x0.00` credits). */
  free: boolean;
  /**
   * The rate cannot be stated for this model right now.
   *
   * Set when a row that arrived with promotions attached has no promotion in
   * force: the upstream bakes the discounted value into `credits`, so the
   * cached rate describes a discount that has ended. The original price is not
   * recoverable from the row, so the plugin reports "unknown, refresh needed"
   * rather than repeating a figure it can no longer stand behind — in
   * particular it never keeps claiming the model is free.
   */
  rateUnknown?: boolean;
}
/** One billing package and its remaining credit. */
interface WorkBuddyCreditAccount {
  packageName: string;
  remain: number;
  size: number;
  unlimited?: true;
  /**
   * When this package's credit expires, verbatim from the upstream
   * `PackageEndTime` field (`"YYYY-MM-DD HH:mm:ss"`, a UTC+8 wall-clock
   * string; the field name is corroborated by the request body's own
   * `PackageEndTimeRange*` filters and by workbuddy2api's parser). An absent
   * value means the upstream reported no expiry for this package — rendered
   * as "no expiry", never guessed into a date.
   */
  packageEndTime?: string;
}
/** Aggregated credit answer for one credential. */
interface WorkBuddyCredits {
  total: number;
  /**
   * The summed per-package totals (size), i.e. the account's total granted
   * credit this cycle — the denominator for the dashboard's overall bar.
   * The upstream's own `TotalDosage` acts as a FLOOR when it is larger
   * (workbuddy2api's `ResourceSummary` ruling: consumed credit cannot exceed
   * the total dosage), never as a fabricated value when the packages already
   * sum higher.
   */
  totalSize?: number;
  accounts: readonly WorkBuddyCreditAccount[];
  /**
   * The account's cycle quota is uncapped (`limitNum === -1` on the CN
   * enterprise endpoint).
   *
   * A separate flag rather than a `-1`/`0` sentinel in {@link total}: the two
   * mean opposite things to a reader ("no limit" vs "nothing left"), and the
   * existing negative-clamp in the personal branch would turn a sentinel into
   * a plausible-looking zero. Every renderer must therefore test this flag
   * first and not fall back to `total` when it is set.
   */
  unlimited?: true;
  cycleResetTime?: string;
}
/** Token refresh answer; fields the upstream omits stay absent. */
interface WorkBuddyRefreshOutcome {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
  domain?: string;
}
/** Daily check-in activity status. */
interface WorkBuddyCheckinStatus {
  active: boolean;
  todayCheckedIn: boolean;
  streakDays: number;
  dailyCredit: number;
  todayCredit: number;
  isStreakDay: boolean;
  nextStreakDay: number;
  streakBonusDays: number;
  streakBonusCredit: number;
  claimButtonText?: string;
}
/** Result of claiming the daily check-in. */
interface WorkBuddyCheckinClaim {
  credit: number;
  streakDays: number;
  isStreakDay: boolean;
  alreadyClaimed?: boolean;
  noCampaign?: boolean;
}
/** Chat answer: either a live SSE response or a classified failure. */
type WorkBuddyChatResult = {
  ok: true;
  response: Response;
} | {
  ok: false;
  status: number;
  kind: UpstreamErrorKind;
  message: string;
};
/**
 * Reduce an upstream credits string to its language-neutral display form.
 *
 * The host LLM seam carries this text to the browser, and the host has no
 * locale service — whatever string is produced here is shown verbatim in every
 * UI language. The upstream is inconsistent in a way that matters: some catalog
 * rows report a bare multiplier (`x0.79`) and others append a unit word
 * (`x0.79 credits`), and the unit word would pin the display to English.
 * Dropping a trailing `credits` (case-insensitive, singular or plural) yields
 * the one spelling that reads identically in every language.
 *
 * @param credits - raw upstream credits string, e.g. `"x0.79 credits"`.
 * @returns the bare multiplier, or undefined when nothing displayable remains.
 */
declare function normalizeCredits(credits: string | undefined): string | undefined;
/**
 * Classify an upstream failure from its HTTP status and body excerpt.
 *
 * Order is load-bearing:
 *
 * - A hard credit refusal (402, or an exhausted-balance phrase) is terminal for
 *   the account, so it is checked first.
 * - Session death follows, because its marker appears in bodies that also carry
 *   other numbers.
 * - **429 comes before the credit phrase list.** A throttling body often also
 *   says "quota exceeded"; reading that as an exhausted balance parks a healthy
 *   account until the next billing day instead of retrying shortly. Testing the
 *   status first is what keeps the two apart.
 * - The phrase lists then catch what the status alone does not report.
 */
declare function classifyUpstreamError(status: number, body: string): UpstreamErrorKind;
/** Region for a login domain; an empty domain means CN (matching upstream tooling). */
declare function regionOf(domain: string): WorkBuddyRegion;
/**
 * Normalize an OpenAI chat-completions body for the WorkBuddy upstream: force
 * `stream: true` (the upstream rejects non-streaming), translate the
 * `max_completion_tokens` alias, default `stream_options`, flatten `tool_choice`
 * (the upstream's field is a string; object forms return 400), and rewrite
 * `developer` messages as `system`.
 *
 * The `developer` rewrite is load-bearing: pi-ai emits the system prompt as
 * `role: "developer"` (the OpenAI convention it adopted), but the WorkBuddy
 * upstream rejects that role with HTTP 400 code 11128 ("Illegal API
 * invocation from an unapproved channel"). Rewriting to `system` is the
 * compatible spelling the upstream accepts.
 */
declare function prepareChatBody(source: string): string;
/** Provenance of one successful catalog fetch, surfaced by the status card. */
interface WorkBuddyCatalogFetch {
  fetchedAtMs: number;
  /** Which document answered, e.g. `workbuddy-ai:app`. */
  source: string;
  /** UA version used, when the request needed one. */
  appVersion?: AppVersionInfo;
}
/** Constructor dependencies. */
interface WorkBuddyUpstreamClientOptions {
  /** App-version resolver for international catalog requests; injectable for tests. */
  resolveAppVersion?: () => Promise<AppVersionInfo>;
  /**
   * Chat-identity resolver for chat and probe requests; injectable for tests.
   * Defaults to `client-identity.ts`'s per-region chain. Refresh, catalog, and
   * billing never consult it — those requests keep their long-standing headers.
   */
  resolveChatIdentity?: (region: WorkBuddyRegion) => Promise<ChatIdentity>;
}
/**
 * Upstream HTTP client. One instance serves the whole plugin; requests take
 * the credential explicitly so token refreshes apply on the next call.
 *
 * One instance is *per variant*: the international provider needs its own
 * catalog source, UA version, and probe differences, and keeping them on the
 * instance avoids passing a variant through every call signature.
 */
declare class WorkBuddyUpstreamClient {
  /**
   * Resolves the App-shaped UA version for international catalog requests.
   * Injectable so tests never read the real filesystem.
   */
  private readonly resolveAppVersion;
  /** Chat-identity resolver; see {@link WorkBuddyUpstreamClientOptions.resolveChatIdentity}. */
  private readonly resolveChatIdentity;
  /** Provenance of the most recent successful catalog fetch, for the card. */
  lastCatalog: WorkBuddyCatalogFetch | undefined;
  constructor(options?: WorkBuddyUpstreamClientOptions);
  /** POST the chat endpoint; a successful answer is the raw SSE response. */
  chatStream(credential: WorkBuddyCredential, bodyJson: string, signal?: AbortSignal): Promise<WorkBuddyChatResult>;
  /** POST the token-refresh endpoint; the caller merges the outcome. */
  refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome>;
  /**
   * GET the personal model catalog.
   *
   * Two upstream documents feed this, one per variant:
   *
   * - CN (`workbuddy`): `/console/enterprises/personal/models`, the document
   *   the official CLI itself consumes. Unchanged behaviour.
   * - International (`workbuddy-ai`): `/v3/config`, the product document the
   *   App's main process fetches. The gateway splits it by User-Agent, so this
   *   request carries the App-shaped UA while every other request keeps the
   *   CLI UA it has always sent.
   *
   * Both are unwrapped and classified the same way — `readEnvelope` plus
   * `envelopeError` — so an expired session or exhausted credit is reported as
   * such rather than as a generic catalog failure.
   */
  fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyUpstreamModel[]>;
  /**
   * POST the billing endpoint for the aggregated remaining credit.
   *
   * Two upstream shapes, chosen by account type:
   *
   * - **CN enterprise** (`regionOf === 'cn'` and `enterpriseId` non-empty) asks
   *   `/v2/billing/meter/get-enterprise-user-usage`, which answers with a single
   *   cycle quota. The personal endpoint serves these accounts an empty
   *   `Accounts` list, which the card then renders as "0 credit" — a wrong
   *   number rather than a visible failure (issue #31).
   * - **Everyone else** keeps the personal endpoint unchanged.
   *
   * The region gate is load-bearing: the enterprise endpoint is unverified for
   * the global region, so an international credential that happens to carry an
   * `enterpriseId` must stay on the measured personal path instead of being
   * moved onto an unmeasured one.
   */
  fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits>;
  /**
   * CN enterprise credit read: a single cycle quota instead of a package list.
   *
   * Verified against the WorkBuddy desktop app (`app.asar`,
   * `BackendProvider.getEnterpriseUsage` and `CloudAccountRepo.billing`): the
   * body is an empty object and the account identity travels only in the
   * headers. The two official call sites disagree on the field spelling
   * (`limitNum`/`credit` vs `limit_num`/`used_num`), so both are accepted.
   *
   * A body carrying no recognisable quota field is a hard error rather than a
   * zero. Rendering `0` for "we did not understand the answer" is exactly how
   * issue #31 stayed invisible while users saw a plausible wrong number.
   *
   * The error names fields and types only: it reaches the browser, and the
   * response body may describe the account's usage.
   */
  private fetchEnterpriseCredits;
  /** Query today's check-in status without changing account state. */
  fetchCheckinStatus(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinStatus>;
  /** Claim today's check-in reward. */
  claimDailyCheckin(credential: WorkBuddyCredential): Promise<WorkBuddyCheckinClaim>;
  /**
   * One probe request: a real streaming chat call carrying the effort under
   * test.
   *
   * Shares `chatHeaders` with the normal chat path on purpose — the plan
   * forbids probing through anything but the plugin's own credential handling,
   * so a result describes what a real message would experience.
   *
   * The caller aborts as soon as a parseable event arrives; the body is never
   * assembled into an answer. `reasoning_effort` is omitted entirely (rather
   * than sent empty) when `effort` is undefined, so the baseline case is a
   * genuinely bare request.
   *
   * Two international differences, both measured on 2026-09-11:
   *
   * - The gateway requires a leading `system` message (400/11128 otherwise), so
   *   one is prepended for the global region only.
   * - `max_tokens: 1` is below some models' floor (the GPT-5.6 family rejects it
   *   with 400/11133 `integer_below_min_value`), so the international probe asks
   *   for a slightly larger minimum. This is a floor the plugin must clear, not
   *   evidence about any model's effort support: a model still refusing that
   *   minimum is reported as an incompatible request, never as "effort
   *   unsupported", and the ceiling is never raised further to force an answer.
   */
  probeEffort(credential: WorkBuddyCredential, model: string, effort: string | undefined, signal: AbortSignal): Promise<ProbeAttempt>;
}
/** Parse either response shape after its envelope has been checked. */
declare function parseModelCatalog(data: Record<string, unknown>, international?: boolean): readonly WorkBuddyUpstreamModel[];
/**
 * One verified promotion entry.
 *
 * Only the shape actually observed in the international App document is
 * modelled — an enabled, time-boxed, `displayMode: "replace"` discount. An
 * entry that does not match is dropped rather than guessed at: rendering a
 * discount the plugin does not understand could understate what the user pays.
 */
interface WorkBuddyPromotion {
  /** Window start, epoch ms, parsed from the document's offset timestamp. */
  start: number;
  /** Window end, epoch ms. */
  end: number;
  /** Badge text as the upstream wrote it, e.g. `Free now`. */
  label: string;
  /** Multiplier applied to the model's rate; `0` replaces it outright. */
  factor: number;
  /** Higher wins when several promotions cover one model. */
  priority: number;
}
/**
 * Re-evaluate a model's promotion against the current time.
 *
 * Promotions are time-boxed, and the catalog they arrive in is cached for the
 * life of the process. Frozen at parse time, a cached "Free now" would keep
 * claiming a discount after `validUntil` had passed, and would keep showing the
 * pre-discount rate as the discounted one. Re-deriving on every read means the
 * badge disappears on its own and the rate reverts, with no refresh needed.
 *
 * Non-destructive: the model's own `credits` and `badges` are the base, and the
 * promotion is layered onto a copy. A model with no live promotion is returned
 * as-is, so the common case allocates nothing.
 */
declare function modelWithCurrentPromotion(model: WorkBuddyUpstreamModel, now?: number): WorkBuddyUpstreamModel;
/**
 * Apply the international endpoint's extra chat requirement: the first message
 * must be a system prompt.
 *
 * The international gateway rejects a body whose first message is not `system`
 * with HTTP 400 code 11128 ("first message is not system prompt"). Note that
 * the *same* code means something else on the CN endpoint — there it reports a
 * rejected `developer` role — so the two are never branched on by code alone.
 *
 * The added prompt is deliberately empty of user content and prepended, never
 * merged: existing messages keep their order and wording. A body that is not a
 * JSON object is returned unchanged, exactly as {@link prepareChatBody} does,
 * so this is safe to run over an already-prepared-or-not body.
 */
declare function prepareInternationalChatBody(source: string): string;
//#endregion
//#region src/variants.d.ts
/** One WorkBuddy product variant. */
interface WorkBuddyVariant {
  /** Provider id registered with DSH, e.g. `workbuddy-ai`. */
  id: string;
  /** Model-group heading and card title stem, e.g. `WorkBuddy AI`. */
  displayName: string;
  /** Product name as users know it, for diagnostics and error copy. */
  appName: string;
  /** Which upstream realm this variant's credentials must belong to. */
  region: WorkBuddyRegion;
  /** Basename of the plugin-owned credential file under `$DSH_HOME`. */
  ownFilename: string;
  /** Basename of the plugin-owned probe-record file under `$DSH_HOME`. */
  probeFilename: string;
  /**
   * Basename of the plugin-owned saved-catalog file under `$DSH_HOME`.
   *
   * One per variant, like the probe records: the two endpoints disagree about
   * rates, windows, and even which models exist for a shared id, so a catalog
   * saved from one must never be served as the other's.
   */
  catalogFilename: string;
  /** Same-origin status route consumed by this variant's card. */
  statusPath: string;
  /** Same-origin probe-control route consumed by this variant's card. */
  probePath: string;
  /** Same-origin sign-in route consumed by this variant's card. */
  loginPath: string;
}
/** CN WorkBuddy first: the existing provider keeps its id, paths, and copy. */
declare const WORKBUDDY_VARIANTS: readonly WorkBuddyVariant[];
/** The CN variant; the plugin's long-standing default and compatibility anchor. */
declare const CN_VARIANT: WorkBuddyVariant;
/** The international variant. */
declare const AI_VARIANT: WorkBuddyVariant;
/** Look up a variant by provider id. */
declare function variantFor(id: string): WorkBuddyVariant | undefined;
//#endregion
//#region src/auth.d.ts
/** The one provenance a stored credential can have: this plugin's own login. */
declare const WORKBUDDY_CREDENTIAL_SOURCE = "login";
/** Normalized WorkBuddy credential, timestamps in epoch milliseconds. */
interface WorkBuddyCredential {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  refreshExpiresAtMs?: number;
  domain: string;
  /**
   * The realm a supplied document declared, when it declared one.
   *
   * Absent for a credential this plugin obtained by logging in, whose realm the
   * domain already states. It exists for an imported document: the sibling
   * tooling writes an explicit `region`, and honouring it is what keeps a
   * credential that names its realm from being routed by a domain it disagrees
   * with.
   */
  region?: WorkBuddyRegion;
  uid: string;
  enterpriseId?: string;
  nickname?: string;
  /** Always {@link WORKBUDDY_CREDENTIAL_SOURCE}; carried so callers can display it. */
  source: typeof WORKBUDDY_CREDENTIAL_SOURCE;
}
/** Read-only sign-in summary for status and doctor output. */
interface WorkBuddyAuthStatus {
  state: 'signed-in' | 'signed-out';
  expiresAtMs?: number;
  refreshExpiresAtMs?: number;
  nickname?: string;
  domain?: string;
  /** Which upstream region the stored credential belongs to. */
  region?: WorkBuddyRegion;
  /**
   * Why no credential is usable, when the reason is diagnosable rather than
   * "nobody has signed in" 鈥?a credential stored for the other realm being the
   * case that matters.
   */
  reason?: string;
}
/** Constructor options; only {@link WorkBuddyStoreOptions.refresh} is required. */
interface WorkBuddyStoreOptions {
  variant?: WorkBuddyVariant;
  /** Explicit plugin-owned credential path, defaulting under `$DSH_HOME`. */
  ownPath?: string;
  /** Performs the upstream token refresh. */
  refresh: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome>;
  /** Refresh this long before actual expiry; default five minutes. */
  refreshMarginMs?: number;
}
/** Basename of the plugin-owned credential file inside the plugin's data directory. */
declare const WORKBUDDY_AUTH_FILENAME = ".workbuddy-auth.json";
/**
 * Plugin-owned credential path used when no variant names its own file.
 *
 * Credentials deliberately live at the DATA-DIRECTORY ROOT, outside `config/`
 * (the user's ruling): a credential is secret material, not configuration, and
 * keeping it apart from the rebuildable cache files makes "wipe the caches"
 * a safe gesture that can never touch a credential.
 *
 * @returns the path inside the plugin's data directory.
 */
declare function workbuddyOwnAuthPath(): string;
/**
 * Parse a WorkBuddy credential document in either on-disk layout: the nested
 * form `{"auth":{...},"account":{...}}` this plugin writes and the sibling
 * tooling publishes, and the flat form hand-written files use. Returns undefined
 * when the document carries no access token.
 *
 * Tolerance is deliberate: this is a published cross-tool format, and a file
 * written by a sibling tool must keep loading rather than silently signing the
 * user out. Two spellings of "which realm" are accepted 鈥?a top-level `region`
 * and a nested `auth.realm` 鈥?because both are in use.
 */
declare function parseWorkBuddyAuth(text: string): WorkBuddyCredential | undefined;
/**
 * Credential store with demand-driven refresh.
 *
 * Refresh policy: refresh only when the access token is inside the margin (or
 * already expired), and keep the refreshed credential in the plugin-owned file.
 * A failed refresh still returns a not-yet-expired token, so an unreachable
 * refresh endpoint does not take down a working session.
 */
declare class WorkBuddyCredentialStore {
  private readonly variant;
  private readonly refresh;
  private readonly refreshMarginMs;
  private readonly ownPath;
  private inflight;
  constructor(options: WorkBuddyStoreOptions);
  /** The plugin-owned credential path, for diagnostics. */
  ownAuthPath(): string;
  /**
   * Read the stored credential without refreshing anything.
   *
   * A credential belonging to the other realm is refused rather than used: one
   * plugin serves both products, and sending one realm's token to the other's
   * endpoint would leak it across products. The error names the file and the
   * expected realm, which is what makes it fixable.
   */
  current(): Promise<WorkBuddyCredential | undefined>;
  /**
   * Adopt a credential document supplied by the user.
   *
   * The document is parsed with the tolerant cross-tool reader, so a
   * `workbuddy.json` written by the sibling tooling imports as-is. It is then
   * checked against this store's realm before anything is written: a document
   * for the other product is refused with a message naming that product, rather
   * than stored and refused on every later read.
   *
   * @param text - the document's text, exactly as read from the user's file.
   * @returns the adopted credential, for a secret-free summary.
   * @throws when the text carries no usable credential or belongs to the other realm.
   */
  importDocument(text: string): Promise<WorkBuddyCredential>;
  /**
   * Persist a credential a login just obtained. This is the store's only write
   * path besides refresh; the login route is its only caller.
   *
   * A credential for the wrong realm is refused here, at the boundary that knows
   * which product asked, rather than written and refused on every later read.
   */
  save(credential: WorkBuddyCredential): Promise<void>;
  /**
   * The credential to send upstream: {@link current}, refreshed on demand.
   * Single-flight, so parallel requests share one refresh.
   */
  resolve(): Promise<WorkBuddyCredential>;
  /** Read-only sign-in summary; never refreshes and never throws. */
  status(): Promise<WorkBuddyAuthStatus>;
  /** Remove the stored credential. */
  logout(): Promise<void>;
  private needsRefresh;
  private refreshNow;
  private saveOwn;
  private readOwn;
}
//#endregion
//#region src/catalog.d.ts
/** One model entry the adapter exposes. */
type WorkBuddyModelInfo = WorkBuddyUpstreamModel;
/**
 * Static CLI models observed on the CN endpoint (re-verified against the live
 * catalog 2026-09-01, including the thinking-effort and billing metadata). The
 * upstream refresh replaces this list at startup; it exists so the provider
 * registers with a usable catalog even while the first fetch is in flight or
 * offline.
 *
 * The list tracks the `cli` agent's model roster exactly: the 16 models the
 * desktop CLI offers. Reasoning metadata is taken verbatim from the live
 * endpoint — each model's supported effort set and whether thinking can be
 * disabled — and the `free` flag follows the upstream `x0.00` credits marker.
 */
declare const FALLBACK_WORKBUDDY_MODELS: readonly WorkBuddyModelInfo[];
/**
 * Static CLI models for the international endpoint, captured 2026-09-11 from
 * the App-form `/v3/config` document (the 20 ids of its `cli` agent, in order).
 *
 * Same purpose and same discipline as {@link FALLBACK_WORKBUDDY_MODELS}: it
 * covers the window before the first successful fetch and an offline start,
 * and it is deliberately *not* a promise about the upstream's current state.
 * Reasoning metadata is verbatim from that snapshot. No promo badge is baked
 * in: promotions are time-boxed (`modelPromotions` carries `validFrom`/
 * `validUntil`), so hard-coding a "Free now" label would keep claiming a
 * discount the upstream may have already ended.
 */
declare const FALLBACK_WORKBUDDY_AI_MODELS: readonly WorkBuddyModelInfo[];
/**
 * Mutable catalog shared by the shim's `/v1/models` and the adapter.
 *
 * Visibility is separate from content. A variant whose app has no credentials
 * must expose *no* models rather than a fallback roster: the DSH model picker
 * drops an empty group, so an empty catalog is exactly how a provider hides
 * without touching registration. Serving the fallback to a signed-out user
 * instead offers models that can only fail (`store.resolve()` throws on the
 * first message), which is worse than showing nothing.
 *
 * The flag defaults to visible so a directly-constructed catalog behaves as it
 * always has; the plugin runtime applies the credential gate.
 */
declare class WorkBuddyCatalog {
  private models;
  private visible;
  private useMaximumContextWindow;
  constructor(initial?: readonly WorkBuddyModelInfo[]);
  /** Current entries; empty while the variant has no usable credential. */
  current(): readonly WorkBuddyModelInfo[];
  /** Replace the list; callers invalidate their adapter snapshot after this. */
  set(models: readonly WorkBuddyModelInfo[]): void;
  /** Whether this variant's models are exposed at all. */
  isVisible(): boolean;
  /**
   * Show or hide the whole catalog. Returns whether the value changed, so the
   * caller can skip an invalidation that would re-render an identical list.
   */
  setVisible(visible: boolean): boolean;
  /** Select the largest declared international window where the upstream offers one. */
  setUseMaximumContextWindow(useMaximum: boolean): boolean;
  /** Models to fall back to when the upstream fetch fails; ignores visibility. */
  fallback(): readonly WorkBuddyModelInfo[];
}
//#endregion
//#region src/probe-store.d.ts
/** Basename of the probe record inside the Harness home. */
declare const WORKBUDDY_PROBE_FILENAME = ".workbuddy-probe.json";
/**
 * Whether the model's effort parameter is actually validated.
 *
 * - `validating`: the upstream rejected an unknown sentinel value, so a
 *   per-level answer is meaningful.
 * - `non-validating`: the upstream accepted the sentinel, so it ignores or
 *   loosely coerces the parameter and no per-level answer can be trusted.
 * - `unknown`: baseline or sentinel failed for an unrelated reason (auth,
 *   rate limit, transport, ambiguous error body). Not a negative claim.
 */
type WorkBuddyProbeValidation = 'validating' | 'non-validating' | 'unknown';
/** One model's recorded observation. */
interface WorkBuddyProbeRecord {
  /** Fingerprint of the catalog row this observation was made against. */
  fingerprint: string;
  validation: WorkBuddyProbeValidation;
  /** Efforts verified as accepted; only ever non-empty for `validating`. */
  efforts: readonly WorkBuddyEffort[];
  /** When the probe ran, epoch milliseconds. */
  probedAtMs: number;
  /** Plugin version that produced the record. */
  pluginVersion: string;
  /**
   * The account this observation was made under, as `uid:enterpriseId`.
   *
   * An effort set is a fact about one account's entitlement as much as about
   * the model: the same model id can accept different levels under a different
   * subscription. Without this a record outlived the account that produced it,
   * so signing out and in as someone else inherited the previous account's
   * detected levels. Records written before this field existed carry no
   * identity and are therefore never reused.
   */
  account?: string;
}
/**
 * Plugin-owned probe record path inside the plugin's config directory.
 *
 * One file per variant. Same-named models exist on both endpoints (the
 * international catalog repeats `glm-5.3`, `glm-5.2`, `hy3`, `kimi-k2.6`), and
 * {@link fingerprintModel} covers only `id`/`reasoning`/`supportsImages` —
 * never the provider — so a single shared file would let one variant's
 * observation answer for the other. The paths differ; the format does not.
 */
declare function workbuddyProbePath(filename?: string): string;
/**
 * Fingerprint the catalog fields a probe depends on.
 *
 * Deliberately excludes display-only fields (`name`, `billing`, `contextWindow`)
 * so a rename or a promo badge does not throw away a valid observation, and
 * deliberately includes the whole reasoning object so any change to the
 * declared shape re-probes.
 */
declare function fingerprintModel(info: WorkBuddyModelInfo): string;
/** Options for {@link WorkBuddyProbeStore}. */
interface WorkBuddyProbeStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string;
  /** Observation lifetime; defaults to 14 days. */
  ttlMs?: number;
  /** Plugin version stamped into new records. */
  pluginVersion: string;
  /** Clock injection for tests. */
  now?: () => number;
}
/**
 * The plugin's probe records: read once, written atomically, never trusted
 * across a fingerprint change or past the TTL.
 */
declare class WorkBuddyProbeStore {
  private readonly path;
  private readonly ttlMs;
  private readonly pluginVersion;
  private readonly now;
  private records;
  constructor(options: WorkBuddyProbeStoreOptions | string);
  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string;
  private load;
  /**
   * The usable record for a model, or `undefined` when there is none, it is
   * expired, it was taken against a different catalog row, or it belongs to a
   * different account.
   *
   * @param account - the account in effect, as `uid:enterpriseId`. Records are
   *   only returned for the account that produced them.
   */
  get(modelId: string, fingerprint: string, account: string): WorkBuddyProbeRecord | undefined;
  /**
   * Store one observation. Only a decisive answer (`validating` /
   * `non-validating`) replaces an existing decisive record: a transient
   * `unknown` must not erase knowledge the user already paid for.
   */
  set(modelId: string, record: WorkBuddyProbeRecord): void;
  /** Drop every record; used by the card's explicit "clear" action. */
  clear(): void;
  /** Every record currently held, for status display. */
  all(): Readonly<Record<string, WorkBuddyProbeRecord>>;
  /** Build a record stamped with this store's clock, version, and account. */
  record(fingerprint: string, validation: WorkBuddyProbeValidation, efforts: readonly WorkBuddyEffort[], account: string): WorkBuddyProbeRecord;
  /**
   * Write through a temporary file and rename, so a crash mid-write cannot
   * leave a half-parsed document that reads as "no records" and silently drops
   * every observation.
   */
  private persist;
}
//#endregion
//#region src/shim.d.ts
/** Minimal logger surface the plugin context already provides. */
interface ShimLogger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
/** What the plugin needs from a running shim. */
interface WorkBuddyShim {
  /** Resolves once the listener is up; rejects if listening failed. */
  ready: Promise<void>;
  /** The shim origin, e.g. `http://127.0.0.1:39271`; valid after ready. */
  baseUrl(): string;
  /**
   * The per-process shared secret the plugin's own client must carry as
   * `Authorization: Bearer <token>`. Lives only in memory; the adapter
   * resolves this instead of the upstream access token, because the shim
   * resolves the real credential itself via the store.
   */
  token(): string;
  /** Stop serving and destroy open connections. */
  close(): Promise<void>;
}
/** Constructor dependencies. */
interface WorkBuddyShimOptions {
  store: WorkBuddyCredentialStore;
  client: Pick<WorkBuddyUpstreamClient, 'chatStream'>;
  catalog: WorkBuddyCatalog;
  logger?: ShimLogger;
}
/**
 * Start the loopback endpoint. Requests carry any bearer; the loopback bind
 * is the boundary, and the upstream credential comes from the store alone.
 */
declare function createWorkBuddyShim(options: WorkBuddyShimOptions): WorkBuddyShim;
//#endregion
//#region src/adapter.d.ts
/** Provider route this bundle owns. */
declare const WORKBUDDY_PROVIDER = "workbuddy";
/** Provider idle ceiling while one stream read is outstanding. */
declare const WORKBUDDY_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Constructor dependencies. */
interface WorkBuddyAdapterOptions {
  providerId?: string;
  displayName?: string;
  shim: WorkBuddyShim;
  store: WorkBuddyCredentialStore;
  catalog: WorkBuddyCatalog;
  /** Resolve the durable attachment service at request time, when present. */
  resolveAttachments?: () => AttachmentStore | undefined;
  /**
   * Look up a local probe observation for a model. Consulted only for rows the
   * upstream left undeclared; absent means declared-set-only behavior.
   */
  observe?: (modelId: string) => WorkBuddyProbeRecord | undefined;
}
/** What {@link createWorkBuddyAdapter} hands back. */
interface WorkBuddyAdapter {
  adapter: PiAiAdapter;
  /** Rebuild the adapter's provider snapshot; call after a catalog update. */
  invalidate: () => void;
}
/**
 * Assemble the adapter. The provider's `getModels` reads the live catalog,
 * and every model's `baseUrl` is re-resolved per read so the shim's
 * ephemeral port applies from the first snapshot after startup.
 *
 * The profile is constructed by hand rather than through dsh-llm-pi-ai's
 * internal `resolveProfiles()`: that helper is not part of the package's
 * public export surface (root entry, `lib/` deep imports blocked by the
 * exports map, `src/` not shipped), so hand-assembly is the only supported
 * path and every newly required field must be adopted here explicitly —
 * `modelErrors` since 0.1.5-alpha.2 (#12).
 */
declare function createWorkBuddyAdapter(options: WorkBuddyAdapterOptions): WorkBuddyAdapter;
//#endregion
//#region src/catalog-store.d.ts
/** Basename of the CN variant's saved catalog inside the plugin's config dir. */
declare const WORKBUDDY_CATALOG_FILENAME = ".workbuddy-catalog.json";
/** One saved catalog: the account it belonged to, and the models it listed. */
interface SavedCatalog {
  /** `uid:enterpriseId` the catalog was fetched for. */
  account: string;
  /** Which document answered, so a CN roster is never served as an AI one. */
  source: string;
  /** When the fetch succeeded, epoch milliseconds. */
  fetchedAtMs: number;
  models: readonly WorkBuddyUpstreamModel[];
  /** App version used as the UA, when the variant needed one. */
  appVersion?: string;
}
/** Plugin-owned saved-catalog path inside the plugin's config directory. */
declare function workbuddyCatalogPath(filename?: string): string;
/** Options for {@link WorkBuddyCatalogStore}. */
interface WorkBuddyCatalogStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string;
}
/**
 * The last successful catalog per account, read once and written atomically.
 *
 * Malformed content reads as "nothing saved" rather than throwing: this file
 * is an optimization for the offline and first-seconds cases, and a corrupt one
 * must never be able to stop the plugin from serving models.
 */
declare class WorkBuddyCatalogStore {
  private readonly path;
  private entries;
  constructor(options?: WorkBuddyCatalogStoreOptions | string);
  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string;
  private load;
  /** The saved catalog for one account, or `undefined` when there is none. */
  get(account: string): SavedCatalog | undefined;
  /**
   * Remember a catalog for an account, replacing whatever was saved before.
   *
   * A failed write is swallowed: the plugin has already served these models,
   * and losing the *memory* of them is not worth surfacing.
   */
  set(account: string, catalog: Omit<SavedCatalog, 'account'>): void;
  /** Forget one account's catalog — used when that account signs out. */
  delete(account: string): void;
  private persist;
}
//#endregion
//#region src/probe-service.d.ts
/** What the caller learns about a completed probe. */
type WorkBuddyProbeStatus = {
  state: 'ok';
  validation: WorkBuddyProbeRecord['validation'];
  efforts: readonly string[];
  requests: number;
} | {
  state: 'unavailable';
  reason: string;
};
/** Options for {@link WorkBuddyProbeService}. */
interface WorkBuddyProbeServiceOptions {
  store: WorkBuddyProbeStore;
  catalog: WorkBuddyCatalog;
  credentials: WorkBuddyCredentialStore;
  client: WorkBuddyUpstreamClient;
  /** Whether probing is permitted at all; consulted before every sweep. */
  consent: () => boolean;
  /**
   * The account currently in effect, as `uid:enterpriseId`, or `undefined`
   * while signed out.
   *
   * Records are read and written against this identity, and it is re-checked
   * after the sweep finishes: an observation produced under account A must not
   * be stored once account B is in effect, however long the probe took. The
   * caller's `clear()` on an account switch is not sufficient on its own,
   * because an in-flight probe completes *after* that clear.
   */
  account: () => string | undefined;
  sentinel?: SentinelFactory;
  /** Injectable for tests; defaults to the live upstream sender. */
  send?: (modelId: string) => ProbeSender;
}
/**
 * Serial probe runner. One instance is shared by the manual API and any
 * future automatic trigger, so the two can never overlap.
 */
declare class WorkBuddyProbeService {
  private readonly options;
  private queue;
  private readonly pending;
  private running;
  constructor(options: WorkBuddyProbeServiceOptions);
  /** Whether a sweep is in flight right now. */
  isRunning(): boolean;
  /**
   * The record the adapter may use for this model, or `undefined`.
   *
   * Applies the plan's precedence (§5): a declared set always wins, so a model
   * that declares `supportedEfforts` is never answered from an observation.
   */
  recordFor(modelId: string): WorkBuddyProbeRecord | undefined;
  /**
   * Probe one model, serially.
   *
   * The authenticated manual route supplies one-request consent after UI
   * confirmation. Other callers must pass the configured consent gate.
   * Manual consent never changes the automatic-probing configuration.
   * Explicit requests bypass historical results, but share an ongoing run.
   */
  probe(modelId: string, manualConsent?: boolean): Promise<WorkBuddyProbeStatus>;
}
//#endregion
//#region src/login.d.ts
/** Business code `auth/token` returns while the browser half is unfinished. */
declare const LOGIN_PENDING_CODE = 11217;
/** One issued login attempt: what to open, and what to poll with. */
interface WorkBuddyLoginAttempt {
  state: string;
  /** Browser URL the human opens to approve the sign-in. */
  authUrl: string;
  region: WorkBuddyRegion;
}
/** The token bundle `auth/token` returns once the browser half is finished. */
interface WorkBuddyLoginTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  domain: string;
}
/** The account identity `login/account` adds to a finished attempt. */
interface WorkBuddyLoginAccount {
  uid: string;
  enterpriseId?: string;
  nickname?: string;
}
/** Outcome of one poll. */
type WorkBuddyLoginPoll = {
  status: 'pending';
} | {
  status: 'complete';
  tokens: WorkBuddyLoginTokens;
  account: WorkBuddyLoginAccount;
};
/**
 * Normalize a realm spelling, folding anything unrecognised onto CN so a
 * missing or mistyped value behaves like the deployment the plugin shipped for.
 */
declare function normalizeLoginRegion(region: string | undefined): WorkBuddyRegion;
/**
 * The realm a finished login belongs to: the realm the attempt was started
 * against, falling back to what the returned domain says when the attempt
 * carried none. The domain fallback exists because the upstream may answer a
 * login with a credential for the domain it redirected to.
 */
declare function resolveLoginRegion(region: WorkBuddyRegion, domain: string): WorkBuddyRegion;
/**
 * The login client. One instance serves both cards; each attempt owns its own
 * cookie jar, keyed by the state it issued.
 */
declare class WorkBuddyLoginClient {
  private readonly fetchImpl;
  private readonly jars;
  constructor(fetchImpl?: typeof fetch);
  /** Request headers for one realm, carrying the attempt's cookies when it has any. */
  private headers;
  /**
   * Issue one attempt: obtain the state and the URL the human must open.
   *
   * The response's cookies are retained under the returned state, because the
   * poll that finishes this attempt has to present them.
   */
  begin(region: WorkBuddyRegion): Promise<WorkBuddyLoginAttempt>;
  /** Drop a finished or abandoned attempt's jar. */
  forget(state: string): void;
  /** How many attempts currently hold a jar; diagnostics and tests. */
  pendingCount(): number;
  /**
   * Poll one attempt once. The caller drives the cadence.
   *
   * `pending` covers both "the human has not finished" (business code 11217)
   * and "the gateway refused this poll yet" (a 4xx while the browser half is
   * still open) — the latter is what the CN endpoint answers before the
   * browser visit completes. A transport failure, or a 5xx, is a real error
   * and is thrown: retrying those as pending would hide an outage behind a
   * spinner that never resolves.
   */
  poll(attempt: WorkBuddyLoginAttempt): Promise<WorkBuddyLoginPoll>;
  /**
   * Read the account identity for a finished attempt.
   *
   * Best effort by design: the token bundle is what makes the credential
   * usable, and the identity only improves the display name and the
   * `X-User-Id` header. A failure here must not discard a working login.
   */
  private fetchAccount;
}
//#endregion
//#region src/status-paths.d.ts
/**
 * Plugin-owned sign-in endpoints, one per variant.
 *
 * Each variant signs in against its own realm, so each needs its own route: the
 * realm is chosen by which provider the user is looking at, never by a value the
 * browser sends. A POST here starts an attempt (or polls one, or signs out);
 * see {@link WorkBuddyWebLoginRequest}.
 */
declare const WORKBUDDY_LOGIN_PATH = "/plugins/dsh-workbuddy-connect/login";
declare const WORKBUDDY_AI_LOGIN_PATH = "/plugins/dsh-workbuddy-connect/ai/login";
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
type WorkBuddyWebLoginAction = 'begin' | 'poll' | 'logout' | 'import';
/** Request body accepted by the sign-in route. */
interface WorkBuddyWebLoginRequest {
  action: WorkBuddyWebLoginAction;
  /** The attempt to poll; required for `poll` and ignored otherwise. */
  state?: string;
  /**
   * The credential document to adopt; required for `import`.
   *
   * Travels as text rather than as a path because the browser has no filesystem:
   * the card reads the file the user picked and posts its contents. The host
   * parses and validates it before anything is written.
   */
  document?: string;
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
type WorkBuddyWebLoginResult = {
  status: 'pending';
  state: string;
  url?: string;
} | {
  status: 'complete';
  nickname?: string;
} | {
  status: 'imported';
  uid?: string;
  nickname?: string;
} | {
  status: 'signed-out';
} | {
  status: 'failed';
  message: string;
};
//#endregion
//#region src/login-route.d.ts
/** Constructor dependencies. */
interface WorkBuddyLoginRouteOptions {
  /**
   * Start an attempt for this variant's realm.
   *
   * @returns the state to poll and the URL the human must open.
   */
  begin: () => Promise<{
    state: string;
    url: string;
  }>;
  /**
   * Poll one attempt. Resolving to a completed credential means it has already
   * been persisted; the route never sees token material.
   *
   * @param state - the attempt to poll.
   */
  poll: (state: string) => Promise<WorkBuddyWebLoginResult>;
  /** Remove the stored credential. */
  logout: () => Promise<void>;
  /**
   * Adopt a credential document the user supplied.
   *
   * @param document - the document's text, exactly as the browser read it.
   * @returns a summary of the adopted credential, without its secrets.
   */
  importDocument: (document: string) => Promise<{
    uid?: string;
    nickname?: string;
  }>;
  /**
   * Route path to mount. Defaults to the CN variant's path so existing callers
   * and tests keep their behaviour; the international variant passes its own.
   */
  path?: string;
}
/**
 * The sign-in route's handler, extracted so tests can mount it on a bare server
 * with a known key.
 *
 * @param deps - the login operations for one variant.
 * @param key - the in-process control key this route requires.
 * @returns the Node request handler.
 */
declare function workBuddyLoginHandler(deps: WorkBuddyLoginRouteOptions, key: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** Mint the per-process sign-in control key. */
declare function createLoginKey(): string;
/** Mount the POST sign-in route on an optional webServer context. */
declare function registerWorkBuddyLoginRoute(ctx: Context, deps: WorkBuddyLoginRouteOptions, key: string): void;
//#endregion
//#region src/checkin-scheduler.d.ts
interface VariantCheckInTarget {
  variantId: string;
  client: WorkBuddyUpstreamClient;
  getCredential: () => Promise<WorkBuddyCredential | undefined>;
  onClaimed?: () => void;
}
interface CheckInLogItem {
  id: string;
  date: string;
  timestamp: number;
  status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error';
  amount?: number | undefined;
  message?: string | undefined;
}
interface CheckInRecord {
  lastDate: string;
  lastAt: number;
  status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error';
  amount?: number | undefined;
  message?: string | undefined;
  logs?: CheckInLogItem[] | undefined;
}
interface CheckInStatusStore {
  read(variantId: string): CheckInRecord | undefined;
  write(variantId: string, record: CheckInRecord): void;
  clearLogs(variantId: string): void;
}
declare class JsonFileCheckInStore implements CheckInStatusStore {
  private readonly filePath;
  constructor(filePath?: string);
  private readAll;
  read(variantId: string): CheckInRecord | undefined;
  clearLogs(variantId: string): void;
  write(variantId: string, record: CheckInRecord): void;
}
/**
 * Returns the current date in YYYY-MM-DD standardized on UTC+8 (Beijing Time).
 */
declare function getUtc8DateString(nowMs?: number): string;
/**
 * Calculates milliseconds until the next 10:00:05 AM in UTC+8.
 */
declare function msUntilNext10amUtc8(nowMs?: number): number;
interface CheckInSchedulerOptions {
  targets: VariantCheckInTarget[];
  isEnabled: (variantId: string) => boolean;
  store?: CheckInStatusStore | undefined;
}
declare class CheckInScheduler {
  private readonly targets;
  private readonly isEnabled;
  private readonly store;
  private timer;
  private isDisposed;
  constructor(options: CheckInSchedulerOptions);
  start(): void;
  private scheduleNext;
  executeOnce(): Promise<void>;
  dispose(): void;
}
//#endregion
//#region src/host-heartbeat.d.ts
/**
 * Host-side heartbeat: a small JSON file written under `$DSH_HOME` once the
 * `workbuddy` provider is registered. The status CLI reads it to report
 * whether the host bundle is alive, independent of the browser card.
 *
 * The browser (client) bundle cannot write files; its health is reported
 * only through `console.error` on failure (see `src/client/index.tsx`).
 * This asymmetry is intentional: the host is the load-bearing half, and
 * a missing heartbeat unambiguously means the host never started.
 *
 * @module dsh-workbuddy-connect/host-heartbeat
 */
/** Basename of the host heartbeat file inside the plugin's config directory. */
declare const WORKBUDDY_HOST_HEARTBEAT_FILENAME = ".workbuddy-host-heartbeat.json";
/** Current on-disk heartbeat format; readers reject others. */
declare const HEARTBEAT_FORMAT_VERSION = 1;
/** On-disk shape of the heartbeat. */
interface WorkBuddyHostHeartbeat {
  version: typeof HEARTBEAT_FORMAT_VERSION;
  package: 'dsh-workbuddy-connect';
  pluginVersion: string;
  /** Epoch milliseconds when the host registered the provider. */
  registeredAt: number;
  /** Host process PID, to distinguish a stale heartbeat after a crash. */
  pid: number;
}
/** Absolute path of the host heartbeat file. */
declare function workbuddyHostHeartbeatPath(): string;
/** Remove the heartbeat on plugin disposal so a stale file does not linger. */
declare function clearHostHeartbeat(): Promise<void>;
/** Read and validate the heartbeat; returns `undefined` when absent or malformed. */
declare function readHostHeartbeat(): Promise<WorkBuddyHostHeartbeat | undefined>;
/**
 * Absolute start time (epoch ms) of the process holding `pid`, or `undefined`
 * when it cannot be determined (no such PID, platform lacks a readable source).
 *
 * - macOS / Linux: `ps -o lstart=` prints a local-time "EEE MMM DD HH:MM:SS YYYY";
 *   `Date.parse` resolves it against the local clock, which matches how
 *   `registeredAt` (a `Date.now()` absolute value) is expressed.
 * - Windows: WMI `CreationDate` is UTC (`YYYYMMDDHHMMSS.mmm+zzzz`); parsed with
 *   `Date.UTC`, again comparable to `registeredAt`.
 *
 * Failures return `undefined` so callers can fall back to plain PID liveness
 * rather than mis-report a running host as dead.
 */
declare function processStartTimeMs(pid: number): number | undefined;
/**
 * Whether the heartbeat's PID is still alive *and* still the same process that
 * registered it. A stale heartbeat (host crashed without clearing the file)
 * is distinguished from a live host by two checks:
 *
 * 1. `process.kill(pid, 0)` — the PID exists (signal 0 tests existence).
 * 2. The process holding that PID started at or before `registeredAt`. A host
 *    that registered the heartbeat must have been started before writing it,
 *    so `start <= registeredAt`; a recycled PID belongs to an unrelated process
 *    started after the host died, so `start > registeredAt` correctly reads dead.
 *
 * PID-only detection is not enough: after a crash the OS may hand the same PID
 * to an unrelated process, and the un-cleared stale heartbeat would otherwise
 * produce a false "Host running". When the process start time cannot be read
 * (e.g. unsupported platform) the check degrades to plain PID liveness.
 */
declare function isHeartbeatProcessAlive(heartbeat: WorkBuddyHostHeartbeat): boolean;
//#endregion
//#region src/index.d.ts
/** Stable Cordis plugin name. */
declare const name = "llm-workbuddy";
/** The model registry required before the provider can register. */
declare const inject: string[];
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
declare const WORKBUDDY_SETTINGS_NS: SettingsNamespace;
/**
 * Settings namespace owning the international card's section.
 *
 * One namespace per card, not one shared: the settings Plugins tab dispatches a
 * card by rendering `settings.plugin.item` with `entryKey = ns` for each
 * namespace the Host serves, and skips an entry whose key names no served
 * namespace. With a single installed section, the international card registers
 * into the slot but is never rendered — the card list is built from the Host's
 * sections, not from the slot's entries. Each card therefore needs its own
 * installed section whose namespace equals the card's slot key.
 */
declare const WORKBUDDY_AI_SETTINGS_NS: SettingsNamespace;
/**
 * Settings namespace owning the shared quota-card section.
 *
 * One card above the two variant cards configures both sidebar quota widgets
 * (CN and international) from a single place, so its toggles cannot live in
 * either variant's section — they are per-variant fields on a cross-variant
 * card. The Plugins tab dispatches by namespace, so this section is what makes
 * that card render (see {@link WORKBUDDY_AI_SETTINGS_NS} for the mechanism).
 */
declare const WORKBUDDY_QUOTA_SETTINGS_NS: SettingsNamespace;
/** Plugin configuration. */
interface Config {
  /**
   * Whether the user has authorized sending probe requests about reasoning
   * efforts. Off by default: a probe spends real credit, so nothing is sent
   * until the user explicitly agrees.
   */
  probeConsent?: boolean;
  /** Use the largest context window the international catalog explicitly offers. */
  useMaximumContextWindow?: boolean;
  /** Show the CN variant's sidebar quota card. */
  sidebarQuotaCN?: boolean;
  /** Show the international variant's sidebar quota card. */
  sidebarQuotaAI?: boolean;
  /** Automatically check in daily for the CN variant. */
  autoCheckInCN?: boolean;
  /** Automatically check in daily for the international variant. */
  autoCheckInAI?: boolean;
  /**
   * Sidebar quota refresh interval in milliseconds. One shared value (both
   * cards poll on it) because the two widgets hit the same rate-limited
   * upstream family; the floor guards against a typo hammering the billing
   * endpoint, which serves no cache.
   */
  quotaPollMs?: number;
}
/**
 * Quota poll interval: default 5 minutes, floor 1 minute. The status route
 * performs a live upstream billing call per request with no cache, so an
 * aggressively small interval translates directly into upstream load; the
 * floor is the smallest value the UI offers rather than a silent clamp —
 * smaller staged values fail Host validation and refuse to save.
 */
declare const QUOTA_POLL_DEFAULT_MS = 300000;
declare const QUOTA_POLL_MIN_MS = 60000;
declare const Config: z<Config>;
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
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { AI_VARIANT, type AppVersionInfo, CN_APP_VERSION_FILENAME, CN_VARIANT, type ChatIdentity, type CheckInLogItem, type CheckInRecord, CheckInScheduler, type CheckInSchedulerOptions, type CheckInStatusStore, Config, FALLBACK_CN_APP_VERSION, FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, JsonFileCheckInStore, LOGIN_PENDING_CODE, PROBE_EFFORT_CANDIDATES, type ProbeAttempt, type ProbeOutcome, type ProbeSender, QUOTA_POLL_DEFAULT_MS, QUOTA_POLL_MIN_MS, type ResolveChatIdentityOptions, type UpstreamErrorKind, type VariantCheckInTarget, WORKBUDDY_AI_LOGIN_PATH, WORKBUDDY_AI_SETTINGS_NS, WORKBUDDY_APP_VERSION_FILENAME, WORKBUDDY_AUTH_FILENAME, WORKBUDDY_CATALOG_FILENAME, WORKBUDDY_CREDENTIAL_SOURCE, WORKBUDDY_DATA_DIR_ENV, WORKBUDDY_DATA_DIR_NAME, WORKBUDDY_HOST_HEARTBEAT_FILENAME, WORKBUDDY_LOGIN_PATH, WORKBUDDY_PROBE_FILENAME, WORKBUDDY_PROVIDER, WORKBUDDY_QUOTA_SETTINGS_NS, WORKBUDDY_SETTINGS_NS, WORKBUDDY_STREAM_IDLE_TIMEOUT_MS, WORKBUDDY_VARIANTS, type WorkBuddyAdapter, type WorkBuddyAppVersionSource, type WorkBuddyAuthStatus, WorkBuddyCatalog, type WorkBuddyCatalogFetch, WorkBuddyCatalogStore, type WorkBuddyChatResult, type WorkBuddyCheckinClaim, type WorkBuddyCheckinStatus, type WorkBuddyCredential, WorkBuddyCredentialStore, type WorkBuddyCredits, type WorkBuddyEffort, type WorkBuddyHostHeartbeat, type WorkBuddyLoginAccount, type WorkBuddyLoginAttempt, WorkBuddyLoginClient, type WorkBuddyLoginPoll, type WorkBuddyLoginRouteOptions, type WorkBuddyLoginTokens, type WorkBuddyModelBilling, type WorkBuddyModelInfo, type WorkBuddyModelReasoning, type WorkBuddyProbeRecord, WorkBuddyProbeService, type WorkBuddyProbeStatus, WorkBuddyProbeStore, type WorkBuddyProbeValidation, type WorkBuddyPromotion, type WorkBuddyRefreshOutcome, type WorkBuddyShim, WorkBuddyUpstreamClient, type WorkBuddyUpstreamModel, type WorkBuddyVariant, type WorkBuddyWebLoginAction, type WorkBuddyWebLoginRequest, type WorkBuddyWebLoginResult, appUserAgent, apply, chatUserAgent, classifyUpstreamError, clearHostHeartbeat, createLoginKey, createWorkBuddyAdapter, createWorkBuddyShim, fallbackChatIdentity, fingerprintModel, getUtc8DateString, inject, installedAppVersion, isHeartbeatProcessAlive, modelWithCurrentPromotion, msUntilNext10amUtc8, name, normalizeCredits, normalizeLoginRegion, parseModelCatalog, parseWorkBuddyAuth, prepareChatBody, prepareInternationalChatBody, probeModel, processStartTimeMs, randomSentinel, readBundleVersion, readCliVersion, readHostHeartbeat, regionOf, registerWorkBuddyLoginRoute, resolveAppVersion, resolveChatIdentity, resolveLoginRegion, validAppVersion, validCliVersion, variantFor, workBuddyLoginHandler, workbuddyCatalogPath, workbuddyHostHeartbeatPath, workbuddyOwnAuthPath, workbuddyPluginDataDir, workbuddyProbePath };