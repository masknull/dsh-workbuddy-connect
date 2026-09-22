/**
 * The shared quota-settings card: one card above the two variant cards that
 * configures both sidebar quota widgets.
 *
 * Like the built-in plugin cards, it registers into `settings.plugin.item`
 * keyed by its own settings namespace (`workbuddy-quota`), binds that
 * namespace through the client settings scope, and writes through the scope's
 * revision-fenced `set` — the same durable-write path every preference row
 * uses. A toggle commits on click: each click is one explicit user choice,
 * and the scope's ordering makes the last one win, so no staged-draft form is
 * needed for two booleans and a number.
 *
 * The two toggles gate the CN and international sidebar cards respectively;
 * the interval is one shared poll period. Toggles are disabled while their
 * variant is signed out: a quota card for an account nobody is signed into
 * would render an error forever, so the setting waits for a session.
 */

import { useSyncExternalStore, useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { WorkBuddySettingsKey } from './locales.ts'
import { isWorkBuddyWebStatus } from './status-document.ts'
import { noteQuotaSignIn, onQuotaSettingsChange, quotaSignInState, quotaStatus, variantOfStatusPath } from './quota-settings-store.ts'
import { WORKBUDDY_AI_STATUS_PATH, WORKBUDDY_STATUS_PATH } from '../status-paths.ts'

/** Everything the registration binds into the card. */
export interface QuotaSettingsCardInjected {
  /** Translator bound to the settings namespace. */
  t: (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string
  /**
   * Sign-in state per variant; a toggle is disabled when its variant is out.
   *
   * Optional: the unified card owns the store subscription itself and passes
   * this only when it has a state to report. When absent, the content derives
   * sign-in from the shared store and its own probe — never from a default
   * that would claim the user is signed in.
   */
  signedIn?: (() => { cn: boolean; ai: boolean }) | undefined
  /** The bound scope over the `workbuddy-quota` namespace, when available. */
  scope?: SettingsScope<QuotaSection> | undefined
}

/** The section this card edits (mirrors the host-side QUOTA_SECTION). */
export interface QuotaSection {
  sidebarQuotaCN?: boolean
  sidebarQuotaAI?: boolean
  autoCheckInCN?: boolean
  autoCheckInAI?: boolean
  quotaPollMs?: number
}

export type QuotaSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & Partial<QuotaSettingsCardInjected>

/** The settings fields this card edits, in display order. */
const FIELDS = ['sidebarQuotaCN', 'sidebarQuotaAI', 'autoCheckInCN', 'autoCheckInAI', 'quotaPollMs'] as const
type Field = (typeof FIELDS)[number]

/** The default poll interval shown before a value is stored. */
const POLL_DEFAULT_MS = 300_000
/** Floor the schema also enforces; mirrored here for immediate UI feedback. */
const POLL_MIN_MS = 60_000

/** Projection the card component reads. */
interface QuotaSettingsProjection {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  values: {
    sidebarQuotaCN: boolean
    sidebarQuotaAI: boolean
    autoCheckInCN: boolean
    autoCheckInAI: boolean
    quotaPollMs: number
  }
}

/** Read the section values out of a scope snapshot (defaults when absent). */
function project(scope: SettingsScope<QuotaSection> | undefined): QuotaSettingsProjection {
  if (scope === undefined) {
    return {
      status: 'unavailable',
      writable: false,
      values: {
        sidebarQuotaCN: false,
        sidebarQuotaAI: false,
        autoCheckInCN: false,
        autoCheckInAI: false,
        quotaPollMs: POLL_DEFAULT_MS,
      },
    }
  }
  const snapshot = scope.getSnapshot()
  const value = snapshot.value ?? {}
  return {
    status: snapshot.status,
    writable: snapshot.writable,
    values: {
      sidebarQuotaCN: value.sidebarQuotaCN === true,
      sidebarQuotaAI: value.sidebarQuotaAI === true,
      autoCheckInCN: value.autoCheckInCN === true,
      autoCheckInAI: value.autoCheckInAI === true,
      quotaPollMs: typeof value.quotaPollMs === 'number' ? value.quotaPollMs : POLL_DEFAULT_MS,
    },
  }
}

/**
 * Stable-reference projection cache.
 *
 * React's useSyncExternalStore requires getSnapshot() to return THE SAME
 * reference between renders unless the store actually changed. project()
 * builds a fresh object every call, which re-renders forever and crashes the
 * card with React error #185 ("maximum update depth exceeded") — exactly the
 * crash the slot ledger reported. The cache below compares the projection
 * FIELD BY FIELD and keeps the previous object unless a value actually moved,
 * so a scope handed a fresh-but-equal snapshot object every read (which a test
 * double does, and a normalizing host may too) cannot spin the card.
 */
let cachedScope: SettingsScope<QuotaSection> | undefined
let cachedProjection: QuotaSettingsProjection | undefined
const UNAVAILABLE: QuotaSettingsProjection = {
  status: 'unavailable',
  writable: false,
  values: {
    sidebarQuotaCN: false,
    sidebarQuotaAI: false,
    autoCheckInCN: false,
    autoCheckInAI: false,
    quotaPollMs: POLL_DEFAULT_MS,
  },
}

function stableProject(scope: SettingsScope<QuotaSection> | undefined): QuotaSettingsProjection {
  if (scope === undefined) return UNAVAILABLE
  const next = project(scope)
  if (
    cachedProjection === undefined ||
    cachedScope !== scope ||
    cachedProjection.status !== next.status ||
    cachedProjection.writable !== next.writable ||
    cachedProjection.values.sidebarQuotaCN !== next.values.sidebarQuotaCN ||
    cachedProjection.values.sidebarQuotaAI !== next.values.sidebarQuotaAI ||
    cachedProjection.values.autoCheckInCN !== next.values.autoCheckInCN ||
    cachedProjection.values.autoCheckInAI !== next.values.autoCheckInAI ||
    cachedProjection.values.quotaPollMs !== next.values.quotaPollMs
  ) {
    cachedScope = scope
    cachedProjection = next
  }
  return cachedProjection
}

/** One toggle row: label, hint, and a switch drawn to the shell's proportions. */
function ToggleRow({ label, hint, checked, disabled, disabledHint, onToggle }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  disabledHint?: string
  onToggle: (next: boolean) => void
}): React.ReactNode {
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={hintStyle}>{disabled === true && disabledHint !== undefined ? disabledHint : hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        aria-label={label}
        onClick={() => {
          // Defense in depth: a disabled switch must never reach the write, even
          // when a caller invokes the handler directly (an older browser, or a
          // test driving props.onClick). The gate lives in the handler, not only
          // in the `disabled` attribute.
          if (disabled) return
          onToggle(!checked)
        }}
        style={{
          ...switchStyle,
          background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.2))',
          justifyContent: checked ? 'flex-end' : 'flex-start',
          opacity: disabled === true ? 0.45 : 1,
          cursor: disabled === true ? 'not-allowed' : 'pointer',
        }}
      >
        <span style={knobStyle} />
      </button>
    </div>
  )
}

