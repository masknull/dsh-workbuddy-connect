/** WorkBuddy status card contributed to Harness Plugin configuration. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { WORKBUDDY_AI_LOGIN_PATH, WORKBUDDY_AI_PROBE_PATH, WORKBUDDY_AI_STATUS_PATH, WORKBUDDY_LOGIN_PATH, WORKBUDDY_PROBE_PATH, WORKBUDDY_STATUS_PATH } from '../status-paths.ts'
import type { WorkBuddyWebModelBadge, WorkBuddyWebProbeSection, WorkBuddyWebStatus } from '../status-paths.ts'
import { isWorkBuddyWebStatus } from './status-document.ts'
import type { WorkBuddySettingsKey } from './locales.ts'
import { QuotaSettingsContent } from './QuotaSettingsCard.tsx'
import type { QuotaSection } from './QuotaSettingsCard.tsx'
import {
  noteQuotaSignIn,
  noteQuotaStatus,
  onQuotaSettingsChange,
  quotaSignInState,
} from './quota-settings-store.ts'

/** The two variant ids the unified card switches between. */
type WorkBuddyVariantId = 'workbuddy' | 'workbuddy-ai'

/** Localized copy injected by the browser-plugin registration. */
export interface WorkBuddyPluginCardInjected {
  t: (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string
  /**
   * Which product variant this card instance renders.
   *
   * Both cards share this component; the variant selects the status/probe/login
   * routes and the title/intro copy. Defaults to the CN variant so a card
   * rendered without the injection keeps working. Ignored in unified mode,
   * where the reader picks the variant with the segmented tab switcher.
   */
  variant?: WorkBuddyCardVariant
  /** The bound scope over the `workbuddy-quota` namespace, when available. */
  scope?: SettingsScope<QuotaSection> | undefined
  /** Sign-in state per variant; a toggle is disabled when its variant is out. */
  signedIn?: (() => { cn: boolean; ai: boolean }) | undefined
  /**
   * Whether to render as the unified WorkBuddy card: the sidebar quota
   * settings merged in at the top, then one segmented tab per variant
   * (国内版 / 国际版) replacing the two separate cards.
   */
  unified?: boolean
}

/** The browser-visible half of a variant: identity, routes, and copy keys. */
export interface WorkBuddyCardVariant {
  id: string
  /** Locale key for the card title. */
  titleKey: WorkBuddySettingsKey
  /** Locale key for the card intro line. */
  introKey: WorkBuddySettingsKey
  /** Locale key for the not-signed-in hint. */
  signedOutKey: WorkBuddySettingsKey
  statusPath: string
  probePath: string
  loginPath: string
}

/** CN WorkBuddy; the plugin's long-standing card and default. */
export const CN_CARD_VARIANT: WorkBuddyCardVariant = {
  id: 'workbuddy',
  titleKey: 'title',
  introKey: 'intro',
  signedOutKey: 'signedOutHint',
  statusPath: WORKBUDDY_STATUS_PATH,
  probePath: WORKBUDDY_PROBE_PATH,
  loginPath: WORKBUDDY_LOGIN_PATH,
}

/** International WorkBuddy AI. */
export const AI_CARD_VARIANT: WorkBuddyCardVariant = {
  id: 'workbuddy-ai',
  titleKey: 'titleAI',
  introKey: 'introAI',
  signedOutKey: 'signedOutHintAI',
  statusPath: WORKBUDDY_AI_STATUS_PATH,
  probePath: WORKBUDDY_AI_PROBE_PATH,
  loginPath: WORKBUDDY_AI_LOGIN_PATH,
}

/** Both cards, in display order. */
export const CARD_VARIANTS: readonly WorkBuddyCardVariant[] = [CN_CARD_VARIANT, AI_CARD_VARIANT]
/** Props delivered by the Plugin configuration item slot. */
export type WorkBuddyPluginCardProps =
  PropsRuntime<'settings.plugin.item'>
  & Partial<WorkBuddyPluginCardInjected>

const POLL_INTERVAL_MS = 60_000

/*
 * Styling mirrors the Settings panel's own plugin card (`.YyYd_a_card` in the
 * client bundle) rather than inventing a look: the same tokens, the same
 * geometry, and the same hover/open treatment. The values here are that rule's
 * values, so a card from this plugin sits in the list beside a built-in one
 * without reading as a different kind of object.
 */
const cardStyle: CSSProperties = {
  listStyle: 'none',
  /*
   * Border as longhands, never the `border` shorthand.
   *
   * The hover and open states below override the colour, and React applies an
   * override by assigning the property and clearing it by assigning `''`. That
   * clear is what breaks a shorthand: the shorthand was expanded by the CSSOM
   * into longhands, React then considers `border` unchanged and never re-applies
   * it, and clearing `border-color` leaves the whole border unset — so it falls
   * back to `currentColor` and the card grows a near-black outline. Declaring the
   * three longhands keeps the colour always present in the style object, so React
   * assigns a value on every render instead of ever clearing one.
   */
  borderWidth: '0.5px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l4)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
}
/** Hover, matching the built-in card's `:hover`. Inline styles cannot express a pseudo-class. */
const cardHoverStyle: CSSProperties = { borderColor: 'var(--dsw-alias-label-dimmed)' }
/** Expanded, matching the built-in card's open state. */
const cardOpenStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2)',
  borderColor: 'var(--dsw-alias-label-dimmed)',
}
const headerStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  // Longhands, as on the card itself: the focus ring below is added and
  // removed by spreading overrides over this object, and clearing the shorthand
  // `border: 0` the same way lets the native button repaint its own chrome.
  borderWidth: 0,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 12,
  padding: '14px 16px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  // The built-in header declares this too; without it a native button can paint
  // its own chrome on top of the transparent background.
  appearance: 'none',
}
/**
 * The built-in header's keyboard focus ring.
 *
 * `:focus-visible` is what makes the ring appear for keyboard navigation but not
 * for a mouse click, and an inline style cannot express a pseudo-class — so the
 * component tracks it and applies this instead. Without it the header falls back
 * to the browser's own outline, which is the black box that used to appear on
 * focus where the built-in card shows a brand-coloured ring.
 */
const headerFocusStyle: CSSProperties = {
  outline: '2px solid var(--dsw-alias-brand-primary)',
  outlineOffset: -2,
}
const headTextStyle: CSSProperties = { display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 4 }
const nameStyle: CSSProperties = { fontSize: 15, lineHeight: 1.4, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const descriptionStyle: CSSProperties = { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
/**
 * The disclosure chevron, drawn to match the Settings panel's own card.
 *
 * The built-in card renders `IconChevronDownOutline14` from the client's shared
 * icon catalog, which the shell seeds into the module table. This plugin does
 * not request that catalog, so the same outline is drawn here from the same path
 * data: the text `⌄` glyph this replaces had a different shape, weight, and
 * baseline from the icon the cards beside it use.
 */
function ChevronDownIcon(): ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** The built-in card's chevron rule: tertiary color, and only the rotation animates. */
const chevronStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  color: 'var(--dsw-alias-label-tertiary)',
  transition: 'transform .16s',
}
const cardBodyStyle: CSSProperties = {
  borderTop: '.5px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  padding: '12px 0 8px',
}

const bodyStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }
const statusStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }
/** The built-in secondary button: transparent, hairline border, 8px radius. */
const buttonStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '5px 14px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  cursor: 'pointer',
}
const errorStyle: CSSProperties = { ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }
const quotaListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 2 }
const quotaGroupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const quotaTitleStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const quotaLabelStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' }
const modelBadgeStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const modelOfferStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
const modelRateStyle: CSSProperties = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }
const contextPreferenceStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  padding: '10px 12px',
  border: '.5px solid var(--dsw-alias-border-l4)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: 1.5,
}
const contextPreferenceCopyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
/** The right-hand cell of one context-window row: value and its note on one line. */
const contextPickerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
}
/**
 * The promotional badge chip: the theme's soft success tint for the fill and its
 * solid tone for the text. Both tokens exist in the shipped theme — the
 * `-subtle` spelling this used to carry does not, which silently fell back to a
 * hand-picked green and read as off-brand.
 */
