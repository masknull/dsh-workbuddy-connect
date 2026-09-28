import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKBUDDY_DATA_DIR_ENV, WorkBuddyCredentialStore, parseWorkBuddyAuth } from '../src/auth.ts'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS, WorkBuddyCatalog } from '../src/catalog.ts'
import { AI_VARIANT, CN_VARIANT, variantFor, WORKBUDDY_VARIANTS } from '../src/variants.ts'
import { modelWithCurrentPromotion, parseModelCatalog, prepareInternationalChatBody, WorkBuddyUpstreamClient } from '../src/upstream.ts'

/**
 * The two-variant contract. Both products repeat several model ids and each
 * keeps its own credential file, so these tests cover the three ways that can
 * go wrong: a credential crossing products, one variant's models answering for
 * the other, and a promotion outliving its window.
 */

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of CLEANUP.splice(0)) await dispose()
  vi.unstubAllEnvs()
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wb-variants-'))
  CLEANUP.push(() => rm(root, { recursive: true, force: true }))
  return root
}

/** A credential document for one region, in the plugin's stored layout. */
function credentialDocument(domain: string, accessToken = 'at'): string {
  return JSON.stringify({
    auth: { accessToken, refreshToken: 'rt', expiresAt: Date.now() + 3_600_000, domain },
    account: { uid: 'uid-1', nickname: 'nick', enterpriseId: 'ent-1' },
  })
}

/** Every variant's own credential path under a temp root, named as the variant says. */
function ownPathIn(root: string, variant: typeof CN_VARIANT): string {
  return join(root, variant.ownFilename)
}

function storeFor(root: string, variant: typeof CN_VARIANT): WorkBuddyCredentialStore {
  return new WorkBuddyCredentialStore({
    variant,
    ownPath: ownPathIn(root, variant),
    refresh: async credential => ({ accessToken: credential.accessToken }),
  })
}

describe('variant descriptors', () => {
  it('keeps the CN provider byte-identical to its historical identity', () => {
    // Existing installs, settings files, and status paths must not move.
    expect(CN_VARIANT.id).toBe('workbuddy')
    expect(CN_VARIANT.displayName).toBe('WorkBuddy')
    expect(CN_VARIANT.ownFilename).toBe('.workbuddy-auth.json')
    expect(CN_VARIANT.probeFilename).toBe('.workbuddy-probe.json')
    expect(CN_VARIANT.statusPath).toBe('/plugins/dsh-workbuddy-connect/status')
    expect(CN_VARIANT.probePath).toBe('/plugins/dsh-workbuddy-connect/probe')
    expect(CN_VARIANT.loginPath).toBe('/plugins/dsh-workbuddy-connect/login')
  })

  it('gives the AI variant its own files, routes, and sign-in path', () => {
    expect(AI_VARIANT.id).toBe('workbuddy-ai')
    expect(AI_VARIANT.displayName).toBe('WorkBuddy AI')
    expect(AI_VARIANT.region).toBe('global')
    expect(AI_VARIANT.ownFilename).toBe('.workbuddy-ai-auth.json')
    expect(AI_VARIANT.probeFilename).toBe('.workbuddy-ai-probe.json')
    expect(AI_VARIANT.statusPath).toBe('/plugins/dsh-workbuddy-connect/ai/status')
    expect(AI_VARIANT.probePath).toBe('/plugins/dsh-workbuddy-connect/ai/probe')
    expect(AI_VARIANT.loginPath).toBe('/plugins/dsh-workbuddy-connect/ai/login')
  })

  it('shares no file, route, or login path between the two', () => {
    // A shared credential or probe file would let one product's state answer
    // for the other; a shared route would cross the cards.
    for (const field of ['id', 'appName', 'region', 'ownFilename', 'probeFilename', 'catalogFilename', 'statusPath', 'probePath', 'loginPath'] as const) {
      const values = WORKBUDDY_VARIANTS.map(variant => variant[field])
      expect(new Set(values).size, `${field} must differ between variants`).toBe(values.length)
    }
  })

  it('resolves a variant by provider id and nothing else', () => {
    expect(variantFor('workbuddy')).toBe(CN_VARIANT)
    expect(variantFor('workbuddy-ai')).toBe(AI_VARIANT)
    expect(variantFor('workbuddy-ai-2')).toBeUndefined()
    expect(variantFor('')).toBeUndefined()
  })
})