/**
 * The quota-settings controls on their own, with no card chrome.
 *
 * This is the half the unified WorkBuddy card embeds at the top of its body.
 * It owns its subscriptions: the scope projection (which values are saved) and
 * the shared sign-in store (which variant has a session), so a toggle
 * re-gates the moment a poll anywhere lands a document — no remount, and no
 * prop-drilling through the slot injection.
 */
export function QuotaSettingsContent({ t = key => key, scope, signedIn }: QuotaSettingsCardInjected): React.ReactNode {
  const subscribe = useCallback((onStoreChange: () => void) => {
    return scope?.subscribe(onStoreChange) ?? (() => {})
  }, [scope])
  const projection = useSyncExternalStore(subscribe, () => stableProject(scope))
  const liveSignIn = useSyncExternalStore(onQuotaSettingsChange, quotaSignInState)
  // The toggles gate on sign-in, but the sidebar cards' polls do not run while
  // both are OFF — so this content probes both status routes itself, once at
  // mount. It is the same document the variant cards render; no credential ever
  // reaches the browser.
  const [probe, setProbe] = useState<{ cn: boolean; ai: boolean }>()
  useEffect(() => {
    let disposed = false
    const probeOne = async (path: string): Promise<boolean | undefined> => {
      try {
        const response = await fetch(path, { headers: { accept: 'application/json' } })
        const body: unknown = await response.json()
        if (disposed || !isWorkBuddyWebStatus(body)) return undefined
        noteQuotaSignIn(variantOfStatusPath(path), body.status === 'signed-in')
        return body.status === 'signed-in'
      } catch {
        return undefined
      }
    }
    void (async () => {
      const [cn, ai] = await Promise.all([probeOne(WORKBUDDY_STATUS_PATH), probeOne(WORKBUDDY_AI_STATUS_PATH)])
      if (!disposed) setProbe({ cn: cn === true, ai: ai === true })
    })()
    return () => {
      disposed = true
    }
  }, [])

  if (projection.status === 'unavailable') return null
  const reported = signedIn?.()

  /**
   * Whether one variant has a usable session, decided by whoever can best tell.
   *
   * An explicit `signedIn` reader (what the unified card passes once it has a
   * poll's answer) is authoritative. Otherwise — and that is the case this
   * exists for — a stale optimistic `true` in the store must never be enough:
   * the shared store may hold a sign-in fact from a document that has since
   * been replaced by a signed-out one. So the CURRENT document is consulted,
   * and a document saying `signed-out` closes the toggle regardless of what
   * any cached flag says.
   */
  const deriveSigned = (variant: 'cn' | 'ai', variantId: 'workbuddy' | 'workbuddy-ai'): boolean => {
    if (reported !== undefined) return Boolean(reported[variant])
    const currentStatus = quotaStatus(variantId)
    if (currentStatus?.status === 'signed-out') return false
    const live = liveSignIn[variant]
    if (probe !== undefined) {
      const probeResult = probe[variant]
      if (!probeResult) return Boolean(live && currentStatus?.status === 'signed-in')
      return Boolean(live)
    }
    return Boolean(live && currentStatus?.status === 'signed-in')
  }

  const signed = {
    cn: deriveSigned('cn', 'workbuddy'),
    ai: deriveSigned('ai', 'workbuddy-ai'),
  }
  const write = (field: Field, value: boolean | number): void => {
    // Defense in depth against enabling features of an account nobody
    // is signed into: the switch already reads `disabled`, and its handler
    // already returns early — this is the third gate, at the write itself, so
    // no call path (including a direct onToggle(true)) can persist it.
    if (field === 'sidebarQuotaCN' && value === true && !signed.cn) return
    if (field === 'sidebarQuotaAI' && value === true && !signed.ai) return
    if (field === 'autoCheckInCN' && value === true && !signed.cn) return
    if (field === 'autoCheckInAI' && value === true && !signed.ai) return
    void scope?.set(field, value)
  }
  const minutes = Math.max(POLL_MIN_MS / 60_000, Math.round(projection.values.quotaPollMs / 60_000))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ToggleRow
        label={t('quotaToggleCN')}
        hint={t('quotaToggleHint')}
        checked={projection.values.sidebarQuotaCN}
        disabled={!signed.cn}
        disabledHint={t('quotaSignInRequired')}
        onToggle={next => write('sidebarQuotaCN', next)}
      />
      <ToggleRow
        label={t('quotaToggleAI')}
        hint={t('quotaToggleHint')}
        checked={projection.values.sidebarQuotaAI}
        disabled={!signed.ai}
        disabledHint={t('quotaSignInRequired')}
        onToggle={next => write('sidebarQuotaAI', next)}
      />
      <ToggleRow
        label={t('quotaAutoCheckInCN')}
        hint={t('quotaAutoCheckInCNHint')}
        checked={projection.values.autoCheckInCN}
        disabled={!signed.cn}
        disabledHint={t('quotaSignInRequired')}
        onToggle={next => write('autoCheckInCN', next)}
      />
      <ToggleRow
        label={t('quotaAutoCheckInAI')}
        hint={t('quotaAutoCheckInAIHint')}
        checked={projection.values.autoCheckInAI}
        disabled={!signed.ai}
        disabledHint={t('quotaSignInRequired')}
        onToggle={next => write('autoCheckInAI', next)}
      />
      <div style={{ ...rowStyle, borderBottom: 'none', paddingBottom: 0 }}>
        <div style={rowTextStyle}>
          <span style={labelStyle}>{t('quotaPollLabel')}</span>
          <span style={hintStyle}>{t('quotaPollHint')}</span>
        </div>
        <span style={pollFieldStyle}>
          <input
            type="number"
            min={POLL_MIN_MS / 60_000}
            step={1}
            value={minutes}
            aria-label={t('quotaPollLabel')}
            onChange={event => {
              const mins = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(mins) && mins > 0) write('quotaPollMs', Math.max(POLL_MIN_MS, mins * 60_000))
            }}
            style={inputStyle}
          />
          <span style={hintStyle}>{t('quotaPollUnit')}</span>
        </span>
      </div>
      {projection.writable === false ? <span style={hintStyle}>{t('quotaSettingsSaveFailed')}</span> : null}
    </div>
  )
}