const modelBadgeChipStyle: CSSProperties = {
  padding: '1px 8px', borderRadius: 999, fontSize: 11, lineHeight: '18px',
  background: 'var(--dsw-alias-state-success-tertiary)',
  color: 'var(--dsw-alias-state-success-primary)',
}

/**
 * Localize an upstream promotional badge label, with an unknown-badge fallback.
 *
 * The CN catalog spells badges in Chinese (`限时免费`, `夜间折扣`); the
 * international document's `modelPromotions` carries English (`Free now`). Both
 * are mapped so the same promotion reads consistently in either UI language,
 * and anything else passes through verbatim — an unrecognized badge is still
 * information the upstream chose to show.
 */
function modelBadgeLabel(badge: string, t: WorkBuddyPluginCardInjected['t']): string {
  if (badge === '限时免费') return t('badgeLimitedFree')
  if (badge === '夜间折扣') return t('badgeNightDiscount')
  if (badge === 'Free now') return t('badgeFreeNow')
  return badge
}
const progressTrackStyle: CSSProperties = {
  height: 10,
  overflow: 'hidden',
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.12))',
  border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2))',
  boxSizing: 'border-box',
}

/**
 * Inline confirmation box for a paid detection. Replaces the previous
 * `window.confirm`: the decision is one line plus two buttons, and a modal
 * alert for that is heavier than the action it guards.
 */
const confirmBoxStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const confirmRowStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }

/** One probeable model's row: name on the left, state and action on the right. */
const probeRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
const probeRowEndStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }

/**
 * Tab strip for the card body. Kept visually light — a full pill would compete
 * with the section headings, and the card is already the densest surface the
 * plugin owns.
 */
const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 4,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const tabStyle: CSSProperties = {
  padding: '6px 12px',
  border: 0,
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
}
const tabActiveStyle: CSSProperties = {
  borderBottom: '2px solid var(--dsw-alias-brand-primary)',
  color: 'var(--dsw-alias-label-primary)',
  fontWeight: 600,
}
const tabPanelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 16 }

/**
 * The unified card's variant switcher: a segmented control, not the tab strip
 * above it.
 *
 * It sits at the TOP of the card body and chooses WHICH account the rest of
 * the card shows, so it reads as a container switcher — an inset track with a
 * raised active segment — while the strip below stays a flat underline for
 * switching sections within one account. The tints are the theme's own layer
 * tokens, so the control matches the settings shell's other segmented picks.
 */
const segmentedContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'var(--dsw-alias-bg-layer-1, rgba(20, 20, 20, 0.6))',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))',
  borderRadius: 8,
  padding: 3,
  gap: 4,
  marginTop: 14,
  marginBottom: 16,
}

function segmentedTabItemStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 6,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: active ? 'var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.18))' : 'transparent',
    background: active ? 'var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.08))' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary, #fff)' : 'var(--dsw-alias-label-tertiary, #8c8c8c)',
    fontWeight: active ? 500 : 400,
    fontSize: 13,
    lineHeight: '18px',
    cursor: 'pointer',
    appearance: 'none',
    outline: 'none',
    transition: 'all .16s ease',
  }
}

/**
 * Primary action of the inline confirmation. Fill and text colour come from the
 * theme as a pair: `brand-primary` is a light accent here, so pairing it with a
 * hardcoded white would render white-on-white.
 */
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  // Longhands, never the `border` shorthand: the spread base declares a
  // shorthand, and overriding only `borderColor` through another shorthand
  // leaves the native button free to repaint its own chrome.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--dsw-alias-button-primary-fill)',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}

function progressFillStyle(percent: number): CSSProperties {
  return {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    height: '100%',
    borderRadius: 'inherit',
    background: 'var(--dsw-alias-brand-primary, #1677ff)',
  }
}

/**
 * Status dot colour. Takes `'loading'` as well as the document's own states:
 * before the first response the card knows nothing about the account, so it must
 * not borrow the signed-out grey — that would read as "nothing is wrong, nobody
 * is signed in" when the truth is "not read yet".
 */
function dotStyle(status: 'loading' | WorkBuddyWebStatus['status']): CSSProperties {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: color }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value)
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

function formatCycleReset(time: string): string {
  const parsed = Date.parse(time)
  if (!Number.isNaN(parsed)) return formatTime(parsed)
  return time
}

/**
 * One billing package as a labeled progress bar.
 *
 * A package whose allowance the upstream never reported (`size` not positive)
 * has no percentage to state. It must not fall back to 100%: the plugin would be
 * claiming a full quota it knows nothing about, which is the opposite of the
 * honest "remaining N" line printed below it. Unknown size therefore renders the
 * percent slot as unknown copy and an unfilled, indeterminate track.
 */