describe('credential region separation', () => {
  it('refuses a CN credential offered to the international provider', async () => {
    const root = await tempDir()
    const store = storeFor(root, AI_VARIANT)
    await writeFile(store.ownAuthPath(), credentialDocument('copilot.tencent.com'))

    // Sending a CN token to the international endpoint would leak it across
    // products, so this is a refusal, not a fallback.
    await expect(store.current()).rejects.toThrow(/WorkBuddy \(CN\)/)
    await expect(store.current()).rejects.toThrow(new RegExp(AI_VARIANT.ownFilename.replaceAll('.', String.raw`\.`)))
  })

  it('refuses an international credential offered to the CN provider', async () => {
    const root = await tempDir()
    const store = storeFor(root, CN_VARIANT)
    await writeFile(store.ownAuthPath(), credentialDocument('www.workbuddy.ai'))
    await expect(store.current()).rejects.toThrow(/WorkBuddy AI/)
  })

  it('accepts the credential belonging to its own variant', async () => {
    const root = await tempDir()
    const ai = storeFor(root, AI_VARIANT)
    await writeFile(ai.ownAuthPath(), credentialDocument('www.workbuddy.ai'))
    await expect(ai.current()).resolves.toMatchObject({ domain: 'www.workbuddy.ai', uid: 'uid-1' })

    const cn = storeFor(root, CN_VARIANT)
    await writeFile(cn.ownAuthPath(), credentialDocument('copilot.tencent.com'))
    await expect(cn.current()).resolves.toMatchObject({ domain: 'copilot.tencent.com' })
  })

  it('reports a mismatch as a diagnosable reason rather than a silent sign-out', async () => {
    const root = await tempDir()
    const store = storeFor(root, AI_VARIANT)
    await writeFile(store.ownAuthPath(), credentialDocument('copilot.tencent.com'))
    const status = await store.status()
    expect(status.state).toBe('signed-out')
    // The card renders this string, so it must name the fix.
    expect(status.reason).toMatch(/WorkBuddy \(CN\)/)
    expect(status.reason).toMatch(new RegExp(AI_VARIANT.ownFilename.replaceAll('.', String.raw`\.`)))
  })

  it('refuses to save a credential belonging to the other product', async () => {
    const root = await tempDir()
    const store = storeFor(root, AI_VARIANT)
    await expect(store.save({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAtMs: Date.now() + 3_600_000,
      domain: 'copilot.tencent.com',
      uid: 'uid-1',
      source: 'login',
    })).rejects.toThrow(/refusing to store a WorkBuddy \(CN\) credential/)
    // Nothing was written for the mismatch.
    await expect(store.current()).resolves.toBeUndefined()
  })

  it('persists a credential saved for its own product', async () => {
    const root = await tempDir()
    const store = storeFor(root, CN_VARIANT)
    await store.save({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAtMs: Date.now() + 3_600_000,
      domain: 'copilot.tencent.com',
      uid: 'uid-1',
      nickname: 'nick',
      source: 'login',
    })
    await expect(store.current()).resolves.toMatchObject({
      accessToken: 'at',
      domain: 'copilot.tencent.com',
      uid: 'uid-1',
      source: 'login',
    })
    // A reload of the same file by a fresh store keeps the credential.
    await expect(storeFor(root, CN_VARIANT).current()).resolves.toMatchObject({ accessToken: 'at' })
  })

  it('reads only its own credential file', async () => {
    const root = await tempDir()
    const cn = storeFor(root, CN_VARIANT)
    await writeFile(cn.ownAuthPath(), credentialDocument('copilot.tencent.com'))
    // The international variant has its own file, still empty.
    await expect(storeFor(root, AI_VARIANT).current()).resolves.toBeUndefined()
    await expect(cn.current()).resolves.toMatchObject({ domain: 'copilot.tencent.com' })
  })

  it('own copies and diagnostics do not collide between variants', async () => {
    const root = await tempDir()
    vi.stubEnv('DSH_HOME', root)
    // The default path is the plugin's per-profile data folder; point that at the
    // temp root so this spec asserts the default layout without touching a real one.
    vi.stubEnv(WORKBUDDY_DATA_DIR_ENV, root)
    const cn = new WorkBuddyCredentialStore({ variant: CN_VARIANT, refresh: async c => ({ accessToken: c.accessToken }) })
    const ai = new WorkBuddyCredentialStore({ variant: AI_VARIANT, refresh: async c => ({ accessToken: c.accessToken }) })
    expect(cn.ownAuthPath()).toBe(join(root, CN_VARIANT.ownFilename))
    expect(ai.ownAuthPath()).toBe(join(root, AI_VARIANT.ownFilename))
    expect(cn.ownAuthPath()).not.toBe(ai.ownAuthPath())

    // logout removes only its own copy.
    await writeFile(ai.ownAuthPath(), '{}')
    await cn.logout()
    await expect(readFile(ai.ownAuthPath(), 'utf8')).resolves.toBe('{}')
  })
})

