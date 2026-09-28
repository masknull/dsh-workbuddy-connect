/**
 * Plugin-owned settings scope over the plugin's own settings face.
 *
 * Configuration used to be written through the host's settings service
 * (`settingsScope`, removed in 0.1.7) or the profile patch (`configEditor.edit`
 * on 0.1.7, which reconciles the whole loader tree and hot-reloads the
 * plugin's fiber, ~1–1.5 s per write, refreshing every client mirror) — so
 * each toggle of a sidebar-quota switch paid a full tree recompose.
 *
 * The host half serves this plugin's configuration from its own settings file
 * over a loopback route; this module is the browser half of that contract,
 * implementing the same settings-scope surface the card was written against,
 * so the card needs no change at all.
 */

import type { SettingsScope } from './quota-settings-store.ts'

/** Base path of the host half's settings face. */
const ROUTE_BASE = '/plugins/dsh-workbuddy-connect'

/** The document the host's GET and POST answer with. */
interface SettingsFaceDocument {
  /** Write authorizer, minted per host plugin lifetime. */
  key: string
  /** Effective values: the settings file over the composition entry. */
  value: Record<string, unknown>
  /** The schema defaults the host serves. */
  base: Record<string, unknown>
  /** The user layer exactly as stored (presence marks an override). */
  user: Record<string, unknown>
}

/**
 * Fetch one settings face document.
 * @param init - the request init (method, headers, body).
 * @returns the parsed document.
 * @throws when the transport or the host refuses the request.
 */
async function request(init: RequestInit): Promise<SettingsFaceDocument> {
  const response = await fetch(`${ROUTE_BASE}/settings`, {
    credentials: 'same-origin',
    ...init,
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = typeof value === 'object' && value !== null && 'error' in value
      ? String((value as Record<string, unknown>)['error'])
      : `HTTP ${response.status}`
    throw new Error(error)
  }
  if (typeof value !== 'object' || value === null || !('value' in value)) {
    throw new Error('workbuddy: settings face answered an invalid document')
  }
  return value as SettingsFaceDocument
}

/**
 * The scope the card was written against, backed by this plugin's own file.
 *
 * A write optimistically adopts the value it just sent, then confirms with the
 * host's answer (which re-reads the file it wrote), so the card never renders a
 * value the host does not hold.
 */
export class OwnQuotaSettingsScope implements SettingsScope<never> {
  private document: SettingsFaceDocument | undefined
  private readonly listeners = new Set<() => void>()
  private snapshot: { status: 'loading' | 'ready' | 'unavailable'; value: never | undefined; writable: boolean } = {
    status: 'loading',
    value: undefined,
    writable: true,
  }

  /**
   * Load the current document. Call once before the card binds; repeated calls
   * are harmless and re-read the host.
   * @returns the effective values.
   */
  async load(): Promise<Record<string, unknown> | undefined> {
    try {
      this.document = await request({ headers: { accept: 'application/json' } })
    } catch {
      // An unreachable face is not a broken card: it keeps loading and the
      // toggles stay inert, exactly like an unserved namespace.
      return undefined
    }
    this.publish()
    return this.document.value
  }

  /** @returns the stable snapshot the card reads (ready once loaded). */
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: never | undefined; writable: boolean } {
    return this.snapshot
  }

  /** @param listener - invoked after every snapshot change. @returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Write one field.
   * @param field - field name inside the settings document.
   * @param value - the JSON-shaped value to store.
   * @returns whether the host accepted the write.
   */
  async set(field: string, value: unknown): Promise<boolean> {
    return this.patch({ [field]: value })
  }

  /**
   * Clear one field: the value falls back to the schema default.
   * @param field - field name inside the settings document.
   * @returns whether the host accepted the clear.
   */
  async unset(field: string): Promise<boolean> {
    return this.patch({ [field]: null })
  }

  /** Send one patch and adopt the host's answer. */
  private async patch(patch: Record<string, unknown>): Promise<boolean> {
    const key = this.document?.key
    if (key === undefined) return false
    try {
      this.document = await request({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WorkBuddy-Settings-Key': key,
        },
        body: JSON.stringify(patch),
      })
      this.publish()
      return true
    } catch {
      return false
    }
  }

  /** Rebuild the cached snapshot and notify the subscribers. */
  private publish(): void {
    this.snapshot = {
      status: this.document === undefined ? 'loading' : 'ready',
      value: this.document?.value as never | undefined,
      writable: true,
    }
    for (const listener of this.listeners) listener()
  }
}
