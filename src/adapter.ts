/** Inception Mercury chat-completions adapter with one cancellable lifecycle per model request. */

import { assertUsableApiKey, attributionHeaders, LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { Config, MercuryModel } from './config.ts'
import { providerError } from './errors.ts'
import type { DiffusionAttempt, DiffusionHub } from './frames.ts'
import type { DiffusionOutcome } from './shared.ts'
import { serialize } from './serialize.ts'
import type { WireRequest } from './wire-types.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'

const IDLE_TIMEOUT_CODE = 'MERCURY_IDLE'

/** Adapter settings: validated config whose volatile fields are read per request. */
export type MercuryAdapterSettings = Readonly<Config>

/** Where a missing or unusable key is fixed, named in the AUTH failure. */
const KEY_REFERENCE = 'Plugins → dsh-mercury-diffusion → Configure, or INCEPTION_API_KEY'

/** Endpoint and credential captured once per request, so a save mid-stream cannot mix two settings. */
interface Connection {
  readonly endpoint: string
  readonly apiKey: string
}

function effortName(effort: string): string {
  return effort.length === 0 ? effort : effort[0]!.toUpperCase() + effort.slice(1)
}

/**
 * Mercury provider. A request whose Session has a watching Web Client asks for
 * `diffusing` and publishes its denoising frames through the hub; every other
 * request streams ordinary deltas.
 */
export class MercuryAdapter extends LlmAdapter {
  private readonly settings: MercuryAdapterSettings
  private readonly hub: DiffusionHub

  /**
   * @param settings - validated configuration whose `apiKey` is already checked.
   * @param hub - viewer registry and frame fan-out for diffusing requests.
   */
  constructor(settings: MercuryAdapterSettings, hub: DiffusionHub) {
    super()
    this.settings = settings
    this.hub = hub
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.settings.providerName }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.settings.models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: ['text'] }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const entry = this.model(model)
    if (entry === undefined) return { provider, id: model, name: model, inputModalities: ['text'] }
    return {
      provider, id: entry.id, name: entry.name, inputModalities: ['text'],
      context: { contextWindow: entry.contextWindow },
      ...entry.reasoningEfforts.length === 0 ? {} : {
        reasoning: {
          efforts: entry.reasoningEfforts.map(effort => ({ id: ReasoningEffortId(effort), name: effortName(effort) })),
          ...entry.defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(entry.defaultEffort) },
        },
      },
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generate(options)
  }

  private model(id: string): MercuryModel | undefined {
    return this.settings.models.find(model => model.id === id)
  }

  /** Diffuse only loop requests whose Session someone is watching; auxiliary calls have no viewer. */
  private diffuses(options: GenerateOptions): boolean {
    return this.settings.diffusing.get()
      && options.purpose === undefined
      && options.sessionId !== undefined
      && this.hub.watching(options.sessionId)
  }

  private connection(): Connection {
    const key = this.settings.apiKey.get()
    if (key === undefined) throw new LlmError(`dsh-mercury-diffusion: no API key is set; set it in ${KEY_REFERENCE}`, 'AUTH')
    return {
      endpoint: `${this.settings.baseURL.get().replace(/\/+$/u, '')}/chat/completions`,
      apiKey: assertUsableApiKey(key, 'dsh-mercury-diffusion', KEY_REFERENCE),
    }
  }

  private async * generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const connection = this.connection()
    const diffusing = this.diffuses(options)
    const body = serialize(options, this.model(options.model), { diffusing })
    const attempt = diffusing && options.sessionId !== undefined
      ? this.hub.open(options.sessionId, options.model, this.settings.frameIntervalMs)
      : undefined
    const consumer = new AbortController()
    const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([consumer.signal, options.signal])
    using watchdog = idleWatchdog(signal, this.settings.streamIdleTimeoutMs, IDLE_TIMEOUT_CODE)
    const iterator = this.request(connection, body, watchdog.signal, () => { watchdog.pulse() }, attempt)
    let outcome: DiffusionOutcome = 'failed'
    try {
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) break
        yield next.value
      }
      outcome = 'completed'
    } catch (error) {
      if (timeoutOf(watchdog.signal, IDLE_TIMEOUT_CODE) !== undefined) throw new LlmError('Mercury stream idle timeout', 'TIMEOUT', { cause: error })
      if (options.signal?.aborted === true) throw new LlmError('Mercury request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('Mercury transport failed', 'TRANSPORT', { cause: error })
    } finally {
      if (outcome !== 'completed' && options.signal?.aborted === true) outcome = 'aborted'
      attempt?.end(outcome)
      consumer.abort()
      // The abort above tears the socket down; awaiting the drain could hang on a demand the deadline abandoned.
      void iterator.return(undefined).catch((_abandonedDrain: unknown) => {})
    }
  }

  private async * request(
    connection: Connection,
    body: WireRequest,
    signal: AbortSignal,
    activity: () => void,
    attempt: DiffusionAttempt | undefined,
  ): AsyncGenerator<StreamChunk> {
    signal.throwIfAborted()
    const response = await fetch(connection.endpoint, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: {
        ...attributionHeaders(),
        'content-type': 'application/json',
        'accept': 'text/event-stream',
        'authorization': `Bearer ${connection.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      let raw: unknown
      try { raw = JSON.parse(text) } catch (_nonJsonError) {
        // A gateway may answer with HTML or plain text; the HTTP status still classifies the failure.
      }
      throw providerError(raw, response.status, response.headers)
    }
    if (response.body === null) throw new LlmError('Mercury returned no response body', 'EMPTY_RESPONSE')
    activity()
    yield* translate(parseSse(response.body, activity), attempt)
  }
}