describe('catalog visibility and separation', () => {
  it('hides every model when the variant has no credential', () => {
    const catalog = new WorkBuddyCatalog(FALLBACK_WORKBUDDY_MODELS)
    expect(catalog.current().length).toBeGreaterThan(0)
    expect(catalog.setVisible(false)).toBe(true)
    // An empty list is how DSH drops the model group: the provider stays
    // registered, so a later sign-in needs no restart.
    expect(catalog.current()).toEqual([])
    // Idempotent: the caller uses the return value to decide on an invalidation.
    expect(catalog.setVisible(false)).toBe(false)
    expect(catalog.setVisible(true)).toBe(true)
    expect(catalog.current().length).toBeGreaterThan(0)
    expect(catalog.setVisible(true)).toBe(false)
  })

  it('keeps the fallback roster available behind the visibility gate', () => {
    const catalog = new WorkBuddyCatalog(FALLBACK_WORKBUDDY_AI_MODELS)
    catalog.setVisible(false)
    // The roster survives hiding, so becoming visible again serves it without a
    // re-fetch.
    expect(catalog.fallback()).toHaveLength(FALLBACK_WORKBUDDY_AI_MODELS.length)
  })

  it('gives each variant its own roster', () => {
    const cn = FALLBACK_WORKBUDDY_MODELS.map(model => model.id)
    const ai = FALLBACK_WORKBUDDY_AI_MODELS.map(model => model.id)
    expect(ai).toHaveLength(20)
    expect(cn).toHaveLength(16)
    expect(cn).toContain('deepseek-v4.1-flash')
    expect(cn).toContain('kimi-k2.8-preview')
    expect(cn).not.toContain('deepseek-v4-flash')
    expect(cn).toEqual([
      'auto', 'hy4-preview', 'hy3', 'hy3-x', 'deepseek-v4.1-flash', 'glm-5.3',
      'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5v-turbo', 'kimi-k3-1',
      'kimi-k2.8-preview', 'kimi-k2.7', 'kimi-k2.6', 'minimax-m3', 'deepseek-v4-pro',
    ])
    // International-only models must not appear in the CN roster, and vice
    // versa: the same id would otherwise carry the wrong rate and window.
    expect(ai).toContain('gpt-5.6-luna')
    expect(ai).not.toContain('minimax-m3')
    expect(cn).not.toContain('gpt-5.6-luna')
    expect(cn).not.toContain('hy4-preview-f')
  })

  it('bakes no promo badge into the international fallback', () => {
    // Promotions are time-boxed; a static "free" flag would outlive the offer.
    for (const model of FALLBACK_WORKBUDDY_AI_MODELS) {
      expect(model.billing?.badges, `${model.id} must not carry a baked-in badge`).toBeUndefined()
    }
  })
})

