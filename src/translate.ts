/**
 * Translate validated chat-completion chunks into harness `StreamChunk`s.
 *
 * Normal mode streams text and tool-argument deltas as they arrive. Diffusing
 * mode receives the complete current text in every chunk; those intermediate
 * frames go to the diffusion observer only. The text block opens empty at the
 * first frame and receives the settled text as one delta after the provider
 * finishes, with tool calls after it, so the durable assistant message
 * contains exactly the final text.
 */

import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { WireEvent, WireFinishReason, WireUsage } from './sse.ts'

/** Receives each complete denoising frame of a diffusing response. */
export interface DiffusionObserver {
  /** @param text - complete text at the current denoising step. */
  frame(text: string): void
}

interface ToolState {
  /** Harness block index; assigned at first sight in normal mode, at emission in diffusing mode. */
  index: number | undefined
  readonly id: string
  name: string
  /** Fragments concatenated, the reading for delta-encoded arguments. */
  appended: string
  /** Latest fragment alone, the reading for snapshot-encoded arguments. */
  latest: string
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch (_notJson) {
    return false
  }
}

/**
 * Final raw arguments. A call without arguments sends an empty object. In
 * diffusing mode the provider documents only text frames, so the argument
 * encoding is decided per call: delta fragments concatenate to JSON, while
 * complete snapshots are JSON on their own.
 */
function finalArguments(tool: ToolState, diffusing: boolean): string {
  if (tool.appended.length === 0) return '{}'
  if (!diffusing || isJson(tool.appended) || !isJson(tool.latest)) return tool.appended
  return tool.latest
}

function tokenUsage(usage: WireUsage): TokenUsage {
  const cached = Math.min(usage.cachedTokens, usage.promptTokens)
  return {
    inputTokens: usage.promptTokens - cached,
    outputTokens: usage.completionTokens,
    ...usage.totalTokens === usage.promptTokens + usage.completionTokens ? { totalTokens: usage.totalTokens } : {},
    ...cached > 0 ? { cacheReadTokens: cached } : {},
    ...usage.reasoningTokens > 0 ? { reasoningTokens: usage.reasoningTokens } : {},
  }
}

function finishReason(reason: WireFinishReason, blocks: number, toolCalls: number): FinishReason {
  if (toolCalls > 0 && (reason === 'tool_calls' || reason === 'stop')) return { kind: 'tool-calls' }
  switch (reason) {
    case 'stop':
      return blocks > 0
        ? { kind: 'stop' }
        : { kind: 'error', failure: { message: 'Mercury returned an empty completion', code: 'EMPTY_RESPONSE' } }
    case 'length':
      return { kind: 'max-tokens' }
    case 'tool_calls':
      return { kind: 'error', failure: { message: 'Mercury finished for tool calls without sending any', code: 'MALFORMED_RESPONSE' } }
    case 'content_filter':
      return { kind: 'error', failure: { message: 'Mercury stopped the completion with its content filter', code: 'CONTENT_FILTER' } }
  }
}

/**
 * Translate one provider stream.
 * @param events - validated SSE events in arrival order.
 * @param diffusion - frame observer; present exactly when the request asked for `diffusing`.
 * @returns harness chunks obeying the adapter contract: matched block start/end, usage before the terminal finish.
 * @throws {LlmError} `MALFORMED_RESPONSE` when a tool call arrives without an id or the stream ends without a finish reason.
 */
export async function* translate(events: AsyncIterable<WireEvent>, diffusion: DiffusionObserver | undefined): AsyncGenerator<StreamChunk> {
  const diffusing = diffusion !== undefined
  let next = 0
  let textIndex: number | undefined
  let text = ''
  const tools = new Map<number, ToolState>()
  let finish: WireFinishReason | undefined
  let usage: TokenUsage | undefined

  for await (const event of events) {
    if (event.kind === 'done') break
    const { chunk } = event
    if (chunk.usage !== undefined) usage = tokenUsage(chunk.usage)
    if (chunk.content !== undefined && chunk.content.length > 0) {
      if (diffusing) {
        // Opening the empty block lets the client render the streaming bubble the frames play in;
        // the block's text is only committed once the provider finishes.
        if (textIndex === undefined) {
          textIndex = next++
          yield { type: 'block-start', index: textIndex, blockType: 'text' }
        }
        text = chunk.content
        diffusion.frame(chunk.content)
      } else {
        if (textIndex === undefined) {
          textIndex = next++
          yield { type: 'block-start', index: textIndex, blockType: 'text' }
        }
        text += chunk.content
        yield { type: 'text-delta', index: textIndex, text: chunk.content }
      }
    }
    for (const delta of chunk.toolCalls) {
      let tool = tools.get(delta.index)
      if (tool === undefined) {
        if (delta.id === undefined) throw new LlmError('Mercury stream started a tool call without an id', 'MALFORMED_RESPONSE')
        tool = { index: diffusing ? undefined : next++, id: delta.id, name: delta.name ?? '', appended: '', latest: '' }
        tools.set(delta.index, tool)
        if (tool.index !== undefined) yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
      } else if (tool.name.length === 0 && delta.name !== undefined) {
        tool.name = delta.name
      }
      if (delta.arguments !== undefined && delta.arguments.length > 0) {
        tool.appended += delta.arguments
        tool.latest = delta.arguments
        if (tool.index !== undefined) {
          yield {
            type: 'tool-call-delta', index: tool.index, id: ToolCallId(tool.id),
            ...tool.name.length === 0 ? {} : { name: tool.name },
            argumentsDelta: delta.arguments,
          }
        }
      }
    }
    if (chunk.finishReason !== undefined) finish = chunk.finishReason
  }

  if (finish === undefined) throw new LlmError('Mercury stream ended without a finish reason', 'MALFORMED_RESPONSE')

  let blocks = 0
  if (diffusing && textIndex !== undefined) yield { type: 'text-delta', index: textIndex, text }
  if (textIndex !== undefined) {
    blocks += 1
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  for (const tool of tools.values()) {
    if (tool.name.length === 0) throw new LlmError('Mercury stream sent a tool call without a function name', 'MALFORMED_RESPONSE')
    const id = ToolCallId(tool.id)
    const args = finalArguments(tool, diffusing)
    if (tool.index === undefined) {
      tool.index = next++
      yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: tool.index, id, name: tool.name, argumentsDelta: args }
    }
    blocks += 1
    yield { type: 'block-end', index: tool.index, block: { type: 'tool-call', id, name: tool.name, arguments: args } }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: finishReason(finish, blocks, tools.size) }
}
