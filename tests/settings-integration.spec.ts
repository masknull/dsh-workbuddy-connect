import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as WorkBuddy from '../src/index.ts'
import { WORKBUDDY_SETTINGS_FACE_PATH } from '../src/index.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

/**
 * Host-settings integration for the assembled plugin: which providers register,
 * what configuration the settings face serves, where writes land, and how the
 * international variant's maximum-context preference survives restarts.
 *
 * Since DSH 0.1.7 the host no longer serves per-plugin settings SECTIONS — the
 * 0.1.5 Plugins tab, `settingsScope`, and the `settings.plugin.item` seat are
 * all gone, and `ctx.settings` is no longer a context property. This plugin's
 * configuration lives in its own `<profile>/.dsh-workbuddy-connect/
 * settings.json`, served to the browser card over the plugin-owned settings
 * face (`GET/POST /plugins/dsh-workbuddy-connect/settings`), and the card
 * writes go through that route. These tests therefore drive configuration
 * through the same face the card uses, and assert the file it lands in.
 */

class MemorySettings extends SettingsProvider {
  // 0.1.7 declares `writable` as an accessor on SettingsForms; overriding it
  // with a plain field is a type error, so the stub keeps the same shape.
  override get writable(): boolean {
    return true
  }
  private storedDocument: Record<string, unknown> = {}

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedDocument))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/**
 * A stand-in for the host's web server service: the plugin registers its
 * routes on it exactly as it does on the real one, and a test drives the
 * settings face through the captured handler.
 */
class FakeWebServer {
  readonly routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []

  register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }): () => void {
    this.routes.push(route)
    return () => {
      const index = this.routes.indexOf(route)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** A credential document for one upstream region, as a login would store it. */
function credentialDocument(domain: string): string {
  return JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, domain },
    account: { uid: 'uid-1', nickname: 'nick', enterpriseId: 'ent-1' },
  })
}

/** Isolate the plugin's file roots and silence any real network. */
function stubEnvRoot(): void {
  vi.stubEnv('DSH_HOME', root!)
  // The plugin keeps its files in a per-profile folder; point that at the same
  // temporary root so the settings file and the credential paths are the ones
  // this spec writes.
  vi.stubEnv(WorkBuddy.WORKBUDDY_DATA_DIR_ENV, root!)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))
}

/**
 * Boot the assembled plugin against the fake web server.
 *
 * The credential sweep and the first catalog run on real timers, so every
 * wait carries an explicit timeout: under full-suite load a default-timeout
 * wait is a flake, not a failure.
 */
async function boot(web: FakeWebServer): Promise<Context> {
  const ctx = new Context()
  context = ctx
  ctx.provide('webServer')
  ctx.set('webServer', web as never)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(WorkBuddy, {})
  await vi.waitFor(() => {
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('workbuddy')
  }, { timeout: 15_000 })
  return ctx
}

/** One settings-face call: the HTTP status and the JSON document it answered. */
interface FaceAnswer { status: number; document: Record<string, unknown> }

/**
 * Drive the plugin's settings face the way the browser card does: a node-http
 * shaped request/response pair through the captured handler, loopback host so
 * the trust guard passes, no Origin (a non-browser caller is trusted).
 */
async function callFace(
  handler: (req: unknown, res: unknown) => Promise<void>,
  method: 'GET' | 'POST',
  patch?: Record<string, unknown>,
  key?: string,
): Promise<FaceAnswer> {
  const body = patch === undefined ? undefined : JSON.stringify(patch)
  const request = new Readable({ read() {} })
  Object.assign(request, {
    method,
    headers: {
      host: '127.0.0.1:39271',
      ...body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      ...key === undefined ? {} : { 'x-workbuddy-settings-key': key },
    },
  })
  let status = 0
  let payload = ''
  const response = {
    writeHead: (code: number) => { status = code },
    end: (text: string) => { payload = text },
  }
  const settled = handler(request, response).then(() => ({ status, document: JSON.parse(payload || '{}') as Record<string, unknown> }))
  if (body !== undefined) request.push(body)
  request.push(null)
  return settled
}