describe('international catalog parsing', () => {
  const document = {
    models: [
      { id: 'hy3', name: 'Hy3', maxInputTokens: 1000, maxOutputTokens: 100, credits: 'x0.00', supportsImages: true, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: 'high', summary: 'auto' } },
      { id: 'ctx-model', name: 'Ctx', maxInputTokens: 1_000_000, maxOutputTokens: 100, credits: 'x1.00', contextWindow: { defaultLength: 300_000, supportedLengths: [300_000, 1_000_000] } },
      { id: 'not-in-cli', name: 'Excluded', maxInputTokens: 1000, maxOutputTokens: 100 },
    ],
    agents: [{ name: 'cli', models: ['hy3', 'ctx-model'] }],
    modelPromotions: [{
      enabled: true,
      modelIds: ['hy3'],
      priority: 200,
      schedule: { validFrom: '2026-07-06T00:00:00+08:00', validUntil: '2026-09-30T00:00:00+08:00' },
      discount: { displayMode: 'replace', factor: 0 },
      badge: { label: 'Free now' },
    }],
  }

  it('follows the cli roster order and excludes models outside it', () => {
    const models = parseModelCatalog(document, true)
    expect(models.map(model => model.id)).toEqual(['hy3', 'ctx-model'])
  })

  it('uses the declared default window, not the maximum input ceiling', () => {
    const [, ctx] = parseModelCatalog(document, true)
    // The 1M value is what the upstream would accept; 300K is the budget the
    // plugin actually requests under. Reporting the ceiling as the window would
    // overstate the budget.
    expect(ctx!.contextWindow).toBe(300_000)
    expect(ctx!.defaultContextWindow).toBe(300_000)
    expect(ctx!.maxInputTokens).toBe(1_000_000)
    expect(ctx!.supportedContextWindows).toEqual([300_000, 1_000_000])
  })

  it('can switch an international catalog to its declared maximum windows', () => {
    const catalog = new WorkBuddyCatalog(FALLBACK_WORKBUDDY_AI_MODELS)
    expect(catalog.current().find(model => model.id === 'deepseek-v4.1-flash')?.contextWindow).toBe(300_000)
    expect(catalog.setUseMaximumContextWindow(true)).toBe(true)
    expect(catalog.current().find(model => model.id === 'deepseek-v4.1-flash')?.contextWindow).toBe(1_000_000)
    expect(catalog.current().find(model => model.id === 'gpt-5.6-sol')?.contextWindow).toBe(1_000_000)

    const legacyCatalog = new WorkBuddyCatalog([{
      id: 'legacy', name: 'Legacy', contextWindow: 300_000,
      supportedContextWindows: [300_000, 1_000_000], maxTokens: 1, supportsImages: false,
    }])
    legacyCatalog.setUseMaximumContextWindow(true)
    expect(legacyCatalog.current()[0]).toMatchObject({ contextWindow: 1_000_000, defaultContextWindow: 300_000 })
  })

  it('does not attach international fields to the CN shape', () => {
    const [cn] = parseModelCatalog(document, false)
    expect(cn).toEqual({
      id: 'hy3',
      name: 'Hy3',
      contextWindow: 1000,
      maxTokens: 100,
      supportsImages: true,
      reasoning: { supports: true, onlyReasoning: true, defaultEffort: 'high', canDisableThinking: false },
      billing: { credits: 'x0.00', free: true },
    })
  })

  it('rejects a document with no cli roster rather than serving a partial list', () => {
    // The international App document's empty-shell form must never be read as a
    // successful (empty) catalog.
    expect(() => parseModelCatalog({ models: [], agents: [] }, true)).toThrow(/cli agent/)
    expect(() => parseModelCatalog({ productFeatures: {} }, true)).toThrow(/cli agent/)
  })

  it('parses a bare international document that omits the {code,msg,data} wrapper', async () => {
    // The reviewer reproduced an international answer with NO envelope at all:
    // the product document arrived bare at the top level. readEnvelope treats
    // a missing `data` as `{}`, which turned that into a spurious "no cli agent
    // models". The client must accept a bare catalog body as the answer itself.
    const bare = JSON.stringify({
      models: document.models,
      agents: document.agents,
      modelPromotions: document.modelPromotions,
    })
    let headers: Record<string, string> | undefined
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers as Record<string, string> | undefined
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(bare),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', request)
    const resolver = vi.fn(async () => ({ version: '5.5.2', source: 'fallback' as const }))
    const client = new WorkBuddyUpstreamClient({
      resolveAppVersion: resolver,
    })
    const models = await client.fetchModels({
      accessToken: 'at', refreshToken: 'rt', expiresAtMs: 0,
      domain: 'www.workbuddy.ai', uid: 'uid', source: 'login',
    })
    expect(models.map(model => model.id)).toEqual(['hy3', 'ctx-model'])
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(headers?.['User-Agent']).toBe('WorkBuddyAI/5.5.2')
    vi.unstubAllGlobals()
  })

  it('still rejects a body that is neither wrapped nor a catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ unrelated: true })),
    } as unknown as Response)))
    const client = new WorkBuddyUpstreamClient({
      resolveAppVersion: async () => ({ version: '5.5.2', source: 'fallback' }),
    })
    await expect(client.fetchModels({
      accessToken: 'at', refreshToken: 'rt', expiresAtMs: 0,
      domain: 'www.workbuddy.ai', uid: 'uid', source: 'login',
    })).rejects.toThrow(/cli agent/)
    vi.unstubAllGlobals()
  })
})

