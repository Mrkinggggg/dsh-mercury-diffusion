/**
 * Diffusion bridge for models served by another adapter's provider route, such
 * as a local OpenAI-compatible gateway.
 *
 * Those models are served by an adapter that never sends `diffusing`, so no
 * denoising frames exist to render. This bridge intercepts `llm/stream` for
 * candidate routes, asks the capability probe whether the upstream honors the
 * field at all, and only then re-issues the request itself with
 * `diffusing: true`. Every case the bridge cannot reproduce faithfully — an
 * unsupported route, images, files, auxiliary calls, unwatched Sessions — falls
 * through to the owning adapter's own stream untouched.
 */

import type { Context } from '@deepseek-ai/cordis'
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DiffusionCapability } from './capability.ts'
import { DEFAULT_KEY_ENV, resolveCredential } from './credentials.ts'
import type { DiffusionState } from './diffusion-state.ts'
import { providerError } from './errors.ts'
import type { DiffusionHub } from './frames.ts'
import type { BridgeRoute, DiffusionOutcome } from './shared.ts'
import { serialize } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type { WireRequest } from './wire-types.ts'

/**
 * Whether a request carries something the bridge cannot serialize faithfully.
 * Images and files are projected by the owning adapter, not by this one.
 * @param options - the assembled request.
 * @returns true when the request must keep the owning adapter's own stream.
 */
function hasAttachment(options: GenerateOptions): boolean {
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type === 'image' || block.type === 'file') return true
    }
  }
  return false
}

/**
 * Re-issue one bridged request in diffusing mode.
 * @param options - the assembled request being bridged.
 * @param route - the matching bridge route.
 * @param apiKey - credential resolved once for this attempt.
 * @param hub - frame fan-out shared with the adapter.
 * @param intervalMs - minimum spacing between published frames.
 * @param idleTimeoutMs - abort the attempt after this long without a provider event.
 * @returns the bridged chunk stream.
 */
async function* bridge(
  options: GenerateOptions,
  route: BridgeRoute,
  apiKey: string,
  hub: DiffusionHub,
  intervalMs: number,
  idleTimeoutMs: number,
): AsyncGenerator<StreamChunk> {
  // Sampling and effort vocabulary belong to the owning adapter's model catalog
  // (gateway levels such as `max`/`xhigh` are not Inception's); the bridge adds
  // only the diffusion flag and leaves their selection to that adapter.
  const sanitized: GenerateOptions = { ...options, reasoningEffort: undefined, temperature: undefined }
  const body: WireRequest = serialize(sanitized, { diffusing: true })
  const endpoint = `${route.baseURL.replace(/\/+$/u, '')}/chat/completions`
  const session = options.sessionId
  const attempt = session === undefined ? undefined : hub.open(session, options.model, intervalMs)
  const consumer = new AbortController()
  const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([consumer.signal, options.signal])
  // A gateway that accepts the connection and then says nothing would otherwise
  // hold the turn open forever; every provider event re-arms this deadline.
  let idle: ReturnType<typeof setTimeout> | undefined
  const rearm = (): void => {
    if (idle !== undefined) clearTimeout(idle)
    idle = setTimeout(() => { consumer.abort(new Error('provider idle timeout')) }, idleTimeoutMs)
  }
  rearm()
  let outcome: DiffusionOutcome = 'failed'
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: {
        ...attributionHeaders(),
        'content-type': 'application/json',
        'accept': 'text/event-stream',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const text = await response.text()
      let raw: unknown
      try { raw = JSON.parse(text) } catch (_nonJsonError) {
        // A gateway may answer with HTML or plain text; the status still classifies it.
      }
      throw providerError(raw, response.status, response.headers)
    }
    if (response.body === null) throw new LlmError('Mercury gateway returned no response body', 'EMPTY_RESPONSE')
    rearm()
    yield* translate(parseSse(response.body, rearm), attempt)
    outcome = 'completed'
  } catch (error) {
    if (options.signal?.aborted === true) throw new LlmError('Mercury bridge request aborted', 'ABORTED', { cause: error })
    if (error instanceof LlmError) throw error
    if (consumer.signal.aborted) throw new LlmError('Mercury bridge stream idle timeout', 'TIMEOUT', { cause: error })
    throw new LlmError('Mercury bridge transport failed', 'TRANSPORT', { cause: error })
  } finally {
    if (idle !== undefined) clearTimeout(idle)
    if (outcome !== 'completed' && options.signal?.aborted === true) outcome = 'aborted'
    attempt?.end(outcome)
    consumer.abort()
  }
}

