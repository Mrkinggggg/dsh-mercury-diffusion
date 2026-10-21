import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { applyBridge } from '../src/bridge.ts'
import { DiffusionCapability } from '../src/capability.ts'
import { DiffusionState } from '../src/diffusion-state.ts'
import { DiffusionHub, type SessionKey } from '../src/frames.ts'
import type { BridgeRoute } from '../src/shared.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** A request the bridge is allowed to consider: watched Session, toggle on, text only. */
function request(extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'gw',
    model: 'mercury-3',
    sessionId: 's1' as SessionKey,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...extra,
  }
}

const ROUTE: BridgeRoute = { provider: 'gw', baseURL: 'http://127.0.0.1:9/v1', apiKeyEnv: 'DSH_TEST_UNSET_KEY' }

type StreamHandler = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>

/** The slice of Context the interceptor uses, plus a credential value. */
function harness(credential?: string): { ctx: Context; handler: () => StreamHandler } {
  let captured: StreamHandler | undefined
  const ctx = {
    on(name: string, listener: StreamHandler) {
      if (name === 'llm/stream') captured = listener
      return () => {}
    },
    get(service: string) {
      if (service !== 'credentials') return undefined
      return {
        async resolve() {
          return credential === undefined ? undefined : { value: credential }
        },
      }
    },
  }
  return { ctx: ctx as unknown as Context, handler: () => captured! }
}

/** What the owning adapter would have produced, so a fallback is visible. */
async function* adapterStream(): AsyncGenerator<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: 'from-adapter' }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** The refusal a route that knows `diffusing` produces. */
const KNOWS_FIELD = '{"error":{"message":[{"loc":["body","diffusing"],"type":"bool_parsing"}]}}'

function sse(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
}

function diffusedStream(): Response {
  return new Response(sse([
    `data: {"choices":[{"index":0,"delta":{"content":"hel"}}]}\n\n`,
    `data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n`,
    `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n`,
    'data: [DONE]\n\n',
  ]), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('bridge interceptor', () => {
  it('falls back to the owning adapter when no credential resolves', async () => {
    const { ctx, handler } = harness(undefined)
    applyBridge(ctx, () => [ROUTE], () => {}, new DiffusionHub(() => {}), new DiffusionState({ 'gw::mercury-3': true }), new DiffusionCapability(), 0, 1_000)
    const chunks = await collect(handler()(request(), adapterStream))
    assert.deepEqual(chunks, [{ type: 'text-delta', index: 0, text: 'from-adapter' }])
  })

  it('falls back when the upstream refuses the field', async () => {
    globalThis.fetch = async () => new Response('{"error":{"message":[{"type":"extra_forbidden"}]}}', { status: 400 })
    const { ctx, handler } = harness('sk-test')
    applyBridge(ctx, () => [ROUTE], () => {}, new DiffusionHub(() => {}), new DiffusionState({ 'gw::mercury-3': true }), new DiffusionCapability(), 0, 1_000)
    const chunks = await collect(handler()(request(), adapterStream))
    assert.deepEqual(chunks, [{ type: 'text-delta', index: 0, text: 'from-adapter' }])
  })

  it('bridges the request and publishes frames once the probe passes', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return calls === 1 ? new Response(KNOWS_FIELD, { status: 400 }) : diffusedStream()
    }
    const hub = new DiffusionHub(() => {})
    const frames: string[] = []
    hub.attach('s1', (frame) => { if (frame.type === 'frame') frames.push(frame.text) })
    const { ctx, handler } = harness('sk-test')
    applyBridge(ctx, () => [ROUTE], () => {}, hub, new DiffusionState({ 'gw::mercury-3': true }), new DiffusionCapability(), 0, 1_000)
    const chunks = await collect(handler()(request(), adapterStream))
    const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
    assert.equal(text, 'hello')
    assert.deepEqual(frames, ['hel', 'hello'])
  })

  it('rethrows an abort instead of starting a second request', async () => {
    const controller = new AbortController()
    controller.abort()
    const hub = new DiffusionHub(() => {})
    hub.attach('s1', () => {})
    const { ctx, handler } = harness('sk-test')
    applyBridge(ctx, () => [ROUTE], () => {}, hub, new DiffusionState({ 'gw::mercury-3': true }), new DiffusionCapability(), 0, 1_000)
    await assert.rejects(
      collect(handler()(request({ signal: controller.signal }), adapterStream)),
      (error: unknown) => error instanceof LlmError && error.code === 'ABORTED',
    )
  })

  it('leaves turns with attachments to the owning adapter', async () => {
    let probed = false
    globalThis.fetch = async () => { probed = true; return new Response(KNOWS_FIELD, { status: 400 }) }
    const { ctx, handler } = harness('sk-test')
    applyBridge(ctx, () => [ROUTE], () => {}, new DiffusionHub(() => {}), new DiffusionState({ 'gw::mercury-3': true }), new DiffusionCapability(), 0, 1_000)
    const options = request({ messages: [{ role: 'user', content: [{ type: 'image', attachment: {} }] }] })
    const chunks = await collect(handler()(options, adapterStream))
    assert.equal(probed, false)
    assert.deepEqual(chunks, [{ type: 'text-delta', index: 0, text: 'from-adapter' }])
  })
})