describe('promotion lifetime', () => {
  const base = {
    id: 'hy3',
    name: 'Hy3',
    contextWindow: 1000,
    maxTokens: 100,
    supportsImages: false,
    billing: { credits: 'x0.50', free: false },
    promotions: [{
      start: Date.parse('2026-07-06T00:00:00+08:00'),
      end: Date.parse('2026-09-30T00:00:00+08:00'),
      label: 'Free now',
      factor: 0,
      priority: 200,
    }],
  }

  it('applies an active promotion', () => {
    const model = modelWithCurrentPromotion(base, Date.parse('2026-08-01T00:00:00+08:00'))
    expect(model.billing).toEqual({ credits: 'x0.00', free: true, badges: ['Free now'] })
  })

  it('withholds the rate once the window has closed', () => {
    // The catalog is cached for the process's life, and the upstream bakes the
    // DISCOUNTED value into the row's own `credits` field — so once the window
    // closes, neither the cached figure nor `free` can be repeated. The original
    // price is not recoverable from the row, so the honest answer is "unknown,
    // refresh": reverting to the cached `x0.50` would state a price that was
    // never the real one, and keeping `free` would advertise the ended offer.
    // The lapsed rate rides along in `credits` with the promotion's label under
    // `expiredPromotions`, so the settings card can show what the price WAS —
    // `rateUnknown` is what stops every other surface from quoting it as current.
    const model = modelWithCurrentPromotion(base, Date.parse('2026-10-01T00:00:00+08:00'))
    expect(model.billing).toEqual({ free: false, rateUnknown: true, credits: 'x0.50', expiredPromotions: ['Free now'] })
  })

  it('withholds the rate before the window opens', () => {
    const model = modelWithCurrentPromotion(base, Date.parse('2026-01-01T00:00:00+08:00'))
    expect(model.billing).toEqual({ free: false, rateUnknown: true, credits: 'x0.50', expiredPromotions: ['Free now'] })
  })

  it('still states a rate for a row that never had a promotion', () => {
    // The withholding is scoped to rows whose price derives from a promotion;
    // an ordinary row keeps reporting what the upstream said.
    const plain = {
      id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000, maxTokens: 100,
      supportsImages: true, billing: { credits: 'x0.79', free: false },
    }
    expect(modelWithCurrentPromotion(plain, Date.parse('2026-10-01T00:00:00+08:00'))).toBe(plain)
  })

  it('does not withhold the rate after a promo that equals the list price ends', () => {
    // A factor of exactly 1 changes nothing, so the row's own rate is still the
    // real price and there is nothing to withhold.
    const neutral = { ...base, promotions: [{ ...base.promotions[0]!, factor: 1 }] }
    const model = modelWithCurrentPromotion(neutral, Date.parse('2026-10-01T00:00:00+08:00'))
    expect(model.billing?.credits).toBe('x0.50')
    expect(model.billing?.rateUnknown).toBeUndefined()
  })

  it('scales a non-zero discount factor against the base rate', () => {
    const model = modelWithCurrentPromotion(
      { ...base, promotions: [{ ...base.promotions[0]!, factor: 0.5, label: 'Half off' }] },
      Date.parse('2026-08-01T00:00:00+08:00'),
    )
    expect(model.billing?.credits).toBe('x0.25')
    expect(model.billing?.free).toBe(false)
  })

  it('leaves a model with no promotions untouched', () => {
    const plain = { id: 'x', name: 'X', contextWindow: 1, maxTokens: 1, supportsImages: false, billing: { credits: 'x1.00', free: false } }
    expect(modelWithCurrentPromotion(plain, Date.now())).toBe(plain)
  })

  it('skips a scaling discount when the base rate is unparseable', () => {
    // The international Auto row carries an empty credits string. A factor of 0
    // is still meaningful there; a multiplier is not, so it is skipped rather
    // than invented.
    const auto = { id: 'default-model', name: 'Auto', contextWindow: 1, maxTokens: 1, supportsImages: false, billing: { credits: '', free: false }, promotions: base.promotions }
    expect(modelWithCurrentPromotion(auto, Date.parse('2026-08-01T00:00:00+08:00')).billing?.credits).toBe('x0.00')
    const scaledInput = {
      ...auto,
      promotions: [{ ...base.promotions[0]!, factor: 2 }],
    }
    expect(modelWithCurrentPromotion(scaledInput, Date.parse('2026-08-01T00:00:00+08:00'))).toBe(scaledInput)
  })
})