function CreditBar({ label, remain, size, unlimited, packageEndTime, t }: {
  label: string
  remain: number
  size: number
  unlimited?: boolean | undefined
  packageEndTime?: string | undefined
  t: WorkBuddyPluginCardInjected['t']
}): React.ReactNode {
  const expiryNode = packageEndTime === undefined
    ? null
    : <span style={modelRateStyle}>{t('quotaExpires')} {formatCycleReset(packageEndTime)}</span>
  if (unlimited === true) {
    const quotaText = t('unlimitedQuota')
    return (
      <div style={quotaGroupStyle}>
        <div style={quotaLabelStyle}>
          <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{label}</span>
          <span style={{ ...bodyStyle, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
            {t('quotaRemainStats', { remain: '∞' })}
          </span>
        </div>
        <div
          style={progressTrackStyle}
          role="progressbar"
          aria-label={label}
          aria-valuetext={quotaText}
        />
        <div style={rowStyle}>
          <span style={bodyStyle}>{quotaText}</span>
          {expiryNode}
        </div>
      </div>
    )
  }
  const sizeKnown = size > 0
  const isZeroQuota = size === 0 && remain === 0
  const used = Math.max(0, size - remain)
  const usedPercent = size > 0 ? Math.min(100, Math.max(0, Math.round((used / size) * 100))) : 0
  const leftText = sizeKnown
    ? `${formatNumber(used)} / ${formatNumber(size)} (${t('quotaUsedPercent', { percent: usedPercent })})`
    : isZeroQuota
      ? `0 / 0 (${t('quotaUsedPercent', { percent: 0 })})`
      : t('creditPackageUnknownSize', { remain: formatNumber(remain) })
  const rightText = sizeKnown || isZeroQuota
    ? t('quotaRemainStats', { remain: formatNumber(remain) })
    : t('percentUnknown')
  const indeterminate = !sizeKnown && !isZeroQuota
  return (
    <div style={quotaGroupStyle}>
      <div style={quotaLabelStyle}>
        <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{label}</span>
        <span style={{ ...bodyStyle, fontWeight: 500, color: remain > 0 ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)' }}>
          {rightText}
        </span>
      </div>
      <div
        style={progressTrackStyle}
        role="progressbar"
        aria-label={label}
        {...indeterminate
          ? { 'aria-valuetext': leftText }
          : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': usedPercent }}
      >
        {size > 0 && usedPercent > 0 ? <div style={progressFillStyle(usedPercent)} /> : null}
      </div>
      <div style={rowStyle}>
        <span style={bodyStyle}>{leftText}</span>
        {expiryNode}
      </div>
    </div>
  )
}

/**
 * One model offer row: name, promotional badges, and the billing rate.
 *
 * The rate sits under the name rather than beside it because the row already
 * spends its horizontal budget on badges; stacking keeps long model names and
 * several badges from squeezing the rate into an ellipsis.
 */
function ModelOfferRow({ model, t }: {
  model: WorkBuddyWebModelBadge
  t: WorkBuddyPluginCardInjected['t']
}): React.ReactNode {
  return (
    <div style={modelOfferStyle}>
      <div style={quotaLabelStyle}>
        <span>{model.name}</span>
        <span style={modelBadgeStyle}>
          {model.badges?.map(badge => (
            <span key={badge} style={modelBadgeChipStyle}>{modelBadgeLabel(badge, t)}</span>
          ))}
          {model.free === true ? <span style={modelBadgeChipStyle}>{t('freeModel')}</span> : null}
        </span>
      </div>
      {model.credits === undefined
        // No rate to show. When the plugin withheld it because the price came
        // from an ended promotion, say so plainly rather than showing nothing —
        // silence here reads as "free", which is the claim being avoided.
        ? model.rateUnknown === true ? <span style={modelRateStyle}>{t('rateUnknown')}</span> : null
        : <span style={modelRateStyle}>{t('rate', { rate: model.credits })}</span>}
    </div>
  )
}

/**
 * Context capacity, listed in full.
 *
 * Every model the upstream reports a capacity for, largest first. A one-line
 * summary with the exceptions on hover was tried and rejected: capacity is
 * reference data you scan by model, and hiding most of it behind a hover made
 * the common case (a model you already have in mind) the hard one to look up.
 *
 * Purely a report of the upstream's own numbers. The plugin offers no tier
 * picker: the CN catalog declares one capacity per model and publishes no
 * alternatives, so a menu there would mean inventing client-side policy. The
 * international document does declare alternatives (`supportedLengths`), and
 * they are shown as a secondary figure rather than merged into one number —
 * the default is the budget actually requested, while the larger value is a
 * ceiling the upstream would accept.
 */
function ContextTable({ models, t, useMaximumContextWindow, disabled, onUseMaximumContextWindow }: {
  models: readonly WorkBuddyWebModelBadge[] | undefined
  t: WorkBuddyPluginCardInjected['t']
  useMaximumContextWindow?: boolean
  disabled?: boolean
  onUseMaximumContextWindow?: (enabled: boolean) => void
}): React.ReactNode {
  const known = (models ?? [])
    .filter(model => model.contextWindow !== undefined)
    // Largest first: the big windows are the ones a user reaches for, and the
    // small ones are then easy to spot at the end.
    .sort((a, b) => (b.contextWindow as number) - (a.contextWindow as number))
  const canSelectMaximum = known.some(model => model.maxContextWindow !== undefined
    && model.maxContextWindow > (model.defaultContextWindow ?? model.contextWindow ?? 0))
  const showPreference = onUseMaximumContextWindow !== undefined && (canSelectMaximum || useMaximumContextWindow === true)
  if (known.length === 0 && !showPreference) return null
  return (
    <div style={quotaListStyle}>
      <h3 style={quotaTitleStyle}>{t('contextHeading')}</h3>
      {showPreference && onUseMaximumContextWindow !== undefined ? (
        <label style={contextPreferenceStyle}>
          <input
            type="checkbox"
            checked={useMaximumContextWindow === true}
            disabled={disabled}
            onChange={event => { onUseMaximumContextWindow(event.currentTarget.checked) }}
          />
          <span style={contextPreferenceCopyStyle}>
            <span>{t('useMaximumContextWindow')}</span>
            <span style={modelRateStyle}>{t('useMaximumContextWindowHint')}</span>
          </span>
        </label>
      ) : null}
      {known.map(model => {
        const capacity = model.contextWindow as number
        // Only shown when the upstream declared a larger alternative, so the
        // CN list (which declares none) is unchanged.
        const alternative = model.maxContextWindow !== undefined && model.maxContextWindow > capacity
          ? model.maxContextWindow
          : undefined
        return (
          <div key={model.id} style={quotaLabelStyle}>
            <span>{model.name}</span>
            {/* One line, right-aligned: the window in effect and the note
                beside it read as one figure, not as two rows competing with
                the model name across from them. */}
            <span style={contextPickerRowStyle}>
              <span>{formatTokens(capacity)}</span>
              {alternative !== undefined
                ? <span style={modelRateStyle}>{t('contextUpTo', { size: formatTokens(alternative) })}</span>
                : model.defaultContextWindow !== undefined && model.defaultContextWindow < capacity
                  ? <span style={modelRateStyle}>{t('contextDefault', { size: formatTokens(model.defaultContextWindow) })}</span>
                  : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Compact token count for display: the catalog's own round numbers (`200000`,
 * `1000000`) read better as `200K` / `1M`, and no precision is lost because
 * these values are always whole thousands.
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}K`
  return String(tokens)
}

/**
 * Reasoning-effort detection section: consent switches, per-model detection,
 * and the recorded observations.
 *
 * Two deliberate UX rules from the plan (§3.1, §3.2):
 * - the confirmation is shown *before* any request, and its copy states the
 *   credit caveat;
 * - a `non-validating` result is presented as an observation about the
 *   parameter ("this model does not check it"), never as a statement that a
 *   level is unsupported.
 */
function ProbeSection({ probe, t, onDetect, onClear, busy }: {
  probe: WorkBuddyWebProbeSection
  t: WorkBuddyPluginCardInjected['t']
  onDetect: (modelId: string) => void
  onClear: () => void
  busy: boolean
}): React.ReactNode {
  // Which model is awaiting confirmation. Confirmation is inline for the same
  // reason the Composer entry uses a bubble: a modal alert for a one-line
  // decision is heavier than the action it guards.
  const [pending, setPending] = useState<string>()
  // Which model this card last asked to detect. `busy` alone cannot answer
  // that — it is true for any in-flight request — so the running label needs
  // the id, otherwise every candidate button claims to be running at once.
  const [runningModel, setRunningModel] = useState<string>()
  // A sweep that finishes (or a catalogue change that removes the candidate)
  // must not leave a stale confirmation behind.
  useEffect(() => {
    if (pending !== undefined && !probe.candidates.includes(pending)) setPending(undefined)
  }, [pending, probe.candidates])
  // Clear the running label once the request settles.
  //
  // Keyed on `busy` alone this would fire immediately: the click that starts a
  // detection sets `runningModel` and `busy` in one batch, and an effect that
  // only checks `!busy` can still observe the pre-update value. So the label is
  // armed on the way up and released only after the run has actually been seen
  // in flight.
  const runningArmed = useRef(false)
  useEffect(() => {
    if (runningModel === undefined) return
    if (busy || probe.running) {
      runningArmed.current = true
      return
    }
    if (!runningArmed.current) return
    runningArmed.current = false
    setRunningModel(undefined)
  }, [runningModel, busy, probe.running])
  return (
    <div style={quotaListStyle}>
      <h3 style={quotaTitleStyle}>{t('probeHeading')}</h3>
      <p style={bodyStyle}>{t('probeIntro')}</p>
      <p style={bodyStyle}>{t('probeConsentHint')}</p>
      {probe.running ? <p style={bodyStyle}>{t('probeRunningGeneric')}</p> : null}
      {/*
        * One row per probeable model, each carrying its own state and button.
        *
        * Previously the buttons lived in a block above the results, so a model
        * that had been detected left the button list and reappeared only as a
        * result below — re-running it meant clearing every other result. Rows
        * keep the model and its action together, and the order is fixed by the
        * catalog, so nothing moves when a detection lands.
        */}
      {probe.candidates.length === 0
        ? <p style={bodyStyle}>{t('probeResultEmpty')}</p>
        : (
          <div style={quotaGroupStyle}>
            {probe.candidates.map(id => {
              const result = probe.results.find(entry => entry.id === id)
              const name = result?.name ?? id
              return (
                <div key={id} style={modelOfferStyle}>
                  <div style={probeRowStyle}>
                    <span>{name}</span>
                    <span style={probeRowEndStyle}>
                      {result === undefined ? null : (
                        <span style={modelBadgeChipStyle}>
                          {result.validation === 'validating' && result.efforts.length > 0
                            ? result.efforts.join(' / ')
                            : t(result.validation === 'non-validating' ? 'probeResultNotValidating' : 'probeResultUnknown')}
                        </span>
                      )}
                      <button
                        type="button"
                        style={buttonStyle}
                        disabled={probe.running || busy}
                        onClick={() => { setPending(id) }}
                      >
                        {/*
                          * Only the button that was actually pressed reports
                          * progress; the card-wide `busy` flag is true for any
                          * in-flight request, so it cannot pick the label.
                          */}
                        {runningModel === id
                          ? t('probeRunning', { model: id })
                          : t(result === undefined ? 'probeStart' : 'probeRedetect')}
                      </button>
                    </span>
                  </div>
                  {result === undefined ? null
                    : <span style={modelRateStyle}>{t('probeResultAt', { time: formatTime(result.probedAt) })}</span>}
                  {/*
                    * The confirmation expands inside the row it belongs to.
                    * Rendered after the whole list it sat at the bottom of a
                    * long candidate list, so the question ("send requests to
                    * this model?") was a screen away from the button that
                    * asked it. In-flow placement keeps them together and needs
                    * no positioning or overflow handling.
                    */}
                  {pending === id ? (
                    <div style={confirmBoxStyle}>
                      <p style={bodyStyle}>{t('probeConfirmBody', { model: name })}</p>
                      <div style={confirmRowStyle}>
                        <button type="button" style={buttonStyle} onClick={() => { setPending(undefined) }}>
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          disabled={probe.running || busy}
                          onClick={() => {
                            setRunningModel(id)
                            setPending(undefined)
                            onDetect(id)
                          }}
                        >
                          {t('probeConfirmAction')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

      {probe.results.length === 0 ? null : (
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { onClear() }}>
          {t('probeClear')}
        </button>
      )}
    </div>
  )
}

function CheckInLogTable({
  logs = [],
  t,
  onCheckIn,
  onRefresh,
  onClear,
  busy,
  checkingIn,
  clearing,
  disabled,
  notice,
}: {
  logs?: readonly {
    id: string
    date: string
    timestamp: number
    status: string
    amount?: number | undefined
    message?: string | undefined
  }[] | undefined
  t: WorkBuddyPluginCardInjected['t']
  onCheckIn?: () => void
  onRefresh?: () => void
  onClear?: () => void
  busy?: boolean
  checkingIn?: boolean
  clearing?: boolean
  disabled?: boolean
  notice?: string | undefined
}): React.ReactNode {
  return (
    <div style={quotaListStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={quotaTitleStyle}>{t('tabCheckIn')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            style={buttonStyle}
            disabled={disabled || busy || checkingIn}
            onClick={onCheckIn}
          >
            {checkingIn ? t('checkInChecking') : t('checkInNow')}
          </button>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy || checkingIn}
            onClick={onRefresh}
          >
            {busy ? t('checkInRefreshing') : t('checkInRefresh')}
          </button>
          <button
            type="button"
            style={buttonStyle}
            disabled={busy || clearing || !logs || logs.length === 0}
            onClick={onClear}
          >
            {clearing ? t('checkInClearing') : t('checkInClear')}
          </button>
        </div>
      </div>
      {notice === undefined ? null : <p style={bodyStyle}>{notice}</p>}
      {!logs || logs.length === 0 ? (
        <p style={descriptionStyle}>{t('checkInLogEmpty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.15))', paddingBottom: 6, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
            <span style={{ flex: 2 }}>{t('checkInLogTime')}</span>
            <span style={{ flex: 3 }}>{t('checkInLogResult')}</span>
            <span style={{ flex: 1, textAlign: 'right' }}>{t('checkInLogAmount')}</span>
          </div>
          {logs.map(log => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.08))' }}>
              <span style={{ flex: 2, color: 'var(--dsw-alias-label-secondary)' }}>{formatTime(log.timestamp)}</span>
              <span style={{ flex: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: log.status === 'claimed'
                    ? 'var(--dsw-alias-status-success, #52c41a)'
                    : log.status === 'already-claimed'
                      ? 'var(--dsw-alias-status-info, #1890ff)'
                      : log.status === 'no-campaign'
                        ? 'var(--dsw-alias-label-tertiary, #999)'
                        : 'var(--dsw-alias-status-error, #f5222d)',
                }} />
                <span>
                  {log.status === 'claimed'
                    ? t('autoCheckInStatusClaimed', { amount: log.amount ?? 100 })
                    : log.status === 'already-claimed'
                      ? t('autoCheckInStatusAlready')
                      : log.status === 'no-campaign'
                        ? t('autoCheckInStatusNoCampaign')
                        : t('autoCheckInStatusError', { message: log.message ?? '' })}
                </span>
              </span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: 600, color: log.amount ? 'var(--dsw-alias-brand-primary)' : 'inherit' }}>
                {log.amount ? `+${log.amount}` : '-'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Render WorkBuddy sign-in state and credit as one expandable card. */
export function WorkBuddyPluginCard(props: WorkBuddyPluginCardProps) {
  const { t, scope, signedIn, variant, unified } = props
  if (t === undefined) throw new Error('WorkBuddy plugin card requires its translation function')

  const isUnified = unified === true
  // The shared sign-in store, subscribed rather than read once: a poll landing
  // anywhere (this card, the other card, a sidebar card, the dashboard) moves
  // the tab dots and re-gates the embedded quota toggles without a remount.
  const liveSignIn = useSyncExternalStore(onQuotaSettingsChange, quotaSignInState)
  const [activeVariantId, setActiveVariantId] = useState<WorkBuddyVariantId>('workbuddy')
  // In unified mode the reader picks the variant, so the injected one is
  // ignored; otherwise this is exactly the per-variant card as before.
  const currentVariant = isUnified
    ? (activeVariantId === 'workbuddy' ? CN_CARD_VARIANT : AI_CARD_VARIANT)
    : (variant ?? CN_CARD_VARIANT)

  const [open, setOpen] = useState(false)
  /** Whether the pointer is over the card; drives the same border tint the built-in card gets on hover. */
  const [hovered, setHovered] = useState(false)
  /** Keyboard focus on the header, reproducing the built-in's `:focus-visible` ring. */
  const [headerFocused, setHeaderFocused] = useState(false)
  /**
   * The document to render. `undefined` means *not read yet*, which is a
   * distinct state from "signed out": seeding this with a signed-out document
   * told an already-signed-in user they were signed out for the whole first
   * round trip (and forever, if the read never settled).
   */
  const [status, setStatus] = useState<WorkBuddyWebStatus>()
  /**
   * Whether the last **successful** read found a usable credential.
   *
   * Kept apart from `status` because the poll's liveness must depend on what the
   * account actually is, not on what the card last displayed: a failed read
   * leaves this untouched, so a transient failure cannot disarm the interval,
   * while a genuine signed-out answer still stops it.
   *
   * `undefined` therefore means "no successful read yet", which is also the
   * condition that decides whether a failed read has anything to preserve.
   *
   * Named `...State` because in unified mode the injected sign-in reader is
   * `signedIn` — the two are different things and must not shadow each other.
   */
  const [signedInState, setSignedInState] = useState<boolean>()
  /**
   * Why the most recent read failed, when it did. Rendered as a notice beside
   * whatever document is still on screen, rather than replacing it.
   */
  const [readFailure, setReadFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  /**
   * The in-flight sign-in attempt, when there is one.
   *
   * `state` is the attempt to poll and `url` is where the human was sent, kept
   * so the card can offer the link again after a re-render or a popup blocker
   * stopped the automatic tab.
   */
  const [signIn, setSignIn] = useState<{ state: string; url: string }>()
  /** Why the most recent sign-in attempt failed, when it did. */
  const [signInError, setSignInError] = useState<string>()
  /** Outcome of the most recent credential import, for the card to report. */
  const [importNotice, setImportNotice] = useState<{ kind: 'done' | 'failed'; text: string }>()
  /** The hidden file input the import button drives. */
  const importInput = useRef<HTMLInputElement>(null)
  // Four tabs. Default is the live status plus the one action the card
  // carries; the reference sets — context capacity, rates and the
  // per-package breakdown, and check-in logs — are deliberate visits.
  const [tab, setTab] = useState<'status' | 'context' | 'details' | 'checkin'>('status')
  const [checkingIn, setCheckingIn] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)
  const [checkInNotice, setCheckInNotice] = useState<string>()
  const mounted = useRef(true)
  /**
   * Identity of the newest read that may write. Assigned when a read *starts*,
   * so a response is superseded by anything begun after it — "the response whose
   * request started last wins". Without this, a slow poll begun before a manual
   * action could settle after the action's own refresh and restore the older
   * document.
   */
  const readSeq = useRef(0)
  /** Manual requests in flight, so unmount can abort them like the poll's. */
  const manualControllers = useRef(new Set<AbortController>())

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const controller of manualControllers.current) controller.abort()
      manualControllers.current.clear()
    }
  }, [])

  /** Register a manual request's controller so unmount aborts it. */
  const trackController = useCallback((): AbortController => {
    const controller = new AbortController()
    manualControllers.current.add(controller)
    return controller
  }, [])

  /**
   * The in-process key authorizing this card's writes, or undefined until a
   * document carrying one has been read.
   *
   * Derived once rather than read off each use site: the `error` arm carries no
   * key, and reaching for `status.loginKey` in three places is three chances to
   * dereference a state that has none.
   */
  const actionKey = status === undefined || status.status === 'error' ? undefined : status.loginKey

  /**
   * Read the status document and apply it under the two policies the card's
   * correctness rests on:
   *
   * - a non-document body (empty, `null`, a non-JSON page) is a failed read, not
   *   something to store and then dereference in the render;
   * - a failed read never discards a document already on screen. It is recorded
   *   and shown as a notice beside that document; only when nothing has been
   *   read yet does the failure itself become the rendered state.
   *
   * Returns whether this read produced the current document.
   */
  const refresh = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    const seq = ++readSeq.current
    // Superseded (a newer read started) or unmounted: write nothing, report
    // nothing. A dropped response must not surface as a failure of its own.
    const current = (): boolean => mounted.current && signal?.aborted !== true && seq === readSeq.current
    try {
      const response = await fetch(currentVariant.statusPath, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!isWorkBuddyWebStatus(value)) throw new Error(t('statusResponseInvalid'))
      if (!current()) return false
      setStatus(value)
      // Only a document that states the session may move the poll gate. An
      // `error` document (which only a failed read produces, and which the host
      // never sends) says nothing about the account, so it must not stop the
      // interval — that would strand the card on a state it cannot leave.
      if (value.status === 'signed-in') {
        setSignedInState(true)
        // Publish into the SHARED store, so the embedded quota toggles, the
        // sidebar cards and the dashboard all see this session immediately —
        // the unified card is often the only surface polling a variant whose
        // sidebar card is switched off.
        noteQuotaStatus(currentVariant.id as WorkBuddyVariantId, value)
      } else if (value.status === 'signed-out') {
        setSignedInState(false)
        noteQuotaStatus(currentVariant.id as WorkBuddyVariantId, value)
      }
      setReadFailure(undefined)
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('requestFailed')
      if (current()) {
        setReadFailure(message)
        // Nothing on screen to preserve: the failure is all there is to show.
        setStatus(previous => previous === undefined ? { status: 'error', message } : previous)
      }
      return false
    }
  }, [currentVariant.statusPath, currentVariant.id, t])

  useEffect(() => {
    if (!open) return
    // One variant's document is not another's: switching tabs must not show the
    // account, credits or model list that belonged to the variant just active.
    // Clear to the honest "not read yet" state and re-read.
    setStatus(undefined)
    setSignedInState(undefined)
    setReadFailure(undefined)
    setSignIn(undefined)
    setSignInError(undefined)
    setImportNotice(undefined)
    setCheckingIn(false)
    setClearingLogs(false)
    setCheckInNotice(undefined)
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => { controller.abort() }
  }, [open, currentVariant.statusPath, refresh])

  useEffect(() => {
    // Gated on the last successful read, never on the rendered document: a
    // failed read must not be able to disarm this effect, or one transient
    // error would leave the card blank until the user clicked Refresh.
    if (!open || signedInState === false) return
    const controller = new AbortController()
    const timer = window.setInterval(() => { void refresh(controller.signal) }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [open, refresh, signedInState])

  const manualRefresh = async (): Promise<void> => {
    setBusy(true)
    const controller = trackController()
    try {
      await refresh(controller.signal)
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
  }

  /**
   * Ask the host to re-read the credential and re-fetch this variant's catalog.
   *
   * Shares the probe route's key and guards: it is a write that spends an
   * upstream request, so it does not belong on the read-only status GET. A
   * failure is surfaced through the refreshed document's `catalog.error` rather
   * than thrown away, so the reason survives the round trip.
   */
  const refreshModels = useCallback(async (): Promise<void> => {
    const key = status?.status === 'signed-in' ? status.probeKey : undefined
    if (key === undefined) return
    setBusy(true)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.probePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'refresh' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        // A rejected write is reported beside the document, exactly like a
        // failed read: replacing it would take the account, credits and model
        // list away over one failed action — the harm §3 of the confirmation
        // document removes for reads, and identical here. Aborts stay silent.
        setReadFailure(error instanceof Error ? error.message : t('requestFailed'))
      }
      // The failed write has no follow-up read, so it unregisters here.
      manualControllers.current.delete(controller)
      return
    } finally {
      if (mounted.current) setBusy(false)
    }
    // Started after the write resolves, so this read outranks any poll that
    // began earlier and the refreshed list is what stays on screen.
    try {
      await refresh(controller.signal)
    } finally {
      // Unregistered only after this read settles: while it is in flight it is
      // still a manual request, so unmount must abort it exactly as it aborts
      // the write above and `manualRefresh`/`control` abort theirs.
      manualControllers.current.delete(controller)
    }
  }, [currentVariant.probePath, refresh, status, t, trackController])

  const manualCheckIn = useCallback(async (): Promise<void> => {
    const key = status?.status === 'signed-in' ? status.probeKey : undefined
    if (key === undefined) return
    setCheckingIn(true)
    setCheckInNotice(undefined)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.probePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'checkin' }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const message = typeof value === 'object' && value !== null && 'error' in value
          ? String((value as Record<string, unknown>)['error'])
          : `HTTP ${response.status}`
        throw new Error(message)
      }
      const result = (typeof value === 'object' && value !== null ? value : {}) as { state?: string; amount?: number; reason?: string }
      if (result.state === 'claimed') {
        setCheckInNotice(t('autoCheckInStatusClaimed', { amount: result.amount ?? 100 }))
      } else if (result.state === 'already-claimed') {
        setCheckInNotice(t('autoCheckInStatusAlready'))
      } else if (result.state === 'no-campaign') {
        setCheckInNotice(t('autoCheckInStatusNoCampaign'))
      } else if (result.reason) {
        setCheckInNotice(t('autoCheckInStatusError', { message: result.reason }))
      }
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        const message = error instanceof Error ? error.message : t('requestFailed')
        setCheckInNotice(t('autoCheckInStatusError', { message }))
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setCheckingIn(false)
    }
    try {
      await refresh(controller.signal)
    } finally {
      manualControllers.current.delete(controller)
    }
  }, [currentVariant.probePath, refresh, status, t, trackController])

  const clearCheckInLogs = useCallback(async (): Promise<void> => {
    const key = status?.status === 'signed-in' ? status.probeKey : undefined
    if (key === undefined) return
    setClearingLogs(true)
    setCheckInNotice(undefined)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.probePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'clear-checkin-logs' }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const message = typeof value === 'object' && value !== null && 'error' in value
          ? String((value as Record<string, unknown>)['error'])
          : `HTTP ${response.status}`
        throw new Error(message)
      }
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        const message = error instanceof Error ? error.message : t('requestFailed')
        setCheckInNotice(t('autoCheckInStatusError', { message }))
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setClearingLogs(false)
    }
    try {
      await refresh(controller.signal)
    } finally {
      manualControllers.current.delete(controller)
    }
  }, [currentVariant.probePath, refresh, status, t, trackController])

  /**
   * Run one control action and refresh the card's state afterwards.
   *
   * The key travels in a header, not the body: it authorizes the write, and
   * the host never accepts a prompt, a sentinel, or a model outside its own
   * catalog from here.
   */
  const control = useCallback(async (action: { action: 'probe'; model: string } | { action: 'clear' } | { action: 'set-maximum-context-window'; enabled: boolean }): Promise<void> => {
    const key = status?.status === 'signed-in' ? status.probeKey : undefined
    if (key === undefined) return
    setBusy(true)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.probePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify(action),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) {
        const message = typeof value === 'object' && value !== null && 'error' in value
          ? String((value as Record<string, unknown>)['error'])
          : `HTTP ${response.status}`
        throw new Error(message)
      }
      if (action.action === 'set-maximum-context-window'
        && (typeof value !== 'object' || value === null || (value as Record<string, unknown>)['state'] !== 'updated')) {
        const reason = typeof value === 'object' && value !== null && 'reason' in value
          ? String((value as Record<string, unknown>)['reason'])
          : t('requestFailed')
        throw new Error(reason)
      }
      await refresh(controller.signal)
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        // Same policy as a failed read and as `refreshModels`: the reason is
        // reported beside the document, never in place of it. A detection that
        // did not complete must not erase the account and credit figures the
        // user was reading. Aborts stay silent.
        setReadFailure(error instanceof Error ? error.message : t('requestFailed'))
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
  }, [currentVariant.probePath, refresh, status, t, trackController])

  /**
   * Start a detection. Confirmation happens inline in the section, so this is
   * only ever called after the user has already agreed.
   */
  const confirmDetect = useCallback((modelId: string): void => {
    void control({ action: 'probe', model: modelId })
  }, [control])

  /**
   * Start a fresh attempt against this variant's realm, and send the browser to it.
   *
   * Shared by the signed-out card's sign-in button and by the signed-in card's
   * account switch, which differ only in whether a credential was discarded
   * first. The card never names the realm: the route it posts to belongs to this
   * variant, so the host decides which upstream is signed in to. The returned
   * URL is opened here rather than by the host because only the page can open a
   * tab the user's popup blocker will accept as a response to their click.
   */
  const startAttempt = useCallback(async (key: string): Promise<void> => {
    setSignInError(undefined)
    setBusy(true)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.loginPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Login-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'begin' }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
      const state = typeof record['state'] === 'string' ? record['state'] : ''
      const url = typeof record['url'] === 'string' ? record['url'] : ''
      if (state === '' || url === '') throw new Error(t('requestFailed'))
      setSignIn({ state, url })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        setSignInError(error instanceof Error ? error.message : t('requestFailed'))
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
  }, [currentVariant.loginPath, t, trackController])

  /** The signed-out card's sign-in button. */
  const beginSignIn = useCallback(async (): Promise<void> => {
    const key = actionKey
    if (key === undefined) return
    await startAttempt(key)
  }, [actionKey, startAttempt])

  /** Remove the stored credential and forget the account. */
  const signOut = useCallback(async (): Promise<void> => {
    if (status?.status !== 'signed-in' || status.loginKey === undefined) return
    const key = status.loginKey
    setBusy(true)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.loginPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Login-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'logout' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSignIn(undefined)
      // Defense in depth, published BEFORE the follow-up read: the shared store
      // still holds the signed-in document (and the sign-in fact) until the
      // refresh lands, and anything reading it in that window — the embedded
      // quota toggles, a sidebar card — would see an account that no longer
      // exists and keep its toggle enabled for it.
      const signedOutDoc: WorkBuddyWebStatus = { status: 'signed-out', loginKey: key }
      setStatus(signedOutDoc)
      setSignedInState(false)
      noteQuotaStatus(currentVariant.id as WorkBuddyVariantId, signedOutDoc)
      noteQuotaSignIn(currentVariant.id, false)
      await refresh(controller.signal)
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        setReadFailure(error instanceof Error ? error.message : t('requestFailed'))
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
  }, [currentVariant.id, currentVariant.loginPath, refresh, status, t, trackController])

  /**
   * Replace the signed-in account: discard the stored credential, then start a
   * fresh attempt.
   *
   * One action rather than two, because the halves are only useful together: a
   * user switching accounts has no reason to stay signed out in between, and
   * making them press sign-out and then sign-in would leave a window where the
   * card shows no account and the second button is easy to miss.
   *
   * The credential is the only thing discarded — the previous account's saved
   * catalog and probe records are keyed by account, so they are left alone and
   * simply stop applying.
   */
  const switchAccount = useCallback(async (): Promise<void> => {
    const key = actionKey
    if (key === undefined) return
    setBusy(true)
    setImportNotice(undefined)
    setSignInError(undefined)
    const controller = trackController()
    try {
      const response = await fetch(currentVariant.loginPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Login-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'logout' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSignIn(undefined)
      // Publish the sign-out before opening the next attempt, so the card never
      // shows the previous account while the browser is being sent to the new
      // one. The shared store is published too: the discarded credential is not
      // usable by anything else in the meantime, so a quota toggle that gates
      // on this variant must drop it now, not at the refresh's answer.
      const signedOutDoc: WorkBuddyWebStatus = { status: 'signed-out', loginKey: key }
      setStatus(signedOutDoc)
      setSignedInState(false)
      noteQuotaStatus(currentVariant.id as WorkBuddyVariantId, signedOutDoc)
      noteQuotaSignIn(currentVariant.id, false)
      await refresh(controller.signal)
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        setReadFailure(error instanceof Error ? error.message : t('requestFailed'))
      }
      return
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
    await startAttempt(key)
  }, [actionKey, currentVariant.id, currentVariant.loginPath, refresh, startAttempt, t, trackController])

  /**
   * Poll the active attempt until it settles.
   *
   * Polling lives here rather than in the route because the browser already
   * holds the cadence machinery (and this way an abandoned tab stops polling on
   * its own). A `failed` answer ends the attempt and is reported; `pending`
   * keeps waiting.
   */
  useEffect(() => {
    if (signIn === undefined) return
    let cancelled = false
    const timer = setInterval(() => {
      void (async () => {
        // Either arm carries the key: a switch starts while the card still shows
        // the signed-in document, and the poll must run from the first tick.
        const key = actionKey
        if (key === undefined) return
        try {
          const response = await fetch(currentVariant.loginPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Login-Key': key },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'poll', state: signIn.state }),
          })
          const value: unknown = await response.json().catch(() => undefined)
          if (cancelled || !mounted.current) return
          const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
          const outcome = record['status']
          if (outcome === 'complete') {
            setSignIn(undefined)
            setSignInError(undefined)
            // The attempt succeeded: the gate may open as soon as the
            // refreshed document lands, and in unified mode this card is
            // frequently the ONLY poller — the embedded quota toggle would
            // stay disabled until something else happened to fetch.
            noteQuotaSignIn(currentVariant.id, true)
            await refresh()
            return
          }
          if (outcome === 'failed') {
            setSignIn(undefined)
            setSignInError(typeof record['message'] === 'string' ? record['message'] : t('requestFailed'))
          }
        } catch {
          // A transient poll failure is not the attempt's outcome; the next tick
          // retries. Only the route's own `failed` answer ends the wait.
        }
      })()
    }, 2_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [actionKey, currentVariant.id, currentVariant.loginPath, signIn, refresh, t])

  /**
   * Adopt a credential file the user picked.
   *
   * The browser reads the file and posts its text; the host parses and validates
   * it. The card never inspects the document itself — the realm check and the
   * write belong to the side that owns the credential store, and a card that
   * decided either would be a second, weaker authority.
   */
  const importCredential = useCallback(async (file: File): Promise<void> => {
    if (status?.status !== 'signed-out' || status.loginKey === undefined) return
    const key = status.loginKey
    setImportNotice(undefined)
    setBusy(true)
    const controller = trackController()
    try {
      const document = await file.text()
      const response = await fetch(currentVariant.loginPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Login-Key': key },
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ action: 'import', document }),
      })
      const value: unknown = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
      if (record['status'] === 'imported') {
        const account = typeof record['nickname'] === 'string' && record['nickname'] !== ''
          ? record['nickname']
          : typeof record['uid'] === 'string' && record['uid'] !== '' ? record['uid'] : ''
        setImportNotice({ kind: 'done', text: t('importDone', { account: account === '' ? '—' : account }) })
        // Publish the adopted session before the read settles: the quota
        // toggles gate on it, and an imported credential is exactly the case
        // where a toggle flips from disabled to enabled while the user watches.
        noteQuotaSignIn(currentVariant.id, true)
        await refresh(controller.signal)
        return
      }
      setImportNotice({
        kind: 'failed',
        text: t('importFailed', {
          message: typeof record['message'] === 'string' ? record['message'] : t('requestFailed'),
        }),
      })
    } catch (error: unknown) {
      if (mounted.current && controller.signal.aborted !== true) {
        setImportNotice({
          kind: 'failed',
          text: t('importFailed', { message: error instanceof Error ? error.message : t('requestFailed') }),
        })
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) setBusy(false)
    }
  }, [currentVariant.id, currentVariant.loginPath, refresh, status, t, trackController])

  const cardTitle = isUnified ? t('unifiedTitle') : t(currentVariant.titleKey)
  const cardIntro = isUnified ? t('unifiedIntro') : t(currentVariant.introKey)
  /*
   * `undefined` is "not read yet" and gets its own copy. It is not signed-out:
   * claiming that would be false for a user who is in fact signed in.
   */
  const label = status === undefined
    ? t('loading')
    : status.status === 'signed-in'
      ? status.nickname === undefined ? t('signedInAs', { nickname: '' }).trimEnd().replace(/[:：]$/, '') : t('signedInAs', { nickname: status.nickname })
      : status.status === 'error'
        ? t('requestFailed')
        : t('signedOut')

  /**
   * The dot inside each segment of the variant switcher.
   *
   * The variant on screen reports what its own read found — including
   * 'loading' before the first document lands, which is a different fact from
   * "signed out". The other variant can only be judged by what the shared
   * store has heard from some other surface.
   *
   * An explicit `signedIn` reader is authoritative when present; the store is
   * the fallback. They are NOT OR'd: an optimistic store `true` surviving a
   * sign-out would light a dot for an account nobody is in.
   */
  const reported = signedIn?.()
  const cnSignedIn = reported !== undefined ? reported.cn : liveSignIn.cn
  const aiSignedIn = reported !== undefined ? reported.ai : liveSignIn.ai
  const cnDotStatus: 'loading' | WorkBuddyWebStatus['status'] = isUnified && activeVariantId === 'workbuddy'
    ? (status === undefined ? 'loading' : status.status)
    : (cnSignedIn ? 'signed-in' : 'signed-out')
  const aiDotStatus: 'loading' | WorkBuddyWebStatus['status'] = isUnified && activeVariantId === 'workbuddy-ai'
    ? (status === undefined ? 'loading' : status.status)
    : (aiSignedIn ? 'signed-in' : 'signed-out')

  return (
    <li
      style={{ ...cardStyle, ...hovered ? cardHoverStyle : {}, ...open ? cardOpenStyle : {} }}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
    >
      <button
        type="button"
        style={{ ...headerStyle, ...headerFocused ? headerFocusStyle : {} }}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${cardTitle}`}
        onClick={() => { setOpen(!open) }}
        onFocus={event => {
          // Keyboard focus only: a click focuses the button too, and the built-in
          // card shows no ring for that. If the browser cannot answer the query,
          // keeping the ring is the safer failure — a visible focus indicator
          // beats a missing one.
          let keyboard = true
          try {
            keyboard = event.currentTarget.matches(':focus-visible')
          } catch {
            keyboard = true
          }
          if (keyboard) setHeaderFocused(true)
        }}
        onBlur={() => { setHeaderFocused(false) }}
      >
        <span style={headTextStyle}>
          <span style={nameStyle}>{cardTitle}</span>
          <span style={descriptionStyle}>{cardIntro}</span>
        </span>
        <span style={{ ...chevronStyle, transform: open ? 'rotate(180deg)' : 'none' }}>
          <ChevronDownIcon />
        </span>
      </button>
      {open
        ? <div style={cardBodyStyle}>
            {isUnified ? (
              <>
                {/* The sidebar quota settings, embedded verbatim rather than
                    duplicated: one component owns the gate, so the toggles here
                    and in a standalone card can never disagree. */}
                <QuotaSettingsContent t={t} scope={scope} signedIn={signedIn} />
                {/* The variant switcher. Each segment carries its account's
                    status dot, so a glance says which side has a session
                    before anything is clicked. */}
                <div style={segmentedContainerStyle} role="tablist" aria-label="WorkBuddy Version Selection">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeVariantId === 'workbuddy'}
                    style={segmentedTabItemStyle(activeVariantId === 'workbuddy')}
                    onClick={() => setActiveVariantId('workbuddy')}
                  >
                    <span style={dotStyle(cnDotStatus)} aria-hidden="true" />
                    <span>{t('variantTabCN')}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeVariantId === 'workbuddy-ai'}
                    style={segmentedTabItemStyle(activeVariantId === 'workbuddy-ai')}
                    onClick={() => setActiveVariantId('workbuddy-ai')}
                  >
                    <span style={dotStyle(aiDotStatus)} aria-hidden="true" />
                    <span>{t('variantTabAI')}</span>
                  </button>
                </div>
              </>
            ) : null}
            <h3 style={quotaTitleStyle}>{t('accountHeading')}</h3>
            <div style={rowStyle}>
              {/* `aria-busy` while nothing has been read: the value is pending, not absent. */}
              <div style={statusStyle} role="status" aria-busy={status === undefined}>
                <span aria-hidden="true" style={dotStyle(status === undefined ? 'loading' : status.status)} />
                <span>{label}</span>
              </div>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void manualRefresh() }}>
                {busy ? t('refreshing') : t('refresh')}
              </button>
              {status?.status !== 'signed-in' || status.loginKey === undefined
                ? null
                : <>
                    <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void switchAccount() }}>
                      {busy ? t('switchingAccount') : t('switchAccount')}
                    </button>
                    <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void signOut() }}>
                      {busy ? t('signingOut') : t('signOut')}
                    </button>
                  </>}
            </div>
            {/*
              * A failed read is reported beside the document still on screen,
              * never in place of it: blanking the card over one transient error
              * loses the account, credits and model list the user was reading.
              * Cleared by the next successful read. `signedInState === undefined`
              * means no read has ever succeeded, so there is nothing to
              * annotate — the error state below already states the failure on
              * its own, exactly as it did before this notice existed.
            */}
            {readFailure === undefined || signedInState === undefined
              ? null
              : <p style={errorStyle}>{t('statusRefreshFailed', { message: readFailure })}</p>}
            {status?.status === 'signed-in'
              ? <>
                  {status.expiresAt === undefined ? null
                    : <p style={bodyStyle}>{t('accessTokenExpires', { time: formatTime(status.expiresAt) })}</p>}
                  {/*
                    * Catalog provenance. Without it a stale list is
                    * indistinguishable from a fresh one, and a user cannot tell
                    * whether what they see still matches the upstream. The
                    * refresh action sits here because this is the line that says
                    * whether the list needs refreshing.
                    */}
                  {status.catalog === undefined
                    ? null
                    : <div style={rowStyle}>
                        <span style={bodyStyle}>
                          {status.catalog.source === 'live' && status.catalog.fetchedAt !== undefined
                            ? t('catalogLive', { time: formatTime(status.catalog.fetchedAt) })
                            : status.catalog.source === 'saved' && status.catalog.fetchedAt !== undefined
                              ? t('catalogSaved', { time: formatTime(status.catalog.fetchedAt) })
                              : t('catalogFallback')}
                          {status.catalog.appVersion === undefined
                            ? ''
                            : ` · ${t('catalogAppVersion', { version: status.catalog.appVersion })}`}
                        </span>
                        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void refreshModels() }}>
                          {busy ? t('refreshingModels') : t('refreshModels')}
                        </button>
                      </div>}
                  {status.catalog?.error === undefined
                    ? null
                    : <p style={errorStyle}>{t('catalogError', { message: status.catalog.error })}</p>}
                  {/*
                    * Three tabs, split by what the reader came for.
                    *
                    * 1. Status — the live facts and the one action the card
                    *    carries: account, total credit, and reasoning-level
                    *    detection. Detection belongs beside the status because
                    *    it is something you *do* to the model in front of you,
                    *    not reference material you go looking for.
                    * 2. Context — every model's capacity, listed in full.
                    * 3. Details — the rate reference: per-package credit and
                    *    the per-model discount list.
                    *
                    * Previously this was one column, which buried the context
                    * window below several rows of per-model discounts: the
                    * least time-sensitive content sat above the most
                    * decision-relevant.
                    */}
                  <div role="tablist" style={tabBarStyle}>
                    {(['status', 'context', 'details', 'checkin'] as const).map(id => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => { setTab(id) }}
                        style={{ ...tabStyle, ...(tab === id ? tabActiveStyle : {}) }}
                      >
                        {t(id === 'status' ? 'tabStatus' : id === 'context' ? 'tabContext' : id === 'details' ? 'tabDetails' : 'tabCheckIn')}
                      </button>
                    ))}
                  </div>

                  {tab === 'status' ? (
                    <div style={tabPanelStyle}>
                      {status.credits === undefined ? null : (
                        <div style={quotaListStyle}>
                          <div style={rowStyle}>
                            <h3 style={quotaTitleStyle}>{t('creditsHeading')}</h3>
                            {/* `unlimited` first: the placeholder total is 0 and
                                rendering it would claim the quota is exhausted. */}
                            <span style={bodyStyle}>{status.credits.unlimited === true
                              ? t('creditsTotalUnlimited')
                              : t('creditsTotal', { total: formatNumber(status.credits.total) })}</span>
                          </div>
                          {status.credits.cycleResetTime === undefined ? null : (
                            <p style={descriptionStyle}>
                              {t('cycleResetAt', { time: formatCycleReset(status.credits.cycleResetTime) })}
                            </p>
                          )}
                        </div>
                      )}
                      {status.creditsError === undefined ? null
                        : <p style={errorStyle}>{t('creditsError', { message: status.creditsError })}</p>}
                      {status.probe === undefined ? null : (
                        <ProbeSection
                          probe={status.probe}
                          t={t}
                          busy={busy}
                          onDetect={confirmDetect}
                          onClear={() => { void control({ action: 'clear' }) }}
                        />
                      )}
                    </div>
                  ) : tab === 'context' ? (
                    <div style={tabPanelStyle}>
                      <ContextTable
                        models={status.models}
                        t={t}
                        disabled={busy}
                        {...status.useMaximumContextWindow === undefined ? {} : { useMaximumContextWindow: status.useMaximumContextWindow }}
                        {...currentVariant.id === AI_CARD_VARIANT.id
                          ? { onUseMaximumContextWindow: (enabled: boolean) => { void control({ action: 'set-maximum-context-window', enabled }) } }
                          : {}}
                      />
                    </div>
                  ) : tab === 'details' ? (
                    <div style={tabPanelStyle}>
                      {status.credits === undefined ? null : (
                        <div style={quotaListStyle}>
                          <h3 style={quotaTitleStyle}>{t('creditsDetailHeading')}</h3>
                          {status.credits.accounts
                            .filter(account => account.packageName === 'enterprise' || account.remain > 0 || account.unlimited === true)
                            .map((account, index) => (
                            <CreditBar
                              key={`${account.packageName}-${String(index)}`}
                              label={account.packageName === 'enterprise' ? t('packageEnterprise') : account.packageName}
                              remain={account.remain}
                              size={account.size}
                              unlimited={account.unlimited}
                              packageEndTime={account.packageEndTime}
                              t={t}
                            />
                          ))}
                        </div>
                      )}
                      {status.models === undefined || status.models.length === 0 ? null : (
                        <div style={quotaListStyle}>
                          <h3 style={quotaTitleStyle}>{t('modelsHeading')}</h3>
                          {status.models
                            .filter(model => model.free === true || (model.badges?.length ?? 0) > 0)
                            .map(model => <ModelOfferRow key={model.id} model={model} t={t} />)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={tabPanelStyle}>
                      <CheckInLogTable
                        logs={status.checkIn?.logs}
                        t={t}
                        busy={busy}
                        checkingIn={checkingIn}
                        clearing={clearingLogs}
                        disabled={status.status !== 'signed-in'}
                        {...checkInNotice === undefined ? {} : { notice: checkInNotice }}
                        onCheckIn={() => { void manualCheckIn() }}
                        onRefresh={() => { void manualRefresh() }}
                        onClear={() => { void clearCheckInLogs() }}
                      />
                    </div>
                  )}
                </>
              : null}
            {status?.status === 'signed-out'
              // A mismatch explanation replaces the generic hint: telling a user
              // to "sign in" is wrong advice when a credential was found and
              // rejected for belonging to the other product.
              ? <>
                  <p style={status.reason === undefined ? bodyStyle : errorStyle}>
                    {status.reason ?? t(currentVariant.signedOutKey)}
                  </p>
                  {status.loginKey === undefined
                    ? null
                    : <div style={rowStyle}>
                        <button
                          type="button"
                          style={buttonStyle}
                          disabled={busy || signIn !== undefined}
                          onClick={() => { void beginSignIn() }}
                        >
                          {signIn === undefined ? t('signIn') : t('signingIn')}
                        </button>
                        {/*
                          * The link stays reachable after the automatic tab, so a
                          * blocked popup or a closed tab is recoverable without
                          * starting a new attempt (which would invalidate the
                          * state the host is already polling).
                        */}
                        {signIn === undefined
                          ? null
                          : <a href={signIn.url} target="_blank" rel="noopener noreferrer" style={bodyStyle}>
                              {t('signInOpenAgain')}
                            </a>}
                      </div>}
                  {signIn === undefined ? null : <p style={bodyStyle}>{t('signInWaiting')}</p>}
                  {signInError === undefined ? null : <p style={errorStyle}>{t('signInFailed', { message: signInError })}</p>}
                  {/*
                    * Import path: for a credential the user already has (a
                    * workbuddy.json from the sibling tooling, or one carried over
                    * from another machine). The browser can only read a file the
                    * user explicitly picks, which is why this is a picker rather
                    * than a path field.
                  */}
                  {status.loginKey === undefined
                    ? null
                    : <div style={rowStyle}>
                        <span style={bodyStyle}>{t('importHeading')}</span>
                        <button
                          type="button"
                          style={buttonStyle}
                          disabled={busy || signIn !== undefined}
                          onClick={() => { importInput.current?.click() }}
                        >
                          {busy ? t('importing') : t('importAction')}
                        </button>
                        <input
                          ref={importInput}
                          type="file"
                          accept=".json,application/json"
                          style={{ display: 'none' }}
                          onChange={event => {
                            const file = event.target.files?.[0]
                            // Clear the value so picking the same file again still
                            // fires a change event.
                            event.target.value = ''
                            if (file !== undefined) void importCredential(file)
                          }}
                        />
                      </div>}
                  {status.loginKey === undefined ? null : <p style={bodyStyle}>{t('importHint')}</p>}
                  {importNotice === undefined
                    ? null
                    : <p style={importNotice.kind === 'failed' ? errorStyle : bodyStyle}>{importNotice.text}</p>}
                </>
              : null}
            {status?.status === 'error' ? <p style={errorStyle}>{status.message}</p> : null}
          </div>
        : null}
    </li>
  )
}
