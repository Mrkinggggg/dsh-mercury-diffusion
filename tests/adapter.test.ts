import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { MercuryAdapter } from '../src/adapter.ts'
import { Config } from '../src/config.ts'
import { DiffusionHub, type SessionKey } from '../src/frames.ts'
import type { DiffusionWireFrame } from '../src/shared.ts'
import { chunk, collect, sseBody, usageChunk } from './helpers.ts'

const SESSION = 'session-1' as SessionKey
const realFetch = globalThis.fetch

interface Captured { url: string; headers: Headers; body: Record<string, unknown> }

function mockFetch(respond: () => Response): Captured[] {
  const calls: Captured[] = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return respond()
  }
  return calls
}

type ConfigInput = NonNullable<Parameters<typeof Config>[0]>

function adapter(hub: DiffusionHub, overrides: Partial<ConfigInput> = {}): MercuryAdapter {
  return new MercuryAdapter(Config({ apiKey: 'sk-test', frameIntervalMs: 0, ...overrides }), hub)
}

function userRequest(extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'mercury', model: 'mercury-3', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], ...extra }
}

const DIFFUSION_STREAM = [
  chunk({ role: 'assistant', content: 'H?l#o' }),
  chunk({ content: 'Hello' }),
  chunk({ content: '' }, 'stop'),
  usageChunk(3, 1),
  '[DONE]',
] as const

afterEach(() => { globalThis.fetch = realFetch })

describe('MercuryAdapter', () => {
  it('diffuses a watched Session, publishes frames, and commits only the final text', async () => {
    const calls = mockFetch(() => new Response(sseBody(DIFFUSION_STREAM), { headers: { 'content-type': 'text/event-stream' } }))
    const hub = new DiffusionHub(() => {})
    const seen: DiffusionWireFrame[] = []
    hub.attach(SESSION, frame => { seen.push(frame) })
    const out = await collect(adapter(hub).stream(userRequest({ sessionId: SESSION })))
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'https://api.inceptionlabs.ai/v1/chat/completions')
    assert.equal(calls[0]?.headers.get('authorization'), 'Bearer sk-test')
    assert.match(calls[0]?.headers.get('user-agent') ?? '', /\S/u)
    assert.equal(calls[0]?.body.diffusing, true)
    assert.deepEqual(seen.map(frame => frame.type === 'frame' ? frame.text : `end:${frame.outcome}`), ['H?l#o', 'Hello', 'end:completed'])
    const assembler = new BlockAssembler()
    for (const value of out) assembler.push(value)
    assert.deepEqual(assembler.blocks(), [{ type: 'text', text: 'Hello' }])
    assert.deepEqual(assembler.finish, { kind: 'stop' })
  })

  it('streams ordinary deltas when nobody watches or diffusing is disabled', async () => {
    const hub = new DiffusionHub(() => {})
    const unwatched = mockFetch(() => new Response(sseBody([chunk({ content: 'ok' }, 'stop'), '[DONE]'])))
    await collect(adapter(hub).stream(userRequest({ sessionId: SESSION })))
    assert.equal(unwatched[0]?.body.diffusing, undefined)

    hub.attach(SESSION, () => {})
    const disabled = mockFetch(() => new Response(sseBody([chunk({ content: 'ok' }, 'stop'), '[DONE]'])))
    await collect(adapter(hub, { diffusing: false }).stream(userRequest({ sessionId: SESSION })))
    assert.equal(disabled[0]?.body.diffusing, undefined)

    const auxiliary = mockFetch(() => new Response(sseBody([chunk({ content: 'ok' }, 'stop'), '[DONE]'])))
    await collect(adapter(hub).stream(userRequest({ sessionId: SESSION, purpose: 'session-title' })))
    assert.equal(auxiliary[0]?.body.diffusing, undefined)
  })

  it('classifies HTTP failures and ends the diffusing attempt as failed', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'authentication_error', code: 'invalid_api_key' } }), { status: 401 }))
    const hub = new DiffusionHub(() => {})
    const seen: DiffusionWireFrame[] = []
    hub.attach(SESSION, frame => { seen.push(frame) })
    await assert.rejects(
      collect(adapter(hub).stream(userRequest({ sessionId: SESSION }))),
      (error: unknown) => error instanceof LlmError && error.code === 'AUTH' && error.failure.status === 401,
    )
    assert.deepEqual(seen, [{ type: 'end', attempt: (seen[0] as { attempt: string }).attempt, outcome: 'failed' }])
  })

  it('fails with AUTH and no request while no key is set', async () => {
    const calls = mockFetch(() => new Response(sseBody([chunk({ content: 'ok' }, 'stop'), '[DONE]'])))
    await assert.rejects(
      collect(adapter(new DiffusionHub(() => {}), { apiKey: undefined }).stream(userRequest())),
      (error: unknown) => error instanceof LlmError && error.code === 'AUTH' && /Configure/u.test(error.message),
    )
    assert.equal(calls.length, 0)
  })

  it('advertises configured models with text-only input and reasoning efforts', async () => {
    const instance = adapter(new DiffusionHub(() => {}))
    const models = await instance.listModels('mercury')
    assert.deepEqual(models.map(model => model.id), ['mercury-3', 'mercury-2.5', 'mercury-2'])
    const info = await instance.resolveModel('mercury', 'mercury-3')
    assert.deepEqual(info.inputModalities, ['text'])
    assert.equal(info.context?.contextWindow, 1_000_000)
    assert.deepEqual(info.reasoning?.efforts.map(effort => effort.id), ['instant', 'low', 'medium', 'high'])
  })
})