describe('prepareInternationalChatBody', () => {
  it('prepends a system message when the first message is not one', () => {
    const body = JSON.parse(prepareInternationalChatBody(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })))
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('keeps user content, order, and count intact', () => {
    const body = JSON.parse(prepareInternationalChatBody(JSON.stringify({
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
    })))
    expect(body.messages.map((message: { content: string }) => message.content)).toEqual(['You are a helpful assistant.', 'a', 'b', 'c'])
  })

  it('leaves a body that already starts with system alone', () => {
    const input = JSON.stringify({ messages: [{ role: 'system', content: 'custom' }, { role: 'user', content: 'hi' }] })
    const body = JSON.parse(prepareInternationalChatBody(input))
    expect(body.messages[0].content).toBe('custom')
    expect(body.messages).toHaveLength(2)
  })

  it('still rewrites developer to system and forces streaming', () => {
    const body = JSON.parse(prepareInternationalChatBody(JSON.stringify({
      stream: false,
      messages: [{ role: 'developer', content: 'sys' }, { role: 'user', content: 'hi' }],
    })))
    expect(body.stream).toBe(true)
    expect(body.messages[0].role).toBe('system')
    // The developer rewrite already made the first message a system one, so no
    // extra prompt is added.
    expect(body.messages).toHaveLength(2)
  })

  it('returns unparseable input unchanged instead of throwing', () => {
    // Regression: this used to JSON.parse() prepareChatBody's output, which
    // passes non-JSON straight through — so any non-JSON body crashed the chat
    // path with a SyntaxError rather than reaching the upstream's own error.
    expect(prepareInternationalChatBody('not json')).toBe('not json')
    expect(prepareInternationalChatBody('')).toBe('')
    expect(prepareInternationalChatBody('[1,2,3]')).toBe('[1,2,3]')
    expect(prepareInternationalChatBody('"a string"')).toBe('"a string"')
  })

  it('handles a JSON object with no messages array', () => {
    // The normalized body also carries the streaming usage request, which the
    // official client always sends.
    expect(JSON.parse(prepareInternationalChatBody('{"model":"x"}')))
      .toEqual({ model: 'x', stream: true, stream_options: { include_usage: true } })
    expect(JSON.parse(prepareInternationalChatBody('{"messages":null}')).messages).toBeNull()
  })
})

describe('parseWorkBuddyAuth stays shape-compatible across products', () => {
  it('parses both products with one parser', () => {
    // The international desktop document is structurally identical to the CN
    // one; only the domain differs, which is what routes the base URL.
    const ai = parseWorkBuddyAuth(credentialDocument('www.workbuddy.ai'))
    const cn = parseWorkBuddyAuth(credentialDocument('copilot.tencent.com'))
    expect(ai?.domain).toBe('www.workbuddy.ai')
    expect(cn?.domain).toBe('copilot.tencent.com')
    expect(ai?.uid).toBe(cn?.uid)
  })
})