/**
 * Run the bridge, and hand the request back to its owning adapter if the
 * gateway refuses it before any frame arrives — a route that does not forward
 * `diffusing` must not break conversations it cannot diffuse.
 * @param run - the bridge stream factory.
 * @param next - the owning adapter's own stream.
 * @returns the bridged stream, or the owning adapter's stream on early failure.
 */
function guarded(run: () => AsyncGenerator<StreamChunk>, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<StreamChunk> {
      const iterator = run()[Symbol.asyncIterator]()
      let started = false
      try {
        while (true) {
          const step = await iterator.next()
          if (step.done === true) return
          started = true
          yield step.value
        }
      } catch (error) {
        if (started) throw error
        // A route that refuses the field must not break the conversation: the
        // owning adapter answers instead, exactly as if the bridge were absent.
        yield* next()
      } finally {
        void iterator.return?.(undefined).catch((_abandonedDrain: unknown) => {})
      }
    },
  }
}

/**
 * Install the `llm/stream` interceptor for every bridge route. Routes are read
 * per request, so discovery can replace them without re-registering the hook.
 * @param ctx - plugin context.
 * @param routes - current bridge routes, including auto-discovered ones.
 * @param refresh - starts a discovery pass; called when no route matches, so a
 *   cold start recovers on the next request instead of never.
 * @param hub - frame fan-out shared with the bridge.
 * @param diffusion - per-model diffusion preference.
 * @param capability - probe results, cached per route and model.
 * @param frameIntervalMs - minimum spacing between published frames.
 * @param idleTimeoutMs - abort a bridged stream that goes silent for this long.
 */
export function applyBridge(
  ctx: Context,
  routes: () => readonly BridgeRoute[],
  refresh: () => void,
  hub: DiffusionHub,
  diffusion: DiffusionState,
  capability: DiffusionCapability,
  frameIntervalMs: number,
  idleTimeoutMs: number,
): void {
  ctx.on('llm/stream', (options, next) => {
    const route = routes().find(candidate => candidate.provider === options.provider)
    if (route === undefined) {
      // The provider directory may have settled after this plugin loaded.
      refresh()
      return next()
    }
    if (options.purpose !== undefined || options.sessionId === undefined) return next()
    if (!diffusion.isEnabled({ provider: options.provider, model: options.model }, false)) return next()
    if (!hub.watching(options.sessionId)) return next()
    if (hasAttachment(options)) return next()
    return guarded(() => bridged(ctx, options, route, hub, capability, frameIntervalMs, idleTimeoutMs), next)
  }, { global: true, prepend: true })
}

/**
 * Probe the route first, then bridge only when the upstream accepts the field.
 * A route that refuses it streams through its own adapter, unchanged.
 * @param ctx - plugin context (credential resolution).
 * @param options - the assembled request.
 * @param route - the matching candidate route.
 * @param hub - frame fan-out shared with the adapter.
 * @param capability - probe results, cached per route and model.
 * @param frameIntervalMs - minimum spacing between published frames.
 * @param idleTimeoutMs - abort a bridged stream that goes silent for this long.
 * @returns the bridged stream, or the owning adapter's stream when unsupported.
 */
async function* bridged(
  ctx: Context,
  options: GenerateOptions,
  route: BridgeRoute,
  hub: DiffusionHub,
  capability: DiffusionCapability,
  frameIntervalMs: number,
  idleTimeoutMs: number,
): AsyncGenerator<StreamChunk> {
  // One resolution serves both the probe and the re-issued request.
  const apiKey = await resolveCredential(ctx, route.apiKeyEnv.length > 0 ? route.apiKeyEnv : DEFAULT_KEY_ENV)
  if (apiKey === undefined) return
  const verdict = await capability.verdict({
    provider: route.provider,
    model: options.model,
    baseURL: route.baseURL,
    apiKey,
  })
  if (verdict !== 'yes') return
  yield* bridge(options, route, apiKey, hub, frameIntervalMs, idleTimeoutMs)
}