/** The settings-face handler a booted plugin registered, or a thrown failure. */
function faceHandler(web: FakeWebServer): (req: unknown, res: unknown) => Promise<void> {
  const route = web.routes.find(entry => entry.path === WORKBUDDY_SETTINGS_FACE_PATH)
  if (route === undefined) throw new Error('settings face route was not registered')
  return route.handler
}

/** GET the face, then POST one patch authorized with the document's write key. */
async function facePatch(web: FakeWebServer, patch: Record<string, unknown>): Promise<FaceAnswer> {
  const handler = faceHandler(web)
  const read = await callFace(handler, 'GET')
  const key = String(read.document['key'])
  return callFace(handler, 'POST', patch, key)
}

/** The plugin's own settings file, exactly as stored. */
async function storedSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root!, 'settings.json'), 'utf8')) as Record<string, unknown>
}

describe('WorkBuddy Host settings integration', () => {
  it('restores the saved maximum-window preference across restarts and can disable it', async () => {
    root = await mkdtemp(join(tmpdir(), 'workbuddy-context-restart-'))
    const aiAuthPath = join(root, AI_VARIANT.ownFilename)
    await writeFile(aiAuthPath, credentialDocument('www.workbuddy.ai'))
    stubEnvRoot()

    const web = new FakeWebServer()
    let ctx = await boot(web)
    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    }, { timeout: 15_000 })
    // Fresh profile, setting never touched: the default is on, so the model
    // resolves at its largest declared window before any update is written.
    expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(1_000_000)

    // A write through the settings face — the same route the card uses —
    // lands in the plugin's own file and takes effect without a restart.
    const written = await facePatch(web, { useMaximumContextWindow: false })
    expect(written.status).toBe(200)
    expect((written.document['value'] as Record<string, unknown>)['useMaximumContextWindow']).toBe(false)
    expect((await storedSettings())['useMaximumContextWindow']).toBe(false)
    await vi.waitFor(async () => {
      expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(300_000)
    }, { timeout: 15_000 })

    // And it survives the restart: the file is the source of truth, so the
    // preference the user turned off may not resurrect.
    await ctx.fiber.dispose()
    const rebooted = new FakeWebServer()
    ctx = await boot(rebooted)
    expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(300_000)
    const face = await callFace(faceHandler(rebooted), 'GET')
    expect((face.document['value'] as Record<string, unknown>)['useMaximumContextWindow']).toBe(false)
  })

  it('exposes the provider directory entry, the settings face, and the fallback model list', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-settings-'))
    // This case asserts the CN fallback roster, which is served only to a
    // signed-in variant. Pinning a credential of its own keeps that independent
    // of anything else on this machine: the store reads the plugin's own file
    // under `$DSH_HOME`, and without one the group stays hidden (empty model
    // list) rather than serving the roster.
    const cnAuthPath = join(root, CN_VARIANT.ownFilename)
    await writeFile(cnAuthPath, credentialDocument('copilot.tencent.com'))
    // Signing in would otherwise make this case perform a real request to the CN
    // catalog endpoint. These tests must not touch the network, and the roster
    // asserted below is the compiled-in fallback, so the fetch is stubbed to
    // fail exactly as the sibling case does rather than depending on the remote.
    stubEnvRoot()

    const web = new FakeWebServer()
    const ctx = await boot(web)
    expect(ctx.llm.listConfigurableProviders()).toContainEqual({
      provider: 'workbuddy',
      displayName: 'WorkBuddy',
      settingsNs: 'workbuddy',
      settingsPath: [],
      declared: false,
    })

    const models = await ctx.llm.listModels('workbuddy')
    expect(models.map(model => model.id)).toContain('auto')
    expect(models.map(model => model.id)).toContain('deepseek-v4-pro')
    // The fallback catalog tracks the live `cli` roster, including the newer
    // models the desktop app offers that older builds lacked.
    expect(models.map(model => model.id)).toContain('hy4-preview')
    expect(models.map(model => model.id)).toContain('glm-5.3')

    // The billing rate rides the display name (and the advisory description)
    // so both the /model popup and the composer seat show it; the id and the
    // request path are untouched by this display-only decoration.
    const byId = new Map(models.map(model => [model.id, model]))
    // Since DSH 0.1.2 the composer seat renders the model name only, so both
    // the billing rate and the declared promo badges ride the name itself;
    // description stays untouched everywhere.
    expect(byId.get('glm-5.2')?.name).toBe('GLM-5.2 · x0.79 · 夜间折扣')
    expect(byId.get('glm-5.1')?.name).toBe('GLM-5.1 · x0.79')
    expect(byId.get('auto')?.name).toBe('Auto')
    expect(byId.get('glm-5.2')?.description).toBeUndefined()
    expect(byId.get('glm-5.3')?.description).toBeUndefined()

    // Thinking controls are declared-set-only: models whose upstream row
    // carries `supportedEfforts` expose exactly those efforts; rows without a
    // list (the older `{effort, summary}` shape) expose no control at all, so
    // requests never carry `reasoning_effort` for them and the upstream
    // default applies — matching the desktop app's own per-model gating.
    const autoResolved = await ctx.llm.resolveModelInfo('workbuddy', 'auto')
    expect(autoResolved.reasoning).toBeUndefined()
    const flashResolved = await ctx.llm.resolveModelInfo('workbuddy', 'glm-5.3-flash')
    expect(flashResolved.reasoning?.efforts.map(effort => effort.id).sort()).toEqual(['high', 'low', 'max', 'off'])

    // Image modalities follow the per-model catalog flag (fallback list here):
    // image-capable entries expose `image`, glm-5.1 stays text-only.
    const modalities = new Map(models.map(model => [model.id, model.inputModalities]))
    expect(modalities.get('auto')).toContain('image')
    expect(modalities.get('glm-5.1')).toEqual(['text'])

    // A settings write validates against the schema and persists. The CN
    // section owns one field — `probeConsent` — so that is the write to make,
    // and the stored value is read back both through the face and through the
    // plugin's own file.
    const written = await facePatch(web, { probeConsent: true })
    expect(written.status).toBe(200)
    expect((written.document['value'] as Record<string, unknown>)['probeConsent']).toBe(true)
    expect((await storedSettings())['probeConsent']).toBe(true)
  })

  /**
   * Both providers register from one plugin, unconditionally, and the two
   * variants' preferences are isolated. That is what lets a sign-in that
   * happens while DSH is already running surface without a restart.
   */
  it('registers both variants and keeps each variant identity separate', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-dual-'))
    stubEnvRoot()
    // Shorten the credential sweep: a group appears only once the sweep has
    // adopted the credential it finds in the temporary home.
    vi.stubEnv('DSH_WORKBUDDY_POLL_MS', '100')
    // One real-shaped credential per product, each in the file its own variant
    // owns under the Harness home. The upstream fetch is stubbed to fail so the
    // assertion covers the per-variant fallback rosters rather than depending
    // on the network.
    await writeFile(join(root, CN_VARIANT.ownFilename), credentialDocument('copilot.tencent.com'))
    await writeFile(join(root, AI_VARIANT.ownFilename), credentialDocument('www.workbuddy.ai'))

    const web = new FakeWebServer()
    const ctx = await boot(web)
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(
        expect.arrayContaining(['workbuddy', 'workbuddy-ai']),
      )
    }, { timeout: 15_000 })

    // Each provider carries its own display name, which is the model group
    // heading the picker renders — and its OWN settings namespace: the Models
    // page resolves `settingsNs` against the served configuration, so a shared
    // ns would render both providers onto one card.
    expect(ctx.llm.listConfigurableProviders()).toEqual(expect.arrayContaining([
      { provider: 'workbuddy', displayName: 'WorkBuddy', settingsNs: 'workbuddy', settingsPath: [], declared: false },
      { provider: 'workbuddy-ai', displayName: 'WorkBuddy AI', settingsNs: 'workbuddy-ai', settingsPath: [], declared: false },
    ]))

    // A write through one variant's field must reach only THAT variant.
    // Observable chosen deliberately: `useMaximumContextWindow` is the only
    // setting that changes a served model. It selects a larger declared window,
    // and only the international variant exposes it, so the AI provider's
    // window must move while the CN provider's — a model that declares no
    // alternatives at all — stays exactly where it was. A mis-routed switch
    // would move the CN provider instead.
    await facePatch(web, { useMaximumContextWindow: false })
    await vi.waitFor(async () => {
      expect((await ctx.llm.resolveModelInfo('workbuddy-ai', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(300_000)
    }, { timeout: 15_000 })
    expect((await ctx.llm.resolveModelInfo('workbuddy', 'deepseek-v4.1-flash')).context?.contextWindow).toBe(1_000_000)

    await vi.waitFor(async () => {
      expect((await ctx.llm.listModels('workbuddy')).length).toBeGreaterThan(0)
      expect((await ctx.llm.listModels('workbuddy-ai')).length).toBeGreaterThan(0)
    }, { timeout: 15_000 })

    // The two variants must not share a roster: the international models are
    // not reachable through the CN provider, and vice versa. A shared fallback
    // list would misdescribe one of them (different rates, windows, and
    // declared efforts).
    const cn = (await ctx.llm.listModels('workbuddy')).map(model => model.id)
    const ai = (await ctx.llm.listModels('workbuddy-ai')).map(model => model.id)
    expect(cn).toContain('minimax-m3')
    expect(ai).not.toContain('minimax-m3')
    expect(ai).toContain('gpt-5.6-luna')
    expect(cn).not.toContain('gpt-5.6-luna')

    // Disabling a model in CN variant isolates to CN and reflects in listModels
    let eventsEmitted = 0
    ctx.on('llm/adapters-updated', () => {
      eventsEmitted += 1
    })
    await facePatch(web, { disabledModelsCN: ['minimax-m3'] })
    await vi.waitFor(async () => {
      const updatedCn = (await ctx.llm.listModels('workbuddy')).map(model => model.id)
      expect(updatedCn).not.toContain('minimax-m3')
    }, { timeout: 15_000 })
    expect(eventsEmitted).toBeGreaterThan(0)
    // AI variant remains unaffected
    expect((await ctx.llm.listModels('workbuddy-ai')).map(model => model.id)).toContain('gpt-5.6-luna')
  })

  /**
   * With no credential present, a variant exposes nothing. This is the
   * deliberate behaviour change the plan calls out: the CN provider used to
   * publish 15 fallback models to a signed-out user, which offered models that
   * could only fail on the first message.
   */
  it('hides a variant with no usable credential while still registering it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-empty-'))
    // The temporary home is empty: neither variant's own credential file exists,
    // which is what "nobody has signed in" now means.
    stubEnvRoot()
    const web = new FakeWebServer()
    const ctx = await boot(web)

    await vi.waitFor(async () => {
      expect(await ctx.llm.listModels('workbuddy')).toEqual([])
    }, { timeout: 15_000 })
    expect(await ctx.llm.listModels('workbuddy-ai')).toEqual([])

    // The provider directory entry survives: the group is hidden by having no
    // models, not by unregistering, so a later sign-in needs no restart.
    expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider))
      .toEqual(expect.arrayContaining(['workbuddy', 'workbuddy-ai']))
    // And the settings face is still there to explain how to sign in.
    const face = await callFace(faceHandler(web), 'GET')
    expect(face.status).toBe(200)
    expect((face.document['value'] as Record<string, unknown>)['probeConsent']).toBe(false)
  })

  /**
   * A credential for the other product is refused, and the refusal is what the
   * card shows. Silently treating it as "signed out" would send the user to
   * re-authenticate when the actual fix is a file path.
   */
  it('refuses a cross-product credential instead of using it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-workbuddy-connect-cross-'))
    stubEnvRoot()
    // A WorkBuddy (CN) credential written into the international variant's own
    // credential file. There is no path setting left to point somewhere else, so
    // this — one product's credential in the other's file — is the mistyped or
    // copied state the region check still has to refuse.
    await writeFile(join(root, AI_VARIANT.ownFilename), credentialDocument('copilot.tencent.com'))
    const web = new FakeWebServer()
    const ctx = await boot(web)

    const models = await (async () => {
      await vi.waitFor(() => {
        expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('workbuddy-ai')
      }, { timeout: 15_000 })
      return ctx.llm.listModels('workbuddy-ai')
    })()
    // Refused, so the group stays hidden rather than serving a roster the token
    // cannot actually reach.
    expect(models).toEqual([])
  })
})
