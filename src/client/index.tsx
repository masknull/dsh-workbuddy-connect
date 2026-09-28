/** Browser half: WorkBuddy account status, quota cards, and plugin settings. */

import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Side-effect type import: this package carries the `settings.section` SlotMap
// contract (the shared 《插件设置》 container registers into it on 0.1.7).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { WorkBuddyProbeControl } from './WorkBuddyProbeControl.tsx'
import { CARD_VARIANTS, WorkBuddyPluginCard } from './WorkBuddyPluginCard.tsx'
import type { WorkBuddyPluginCardInjected } from './WorkBuddyPluginCard.tsx'
import type { QuotaSection } from './QuotaSettingsCard.tsx'
import { OwnQuotaSettingsScope } from './http-settings-scope.ts'
import { QuotaDashboard, SidebarQuotaCard } from './SidebarQuotaCard.tsx'
import type { QuotaDashboardInjected, QuotaDashboardState, QuotaDashboardProps, QuotaCopyKey, SidebarQuotaCardInjected, SidebarQuotaCardProps } from './SidebarQuotaCard.tsx'
import { injectQuotaCss } from './quota-styles.ts'
import './quota-slots.ts'
// Side-effect type import: this module carries the `plugins.bundle.config`
// SlotMap contract — the plugin manager's bundle-configuration seat, declared
// by a Host built-in this bundle does not depend on (see plugin-manager-slots.ts).
import './plugin-manager-slots.ts'
import { setQuotaPollMs, setQuotaToggles, quotaSignInState, quotaPollMs, noteQuotaStatus, quotaStatusIsFresh, variantOfStatusPath } from './quota-settings-store.ts'
import type { SettingsScope } from './quota-settings-store.ts'
import { isWorkBuddyWebStatus } from './status-document.ts'
import { en, zh } from './locales.ts'
import type { WorkBuddySettingsKey } from './locales.ts'
import { WORKBUDDY_AI_STATUS_PATH, WORKBUDDY_STATUS_PATH } from '../status-paths.ts'
import type { WorkBuddyWebStatus } from '../status-paths.ts'

/** The dashboard face's props are bound directly; no extra key props are needed. */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** WorkBuddy plugin card copy. */
    'settings.workbuddy': WorkBuddySettingsKey
    /** Shared quota-settings and sidebar-card copy. */
    'panel.workbuddy-quota': WorkBuddySettingsKey
  }
}

/**
 * Stable browser-plugin name.
 */
export const name = 'dsh-workbuddy-connect-client'
/**
 * Client services required by the Plugin configuration contribution.
 *
 * DSH 0.1.2 removed `@deepseek-ai/dsh-client-runtime` (the package that used to
 * hold the browser `ClientContext` alias and the `slots` service). The services
 * this card relies on now come from narrower packages: the `slots` registry
 * moved to `@deepseek-ai/dsh-client-ui-renderer`, `locale` stayed in
 * `@deepseek-ai/dsh-client-locale`. Both are named in the package's
 * `dsh.client.inject` list, so cordis has activated them before this plugin's
 * fiber starts.
 *
 * The CONFIGURATION service is deliberately NOT here either: configuration
 * reads and writes ride this plugin's own settings face (an HTTP route served
 * by the host half over the plugin's own file), so no host configuration
 * service — 0.1.5's `settingsScope`, removed in 0.1.7, or 0.1.7's `configForms`
 * — is a static dependency of this bundle at all.
 */
// `modelDirectories` reads the active session through `remote.session`.
// Declaring that dependency at the client entry is required by the Desktop
// renderer; without it Cordis rejects `directoryFor()` before this bundle can
// finish registering its contributions.
export const inject = ['slots', 'locale', 'remote', 'remote.session']

/**
 * This plugin's package name.
 *
 * Used as the entry `id` inside the shared 《插件设置》 block: the three connect
 * plugins share one container, and the container requires a distinct `id` per
 * contribution, so the package name is the one identifier guaranteed unique.
 */
const PACKAGE_NAME = 'dsh-workbuddy-connect'

/**
 * The shared 《插件设置》 container the three connect plugins agree on: slot
 * `settings.section`, entry id `plugin-settings`, child slot
 * `plugin-settings.item`. The id and the child slot name must stay identical
 * across the three plugins — a mismatch would produce two half-empty blocks,
 * or a container whose child slot nobody declared.
 */