/** The standalone shared quota-settings card (kept for a non-unified host). */
export function QuotaSettingsCard(props: QuotaSettingsCardProps): React.ReactNode {
  const { t = key => key, scope, signedIn } = props
  const subscribe = useCallback((onStoreChange: () => void) => {
    return scope?.subscribe(onStoreChange) ?? (() => {})
  }, [scope])
  const projection = useSyncExternalStore(subscribe, () => stableProject(scope))
  // Collapsed by default — matching the variant card's disclosure shape — with
  // the header as the toggle. Open state stays local: it is a view preference,
  // not a setting worth persisting.
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [headerFocused, setHeaderFocused] = useState(false)

  if (projection.status === 'unavailable') return null
  return (
    // The Plugins tab renders its card list as <ul><li>: the variant cards are
    // <li>s, and the measured DOM showed this card's <section> sitting in the
    // same <ul> with NO list-item geometry — which is exactly the misaligned,
    // framed-out-of-line look the user reported three times. The root element
    // is an <li> like every sibling, with the variant cards' exact style set
    // (cardStyle / cardHoverStyle / cardOpenStyle are verbatim copies of
    // WorkBuddyPluginCard's).
    <li
      style={{ ...cardStyle, ...(hovered ? cardHoverStyle : {}), ...(open ? cardOpenStyle : {}) }}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('quotaSettingsTitle')}`}
        onClick={() => setOpen(o => !o)}
        onFocus={event => {
          let keyboard = true
          try {
            keyboard = event.currentTarget.matches(':focus-visible')
          } catch {
            keyboard = true
          }
          if (keyboard) setHeaderFocused(true)
        }}
        onBlur={() => { setHeaderFocused(false) }}
        style={{ ...headerButtonStyle, ...(headerFocused ? headerFocusStyle : {}) }}
      >
        <span style={headTextStyle}>
          <span style={titleStyle}>{t('quotaSettingsTitle')}</span>
          <span style={introStyle}>{t('quotaSettingsIntro')}</span>
        </span>
        <span style={{ ...chevronStyle, transform: open ? 'rotate(180deg)' : 'none' }}>
          <ChevronDownIcon />
        </span>
      </button>
      {open ? (
        <div style={cardBodyStyle}>
          <QuotaSettingsContent t={t} scope={scope} signedIn={signedIn} />
        </div>
      ) : null}
    </li>
  )
}

/** The disclosure chevron, drawn from the same path data as the variant cards'. */
function ChevronDownIcon(): React.ReactNode {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/* ---- styles: verbatim copies of WorkBuddyPluginCard's card constants ---- */

const cardStyle: CSSProperties = {
  listStyle: 'none',
  // Border as longhands, never the shorthand (the variant card's comment
  // explains why: React's style-diff clear breaks shorthands).
  borderWidth: '0.5px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l4)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
}
/** Hover, matching the built-in card's `:hover` (inline styles cannot express pseudo-classes). */
const cardHoverStyle: CSSProperties = { borderColor: 'var(--dsw-alias-label-dimmed)' }
/** Expanded, matching the built-in card's open state. */
const cardOpenStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2)',
  borderColor: 'var(--dsw-alias-label-dimmed)',
}
const headerButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  border: 0,
  borderRadius: 12,
  padding: '14px 16px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  // The built-in header declares this too; without it a native button can
  // paint its own chrome on top of the transparent background.
  appearance: 'none',
}
const headerFocusStyle: CSSProperties = { outline: '2px solid var(--dsw-alias-brand-primary)', outlineOffset: -2 }
const headTextStyle: CSSProperties = { display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 4 }
const titleStyle: CSSProperties = { fontSize: 15, lineHeight: 1.4, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const introStyle: CSSProperties = { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
/** The variant cards' chevron rule. */
const chevronStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  color: 'var(--dsw-alias-label-tertiary)',
  transition: 'transform .16s',
}
/** The variant cards' body: hairline top border, inset margins, no extra box. */
const cardBodyStyle: CSSProperties = {
  borderTop: '.5px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  padding: '12px 0 8px',
}
/**
 * One settings row: NO box of its own (the bordered rows read as nested
 * cards, which the user ruled against) — rows are separated by a hairline
 * bottom rule like the settings shell's own preference lists.
 */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  borderBottom: '.5px solid var(--dsw-alias-border-l2)',
  paddingBottom: 10,
}
const rowTextStyle: CSSProperties = { display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 2 }
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }
const hintStyle: CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
const switchStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  width: 36,
  height: 20,
  borderRadius: 10,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l2)',
  padding: 1,
  cursor: 'pointer',
  alignItems: 'center',
  transition: 'background .16s',
}
const knobStyle: CSSProperties = { display: 'block', width: 16, height: 16, borderRadius: '50%', background: 'var(--dsw-alias-bg-layer-1, #fff)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }
const pollFieldStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: 55,
  padding: '5px 8px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  textAlign: 'right',
}
