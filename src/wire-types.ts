/** Inception `/v1/chat/completions` request fields this bridge writes (https://api.inceptionlabs.ai/openapi.json). */

/** One completed function call carried by an assistant history message. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One history message; Mercury chat models accept text content only. */
export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** One function tool declaration. */
export interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** Streaming chat-completions request body. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  /** Each streamed chunk then carries the complete current text instead of a delta. */
  diffusing?: true
  stream_options: { include_usage: true }
  max_completion_tokens?: number
  temperature?: number
  stop?: string[]
  tools?: WireTool[]
  reasoning_effort?: string
}
