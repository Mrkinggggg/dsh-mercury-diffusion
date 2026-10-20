/** Validated cordis.yml configuration for the Mercury adapter and its diffusion frames route. */

import Schema from '@deepseek-ai/schemastery'

/** One Mercury chat model this route advertises and resolves. */
export interface MercuryModel {
  /** Provider model id sent as `model`. */
  id: string
  /** Display name for model selectors. */
  name: string
  /** Combined request and response context in tokens. */
  contextWindow: number
  /** Provider maximum for `max_completion_tokens`. */
  maxTokens: number
  /** Accepted `reasoning_effort` values from least to greatest effort; empty when the model takes none. */
  reasoningEfforts: string[]
  /** Effort materialized when a caller selects none; absent keeps the provider default. */
  defaultEffort?: string
}

const MercuryModel: Schema<MercuryModel> = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  contextWindow: Schema.natural().min(1).required(),
  maxTokens: Schema.natural().min(1).required(),
  reasoningEfforts: Schema.array(Schema.string()).default([]),
  defaultEffort: Schema.string(),
})

/** Models listed on https://docs.inceptionlabs.ai/get-started/models for `/v1/chat/completions`. */
const DEFAULT_MODELS: MercuryModel[] = [
  { id: 'mercury-3', name: 'Mercury 3', contextWindow: 1_000_000, maxTokens: 131_072, reasoningEfforts: ['instant', 'low', 'medium', 'high'] },
  { id: 'mercury-2.5', name: 'Mercury 2.5', contextWindow: 260_000, maxTokens: 65_536, reasoningEfforts: ['instant', 'low', 'medium', 'high'] },
  { id: 'mercury-2', name: 'Mercury 2', contextWindow: 128_000, maxTokens: 50_000, reasoningEfforts: ['instant', 'low', 'medium', 'high'] },
]

/**
 * The key's schema default. A profile override restates the row's whole
 * config, so a fallback written in the bundle patch would vanish as soon as any
 * field is saved from the Plugins page; a schema default survives it. `.env`
 * layers are part of the launch environment, loaded before plugins import.
 */
const envKey = process.env.INCEPTION_API_KEY
const ApiKey = envKey === undefined || envKey.trim().length === 0
  ? Schema.string().role('secret')
  : Schema.string().role('secret').default(envKey)

/**
 * Schema validated by Cordis when the plugin loads. Volatile fields are the
 * ones the Plugins page edits: a save updates their references in place
 * without remounting the plugin, so the adapter reads them per request.
 * The key is optional at load so the plugin stays active, and its page
 * reachable, before a key exists; requests fail with `AUTH` until one is set.
 */
export const Config = Schema.object({
  /** Inception API key sent as a Bearer token. */
  apiKey: ApiKey.volatile().description('Inception API key; defaults to INCEPTION_API_KEY.'),
  /** API root that serves `/chat/completions`. */
  baseURL: Schema.string().default('https://api.inceptionlabs.ai/v1').volatile(),
  /** Request `diffusing: true` while a Web Client is watching the requesting Session. */
  diffusing: Schema.boolean().default(true).volatile(),
  /** Provider route registered with `ctx.llm`. */
  provider: Schema.string().default('mercury'),
  /** Provider display name for selectors. */
  providerName: Schema.string().default('Inception Mercury'),
  /** Advertised models in selector order. */
  models: Schema.array(MercuryModel).default(DEFAULT_MODELS),
  /**
   * Minimum spacing between frames published to viewers; the newest skipped
   * frame is sent when the interval elapses or the attempt ends. Mercury sends
   * few frames per answer, often in bursts, so the default forwards every one
   * and the browser paces playback.
   */
  frameIntervalMs: Schema.natural().default(0),
  /** Abort a provider stream that delivers no SSE event for this long. */
  streamIdleTimeoutMs: Schema.natural().min(1).default(300_000),
  /** Comment written to each open frames stream at this interval so proxies keep it open. */
  heartbeatMs: Schema.natural().min(1).default(15_000),
})

/** Plugin configuration after schema defaults; volatile fields are live references. */
export type Config = ReturnType<typeof Config>

/**
 * Reject model lists the schema cannot express: duplicate ids, duplicate
 * efforts, and a default effort the model does not accept.
 * @param models - validated model rows.
 * @throws {Error} naming the first offending model.
 */
export function assertModels(models: readonly MercuryModel[]): void {
  if (models.length === 0) throw new Error('mercury-diffusion: models must list at least one model')
  const ids = new Set<string>()
  for (const model of models) {
    if (ids.has(model.id)) throw new Error(`mercury-diffusion: model "${model.id}" is listed twice`)
    ids.add(model.id)
    if (new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length) {
      throw new Error(`mercury-diffusion: model "${model.id}" repeats a reasoning effort`)
    }
    if (model.defaultEffort !== undefined && !model.reasoningEfforts.includes(model.defaultEffort)) {
      throw new Error(`mercury-diffusion: model "${model.id}" defaultEffort "${model.defaultEffort}" is not one of its reasoningEfforts`)
    }
  }
}