const PLUGIN_SETTINGS_SECTION_ID = 'plugin-settings'
const PLUGIN_SETTINGS_ITEM_SLOT = 'plugin-settings.item'

/**
 * The plugin manager's bundle-configuration seat, and this bundle's key in it.
 *
 * The sidebar's Plugins panel (the `plugins` main panel the Host's plugin
 * manager registers) renders one bundle's own configuration on the bundle's
 * detail page — between the description and the component rows — through the
 * `plugins.bundle.config` keyed slot. The key must spell this package's name
 * exactly: it is the same key the page's configuration ledger reads to decide
 * whether the configuration section shows at all. The slot itself is declared
 * by the Host (see `plugin-manager-slots.ts` for the structural restatement),
 * so registering before that declaration exists is a no-op by construction —
 * `ctx.slots.inject` defers the factory until the seat is committed.
 */
const PLUGIN_MANAGER_SLOT = 'plugins.bundle.config'

/**
 * The container component of the shared 《插件设置》 block.
 *
 * It owns no content of its own: every attached plugin registers a card into
 * the child slot this entry declares, and the container renders them. Only the
 * plugin that wins the container registration mounts this; a plugin that lost
 * the race registers into the winner's container and never mounts it.
 */
function PluginSettingsSection(props: PropsRuntime<'settings.section'> & PropsRenderSlots<'plugin-settings.item'>): React.ReactNode {
  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, listStyle: 'none' }}>
      {props.renderSlot(PLUGIN_SETTINGS_ITEM_SLOT, {})}
    </ul>
  )
}

/** The settings namespaces each variant's card and section use (host-side constants, mirrored for paths). */
const VARIANT_STATUS: Record<string, string> = {
  workbuddy: WORKBUDDY_STATUS_PATH,
  'workbuddy-ai': WORKBUDDY_AI_STATUS_PATH,
}

/**
 * Register card copy, the unified WorkBuddy card, and the sidebar quota cards.
 *
 * The entire body is wrapped so that a DSH slot-API breaking change (for
 * example the rc.6 to rc.7 `id` to `key` / `order` to `priority` rename) degrades
 * to a `console.error` instead of throwing into the DSH loader and raising
 * the red "Failed to load plugins" banner. The host provider keeps working:
 * the `workbuddy` model channel is unaffected, and `dsh-workbuddy-connect
 * status` reports host health via the heartbeat file.
 *
 * Card ORDER: the shared block dispatches its `list` entries by `order`
 * ascending, so the unified card keeps the seat the shared quota-settings card
 * held: session-prompt 10 / workbuddy 20 / qoder 30 — this card is 20.
 *
 * NOTE: the try/catch boundary of this function is mirrored (duplicated) in
 * `tests/client-fallback.spec.ts`, because the real client entry imports
 * browser-only DSH packages that cannot load in the Node test environment.
 * That test therefore does not import this function; it replicates its
 * shape. If you change the guarded body or the `console.error` message here,
 * update the mirrored `apply()` in that spec too, or the fallback test will
 * silently diverge from this real implementation.
 */
