/** SSE framing and wire validation for Inception chat-completion chunks. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { providerError } from './errors.ts'

/** Provider stop reasons in `choices[0].finish_reason`. */
export type WireFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter'

/** Token accounting from the final `include_usage` chunk. */
export interface WireUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
  readonly cachedTokens: number
  readonly reasoningTokens: number
}

/** One function-call fragment keyed by its position in the response. */
export interface WireToolCallDelta {
  readonly index: number
  readonly id?: string
  readonly name?: string
  readonly arguments?: string
}

/** Validated fields of one chunk; only the first choice is read because requests never set `n`. */
export interface WireChunk {
  /** Delta text in normal mode, complete current text in diffusing mode. */
  readonly content?: string
  readonly toolCalls: readonly WireToolCallDelta[]
  readonly finishReason?: WireFinishReason
  readonly usage?: WireUsage
}

/** One decoded stream event: a chunk, or the `[DONE]` terminator. */
export type WireEvent = { readonly kind: 'chunk'; readonly chunk: WireChunk } | { readonly kind: 'done' }

const FINISH_REASONS = new Set<string>(['stop', 'length', 'tool_calls', 'content_filter'])

function malformed(what: string): never {
  throw new LlmError(`Mercury stream chunk has malformed ${what}`, 'MALFORMED_RESPONSE')
}

function record(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return malformed(what)
  return raw as Record<string, unknown>
}

function optionalString(raw: unknown, what: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  return typeof raw === 'string' ? raw : malformed(what)
}

function count(raw: unknown, what: string): number {
  if (raw === undefined || raw === null) return 0
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : malformed(what)
}

function readUsage(raw: unknown): WireUsage | undefined {
  if (raw === undefined || raw === null) return undefined
  const usage = record(raw, 'usage')
  const prompt = usage.prompt_tokens_details == null ? {} : record(usage.prompt_tokens_details, 'usage.prompt_tokens_details')
  const completion = usage.completion_tokens_details == null ? {} : record(usage.completion_tokens_details, 'usage.completion_tokens_details')
  return {
    promptTokens: count(usage.prompt_tokens, 'usage.prompt_tokens'),
    completionTokens: count(usage.completion_tokens, 'usage.completion_tokens'),
    totalTokens: count(usage.total_tokens, 'usage.total_tokens'),
    cachedTokens: count(prompt.cached_tokens, 'usage.prompt_tokens_details.cached_tokens'),
    reasoningTokens: count(completion.reasoning_tokens, 'usage.completion_tokens_details.reasoning_tokens'),
  }
}

function readToolCalls(raw: unknown): WireToolCallDelta[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return malformed('delta.tool_calls')
  return raw.map((entry: unknown, position): WireToolCallDelta => {
    const call = record(entry, 'delta.tool_calls entry')
    const fn = call.function == null ? {} : record(call.function, 'delta.tool_calls.function')
    const index = call.index == null ? position : call.index
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return malformed('delta.tool_calls.index')
    const id = optionalString(call.id, 'delta.tool_calls.id')
    const name = optionalString(fn.name, 'delta.tool_calls.function.name')
    const args = optionalString(fn.arguments, 'delta.tool_calls.function.arguments')
    return {
      index,
      ...id === undefined ? {} : { id },
      ...name === undefined ? {} : { name },
      ...args === undefined ? {} : { arguments: args },
    }
  })
}

/**
 * Validate one decoded chunk payload.
 * @param raw - JSON-decoded SSE data.
 * @returns the fields the translator reads.
 * @throws {LlmError} the classified provider failure for an in-band `error` object, otherwise `MALFORMED_RESPONSE`.
 */
export function readChunk(raw: unknown): WireChunk {
  const chunk = record(raw, 'payload')
  if (chunk.error !== undefined) throw providerError(chunk, undefined)
  const usage = readUsage(chunk.usage)
  if (chunk.choices !== undefined && !Array.isArray(chunk.choices)) return malformed('choices')
  const first: unknown = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
  if (first === undefined) return { toolCalls: [], ...usage === undefined ? {} : { usage } }
  const choice = record(first, 'choices[0]')
  const delta = choice.delta == null ? {} : record(choice.delta, 'choices[0].delta')
  const content = optionalString(delta.content, 'delta.content')
  const finish = choice.finish_reason
  if (finish != null && (typeof finish !== 'string' || !FINISH_REASONS.has(finish))) return malformed('finish_reason')
  return {
    ...content === undefined ? {} : { content },
    toolCalls: readToolCalls(delta.tool_calls),
    ...finish == null ? {} : { finishReason: finish as WireFinishReason },
    ...usage === undefined ? {} : { usage },
  }
}

/**
 * Decode complete SSE frames from a response body.
 * @param body - provider response bytes.
 * @param activity - pulse for the idle watchdog on every event and heartbeat comment.
 * @returns validated chunks, ending with `done` when the provider sends `[DONE]`.
 */
export async function* parseSse(body: ReadableStream<BufferSource>, activity: () => void): AsyncGenerator<WireEvent> {
  const events = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment: activity }))
  for await (const event of events) {
    activity()
    if (event.data === '[DONE]') {
      yield { kind: 'done' }
      return
    }
    let raw: unknown
    try { raw = JSON.parse(event.data) } catch (_invalidSseJson) {
      throw new LlmError('Mercury SSE event contains invalid JSON', 'MALFORMED_RESPONSE')
    }
    yield { kind: 'chunk', chunk: readChunk(raw) }
  }
}
