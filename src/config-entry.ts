/** Node-free constant shared by the Host and browser halves. */

/**
 * The DSH profile entry id that owns this plugin's `Config` schema.
 *
 * DSH 0.1.7 dropped the Host settings-namespace registry: a settings READ or
 * WRITE is addressed by the profile ENTRY id instead. The host keys every
 * configuration form by `entry.options.id` (`@deepseek-ai/dsh-settings`,
 * `SettingsForms.describe()` / `write()`), and the browser half addresses the
 * same key through `configForms.get(entryId)`.
 *
 * That id is not the package name: it is declared by this package's own
 * `cordis.patch.yml` layer, which the profile applies as a bundle patch —
 * `- insert: [{ id: llm-workbuddy, name: dsh-workbuddy-connect }]` — the same
 * way the built-in `@deepseek-ai/dsh-client-ui-conversation` entry is keyed
 * `ui-conversation` rather than by its package name. Both halves therefore read
 * the id from here, so a profile that renames the entry has exactly one place
 * to follow.
 */
export const WORKBUDDY_CONFIG_ENTRY_ID = 'llm-workbuddy'