export function apply(ctx: ClientContext): void {
  try {
    const namespace = 'settings.workbuddy'
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-workbuddy-connect: settings copy')
    const t = ctx.locale.bind(namespace) as WorkBuddyPluginCardInjected['t']

    // 1. The shared quota-settings values. The card that EDITS them is no
    // longer registered separately — it now lives inside the unified
    // WorkBuddy card below (see `unified: true`), which keeps one owner for
    // the sign-in gate instead of two cards that could disagree.
    // The quota namespace is adopted as soon as the running host's
    // configuration service appears (see the two probes below), NOT when the
    // settings card's inject factory first runs: the factory only executes
    // while the settings page renders, so a fresh page load read no toggles and
    // rendered no sidebar card until the user opened settings — the exact
    // regression the commandcode card avoids by reading its STORED fact
    // independently of the settings page. The scope subscription mirrors every
    // accepted snapshot (toggles + interval) into the shared store the sidebar
    // cards and the dashboard read; a deployment with neither configuration
    // service skips binding, and the plugin keeps serving models.
    let quotaScope: SettingsScope<QuotaSection> | undefined
    const adoptQuotaScope = (scope: SettingsScope<QuotaSection> | undefined): void => {
      if (scope === undefined) return
      quotaScope = scope
      const applySnapshot = (): void => {
        const value = scope.getSnapshot().value
        setQuotaToggles(value?.sidebarQuotaCN === true, value?.sidebarQuotaAI === true)
        if (typeof value?.quotaPollMs === 'number') setQuotaPollMs(value.quotaPollMs)
      }
      applySnapshot()
      scope.subscribe(applySnapshot)
    }

    // 2. 插件自有配置（`<profile>/.dsh-workbuddy-connect/settings.json`）：
    // 读写都走宿主半的 settings face，不经过任何宿主配置服务。scope 启动即
    // 载入，卡片注册无条件进行。
    const ownQuotaScope = new OwnQuotaSettingsScope()
    void ownQuotaScope.load().catch(() => {})
    adoptQuotaScope(ownQuotaScope as never)

    /**
     * The unified card's inject face, shared by every surface that mounts it:
     * the shared 《插件设置》 block and this bundle's page in the sidebar's
     * Plugins panel. One factory keeps both of them reading the same live
     * values — the same scope, the same sign-in fact, the same `unified`
     * layout — so a save on either surface is a save for both, exactly as the
     * reference implementation does it.
     *
     * `defaultOpen` is the one per-surface difference: the Plugins-panel page
     * has room for the whole configuration, so that registration opens the
     * card at once; the settings block lists it collapsed. The fold state
     * stays the viewer's afterwards — the two surfaces do not share it.
     */
    const unifiedCardInject = (defaultOpen = false): WorkBuddyPluginCardInjected => ({
      t,
      scope: quotaScope,
      // Read live at render: the sign-in state changes without a remount.
      signedIn: () => quotaSignInState(),
      unified: true,
      defaultOpen,
    })
    try {
      registerPluginSettings()
    } catch (error: unknown) {
      console.error('[dsh-workbuddy-connect] plugin settings block registration failed (host provider unaffected):', error)
    }

    /**
     * Register the same unified card on this bundle's page in the sidebar's
     * Plugins panel, beside its enable switch and component rows.
     *
     * `ctx.slots.inject` defers the factory until the Host's plugin manager
     * declares the seat (its `main` registration commits the child table), so
     * a deployment that ships no plugin manager — or loads it after this
     * bundle — never throws: the callback simply never runs, and the shared
     * 《插件设置》 block stays the single surface, exactly as before. The keyed
     * key is this package's name, the same key the page's configuration ledger
     * reads to decide whether the configuration section shows.
     *
     * Its own boundary mirrors the dashboard and footer-card ones: a slot-API
     * breaking change degrades to a console.error instead of taking the
     * settings block or the model channel with it.
     */
    function joinPluginManagerBlock(): void {
      ctx.slots.inject(PLUGIN_MANAGER_SLOT, () => ctx.slots.register({
        name: PLUGIN_MANAGER_SLOT,
        key: PACKAGE_NAME,
        // The bundle's page in the Plugins panel has room for the whole
        // configuration, so the card opens expanded there.
        inject: () => unifiedCardInject(true),
      }, WorkBuddyPluginCard))
    }
    try {
      joinPluginManagerBlock()
    } catch (error: unknown) {
      console.error('[dsh-workbuddy-connect] plugin manager page registration failed (host provider unaffected):', error)
    }

    /**
     * Register this plugin's seat in the shared 《插件设置》 block.
     *
     * `settings.section` is a list slot owned by the settings shell, and a
     * slot's CHILDREN are declared exactly once, by one entry — so three
     * plugins cannot each create "their" block. They agree on one container
     * instead: entry id `plugin-settings`, which declares the child slot
     * `plugin-settings.item`, and each plugin contributes one card into that
     * child with its own package name as the entry id. The protocol:
     *
     * 1. wait for the shell to declare `settings.section`;
     * 2. probe whether a sibling already registered the `plugin-settings` entry;
     * 3. if so, attach this plugin's card to the sibling's container;
     * 4. otherwise register the container (which declares the child slot) and
     *    then attach to it — losing that race throws, and the loser takes
     *    step 3.
     */
    function registerPluginSettings(): void {
      const registerItem = (): (() => void) => ctx.slots.register({
        name: PLUGIN_SETTINGS_ITEM_SLOT,
        id: PACKAGE_NAME,
        // 《插件设置》卡片统一排位（列表按 order 升序渲染）：
        // session-prompt 10 / workbuddy 20 / qoder 30。
        order: 20,
        // The shared block lists its cards collapsed (the factory's
        // `defaultOpen` default); the Plugins-panel registration above opens
        // the same card. One face, two surfaces.
        inject: unifiedCardInject,
      }, WorkBuddyPluginCard)
      // The callback returns its disposers: `slots.inject` owns them for the
      // declaration's lifetime, so the container and this plugin's card are
      // torn down together when the shell collapses `settings.section`.
      ctx.slots.inject('settings.section', () => {
        const taken = ctx.slots.entries('settings.section')
          .some(entry => entry.options?.id === PLUGIN_SETTINGS_SECTION_ID)
        if (taken) return registerItem()
        try {
          const disposeContainer = ctx.slots.register({
            name: 'settings.section',
            id: PLUGIN_SETTINGS_SECTION_ID,
            // The shell orders these sections itself; 900 keeps the shared
            // block at the end, where the connect plugins' cards used to sit.
            order: 900,
            // The shared block's nav label. Only the winner's label is ever
            // shown, and the three plugins register the same text.
            label: () => '插件设置',
            children: { [PLUGIN_SETTINGS_ITEM_SLOT]: { kind: 'list', scope: 'root' } },
          }, PluginSettingsSection)
          return [disposeContainer, registerItem()]
        } catch {
          // A sibling registered the container between the probe and this
          // call: its child slot is declared, so attach to it instead.
          return registerItem()
        }
      })
    }

    // Sidebar quota cards + the dashboard they open. Two registrations, one
    // navigation entry — commandcode's pattern: the layout's keyed `main` slot
    // holds the shared dashboard, each footer card selects it on click. The
    // `layout` service is read REFLECTIVELY at click time (never a static
    // inject — ui-layout is not this bundle's dependency), and the footer
    // registration is gated on the layout seam so a profile without
    // `selectPanel` never renders a dead button.
    const QUOTA_PANEL_ID = 'workbuddy-quota-panel'
    const CONVERSATION_PANEL_ID = 'conversation'
    interface LayoutSelectionSeam {
      selectPanel: (id: string | null) => void
    }

    // ---- dashboard state (module-closure, read by both the face and open()) ----
    const dashboardDocuments: { cn: WorkBuddyWebStatus | undefined; ai: WorkBuddyWebStatus | undefined } = { cn: undefined, ai: undefined }
    let dashboardFetchedAt: number | undefined
    let dashboardLoading = false
    let dashboardRequestedPath: string = WORKBUDDY_STATUS_PATH
    /** Whether the dashboard is the CURRENT center panel (its mount owns this). */
    let quotaPanelOpen = false
    const dashboardListeners = new Set<() => void>()
    /**
     * The observable source the dashboard reads through the inject face's
     * `hooks` compartment. The renderer caches an inject face ONCE per entry
     * and SPREADS it into props — a face getter is read exactly once and
     * frozen, which is why face-carried documents/activePath went stale. The
     * hooks channel survives: `bindInjectSources` converts each hooks member
     * into a `use<Name>` selector hook, and the hook reads the CURRENT
     * snapshot on every render (the same mechanism commandcode's usage store
     * rides).
     *
     * STABILITY CONTRACT: useSyncExternalStore requires getSnapshot() to
     * return the SAME reference between changes — a fresh object per call
     * re-renders forever and React kills the entry (error #185, the same
     * class of crash the settings card's unstable projection caused). So the
     * snapshot is a CACHED object, replaced wholesale by publish(); every
     * mutator builds the next snapshot and publishes exactly once.
     */
    let dashboardSnap: QuotaDashboardState = {
      documents: [undefined, undefined],
      fetchedAt: undefined,
      loading: false,
      activePath: WORKBUDDY_STATUS_PATH,
    }
    const rebuildSnapshot = (): void => {
      const next: QuotaDashboardState = {
        documents: [dashboardDocuments.cn, dashboardDocuments.ai],
        fetchedAt: dashboardFetchedAt,
        loading: dashboardLoading,
        activePath: dashboardRequestedPath,
      }
      // Publish only on an actual change: identity-stable otherwise.
      if (JSON.stringify(next) !== JSON.stringify(dashboardSnap)) {
        dashboardSnap = next
        for (const listener of dashboardListeners) listener()
      }
    }
    const dashboardSource = {
      getSnapshot: (): QuotaDashboardState => dashboardSnap,
      subscribe: (listener: () => void): (() => void) => {
        dashboardListeners.add(listener)
        return () => {
          dashboardListeners.delete(listener)
        }
      },
    }
    const notifyDashboard = (): void => {
      rebuildSnapshot()
    }

    /**
     * Refresh ONE variant's document (the one the panel is showing) — not
     * both. The earlier version fetched both routes on every panel mount, so
     * clicking the CN card also refreshed the AI card's data and timestamp;
     * the user ruled each click refreshes only what it shows.
     *
     * Freshness rule (also the user's): if the shared document for THIS
     * variant is newer than the configured interval, the fetch is SKIPPED —
     * a click shows the cached numbers instead of re-billing upstream. A
     * variant with NO result yet always fetches. A manual Refresh click
     * (force=true) bypasses the freshness check: an explicit user action
     * always re-reads.
     */
    const refreshDashboard = async (options: { force?: boolean } = {}): Promise<void> => {
      if (dashboardLoading) return
      const variantId = variantOfStatusPath(dashboardRequestedPath)
      if (options.force !== true && quotaStatusIsFresh(variantId, quotaPollMs())) return
      dashboardLoading = true
      rebuildSnapshot()
      try {
        const result = await (variantId === 'workbuddy'
          ? fetchStatusDocument(WORKBUDDY_STATUS_PATH)
          : fetchStatusDocument(WORKBUDDY_AI_STATUS_PATH))
        // Publish through the SHARED store: the sidebar cards and the settings
        // toggles read the same documents, so one refresh updates every
        // surface AT WHICH IT IS SHOWN — and only that variant's document.
        if (result !== undefined) noteQuotaStatus(variantId, result)
        dashboardFetchedAt = Date.now()
      } finally {
        dashboardLoading = false
        rebuildSnapshot()
      }
    }

    let dashboardTimer: number | undefined
    const startDashboardPoll = (): void => {
      if (dashboardTimer !== undefined) return
      void refreshDashboard()
      dashboardTimer = window.setInterval(() => {
        if (document.hidden) return
        // Interval ticks honour the freshness rule too: a tick within the
        // interval of the last read is a no-op, not a fetch.
        void refreshDashboard()
      }, Math.max(60_000, quotaPollMs()))
    }
    const stopDashboardPoll = (): void => {
      if (dashboardTimer === undefined) return
      window.clearInterval(dashboardTimer)
      dashboardTimer = undefined
    }

    async function fetchStatusDocument(path: string): Promise<WorkBuddyWebStatus | undefined> {
      try {
        const response = await fetch(path, { headers: { accept: 'application/json' } })
        const body: unknown = await response.json()
        return response.ok && isWorkBuddyWebStatus(body) ? body : undefined
      } catch {
        return undefined
      }
    }

    // Mount/unmount wrapper. A FUNCTION DECLARATION, defined before the
    // register call that names it: the last build named a `const` from inside
    // the slots.inject factory, which ran synchronously (ui-layout was already
    // live) and hit the temporal dead zone — the ReferenceError was contained
    // by the register's own try/catch, the dashboard cell never registered,
    // and every card click threw "main panel not registered" (the dead
    // button). Hoisted declarations cannot hit the dead zone. The child
    // renders as JSX (not a bare function call) so its hooks stay in their
    // own component instance.
    function QuotaDashboardWithLifecycle(props: QuotaDashboardProps): React.ReactNode {
      useEffect(() => {
        quotaPanelOpen = true
        startDashboardPoll()
        return () => {
          quotaPanelOpen = false
          stopDashboardPoll()
        }
      }, [])
      return <QuotaDashboard {...props} />
    }

    const panelFace = (): QuotaDashboardInjected => ({
      hooks: {
        // Renderer converts this to the `useQuotaDashboard` selector hook
        // (standardHookPropName capitalises the name). Its snapshots MUST be
        // reference-stable between changes — useSyncExternalStore compares
        // identity — so refreshDashboard publishes a fresh top-level object.
        quotaDashboard: dashboardSource,
      },
      t,
      statusPaths: [WORKBUDDY_STATUS_PATH, WORKBUDDY_AI_STATUS_PATH],
      refresh: () => {
        // The dashboard's Refresh button is an explicit user action: it
        // bypasses the freshness rule and re-reads the SHOWN variant only.
        void refreshDashboard({ force: true })
      },
      // The user switched to another variant's tab: point the dashboard at it
      // and fetch that variant when the shared store holds nothing for it (or
      // something stale). Its sidebar card being off means no other surface
      // ever fetched it, so without this the tab showed "sign in" until the
      // user toggled a setting.
      onVariantPicked: (path: string) => {
        dashboardRequestedPath = path
        notifyDashboard()
        void refreshDashboard()
      },
      close: () => {
        const layout = ctx.get('layout') as LayoutSelectionSeam | undefined
        if (typeof layout?.selectPanel !== 'function') return
        try {
          layout.selectPanel(null)
        } catch {
          try {
            layout.selectPanel(CONVERSATION_PANEL_ID)
          } catch (error: unknown) {
            console.error('[dsh-workbuddy-connect] could not close the quota panel:', error)
          }
        }
      },
    })

    ctx.effect(() => injectQuotaCss(), 'dsh-workbuddy-connect: quota styles')

    // The dashboard cell itself needs no gate: registering for a declaration
    // that never arrives is a no-op by construction.
    try {
      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: QUOTA_PANEL_ID, locale: 'panel.workbuddy-quota', inject: panelFace as never },
        QuotaDashboardWithLifecycle as never,
      ))
    } catch (error: unknown) {
      console.error('[dsh-workbuddy-connect] could not register the quota dashboard:', error)
    }

    ctx.inject(['layout'], layoutCtx => {
      const layout = layoutCtx.get('layout') as LayoutSelectionSeam | undefined
      if (typeof layout?.selectPanel !== 'function') return
      try {
        for (const variant of CARD_VARIANTS) {
          const statusPath = VARIANT_STATUS[variant.id]
          if (statusPath === undefined) continue
          const injected: SidebarQuotaCardInjected = {
            t,
            statusPath,
            // Toggle semantics (the user's spec): clicking the card of the
            // variant ALREADY showing closes the panel; clicking the other
            // variant's card switches the panel to it and keeps it open.
            open: () => {
              const current = layoutCtx.get('layout') as LayoutSelectionSeam | undefined
              if (typeof current?.selectPanel !== 'function') return
              if (quotaPanelOpen && dashboardRequestedPath === statusPath) {
                current.selectPanel(null)
                return
              }
              dashboardRequestedPath = statusPath
              // An already-mounted panel will not re-render from selectPanel
              // (the panel key is unchanged), so push the tab change through
              // the revision the dashboard subscribes to. The variant switch
              // must also FETCH the newly shown variant when the shared store
              // holds nothing (or something stale) for it — without this,
              // opening the panel on one variant and switching to the other
              // showed "sign in" forever for a variant no surface had ever
              // fetched (its sidebar card being off means nobody polls it).
              notifyDashboard()
              void refreshDashboard()
              current.selectPanel(QUOTA_PANEL_ID)
            },
          }
          layoutCtx.slots.inject('sidebar.footer.action', () => layoutCtx.slots.register({
            name: 'sidebar.footer.action',
            id: variant.id === 'workbuddy' ? 'workbuddy-quota' : 'workbuddy-quota-ai',
            order: variant.id === 'workbuddy' ? 20 : 21,
            locale: 'panel.workbuddy-quota',
            inject: (): SidebarQuotaCardProps | SidebarQuotaCardInjected => injected,
          } as never, SidebarQuotaCard))
        }
      } catch (error: unknown) {
        console.error('[dsh-workbuddy-connect] could not register the sidebar footer card:', error)
      }
    })

    ctx.inject(['modelDirectories'], scope => {
      scope.slots.inject('conversation.input.right', () => scope.slots.register({
        name: 'conversation.input.right',
        id: 'workbuddy-probe',
        order: 10,
        inject: sessionId => ({
          directory: scope.modelDirectories.directoryFor(
            sessionId as Parameters<typeof scope.modelDirectories.directoryFor>[0],
          ).store,
          t,
        }),
      }, WorkBuddyProbeControl))
    })
  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    // Developers see the full cause in the browser console; users see no banner.
    console.error('[dsh-workbuddy-connect] client card failed to load (host provider unaffected):', error)
  }
}
