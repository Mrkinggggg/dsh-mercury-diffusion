/** Shared fixtures: SSE bodies and stream collection. */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { WireEvent } from '../src/sse.ts'

/**
 * @param payloads - chunk objects, or the literal `[DONE]` terminator.
 * @returns an SSE response body carrying them as `data:` events.
 */
export function sseBody(payloads: readonly (object | '[DONE]')[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const text = payloads.map(payload => `data: ${payload === '[DONE]' ? payload : JSON.stringify(payload)}\n\n`).join('')
  return new Response(text).body!
}

/**
 * @param chunk - fields of `choices[0]` plus optional top-level usage.
 * @returns a chat-completion chunk payload.
 */
export function chunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: object): object {
  return { id: 'cmpl-1', object: 'chat.completion.chunk', created: 1, model: 'mercury-3', choices: [{ index: 0, delta, finish_reason: finishReason }], ...usage === undefined ? {} : { usage } }
}

/** @returns a usage-only chunk as sent for `stream_options.include_usage`. */
export function usageChunk(prompt: number, completion: number, cached = 0): object {
  return { id: 'cmpl-1', object: 'chat.completion.chunk', created: 1, model: 'mercury-3', choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: cached }, completion_tokens_details: { reasoning_tokens: 0 } } }
}

/** @returns validated events for the translator without going through SSE. */
export async function* events(list: readonly WireEvent[]): AsyncGenerator<WireEvent> {
  for (const event of list) yield event
}

/** @returns every chunk the iterable yields. */
export async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const value of stream) out.push(value)
  return out
}
