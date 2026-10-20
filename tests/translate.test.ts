import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import { parseSse } from '../src/sse.ts'
import { translate } from '../src/translate.ts'
import { chunk, collect, sseBody, usageChunk } from './helpers.ts'

function assemble(chunks: Parameters<BlockAssembler['push']>[0][]): BlockAssembler {
  const assembler = new BlockAssembler()
  for (const value of chunks) assembler.push(value)
  return assembler
}

describe('translate in normal mode', () => {
  it('streams text deltas live and closes with usage before finish', async () => {
    const body = sseBody([
      chunk({ role: 'assistant', content: '' }),
      chunk({ content: 'Hello' }),
      chunk({ content: ' world' }),
      chunk({}, 'stop'),
      usageChunk(10, 2, 4),
      '[DONE]',
    ])
    const out = await collect(translate(parseSse(body, () => {}), undefined))
    assert.deepEqual(out.map(value => value.type), ['block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish'])
    assert.deepEqual(out.at(-2), { type: 'usage', usage: { inputTokens: 6, outputTokens: 2, totalTokens: 12, cacheReadTokens: 4 } })
    assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    assert.deepEqual(assemble(out).blocks(), [{ type: 'text', text: 'Hello world' }])
  })

  it('streams tool-call argument fragments and finishes for tool calls', async () => {
    const body = sseBody([
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"pa' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'th":"a.md"}' } }] }),
      chunk({}, 'tool_calls'),
      '[DONE]',
    ])
    const out = await collect(translate(parseSse(body, () => {}), undefined))
    assert.equal(out.filter(value => value.type === 'tool-call-delta').length, 2)
    assert.deepEqual(out.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
    assert.deepEqual(assemble(out).blocks(), [{ type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a.md"}' }])
  })

  it('maps an empty stop to the retryable EMPTY_RESPONSE error', async () => {
    const out = await collect(translate(parseSse(sseBody([chunk({}, 'stop'), '[DONE]']), () => {}), undefined))
    assert.deepEqual(out, [{ type: 'finish', reason: { kind: 'error', failure: { message: 'Mercury returned an empty completion', code: 'EMPTY_RESPONSE' } } }])
  })

  it('maps length and content_filter finishes', async () => {
    const length = await collect(translate(parseSse(sseBody([chunk({ content: 'x' }, 'length'), '[DONE]']), () => {}), undefined))
    assert.deepEqual(length.at(-1), { type: 'finish', reason: { kind: 'max-tokens' } })
    const filtered = await collect(translate(parseSse(sseBody([chunk({ content: 'x' }, 'content_filter'), '[DONE]']), () => {}), undefined))
    const finish = filtered.at(-1)
    assert.ok(finish?.type === 'finish' && finish.reason.kind === 'error' && finish.reason.failure.code === 'CONTENT_FILTER')
  })

  it('rejects a stream that ends without a finish reason', async () => {
    await assert.rejects(
      collect(translate(parseSse(sseBody([chunk({ content: 'cut' })]), () => {}), undefined)),
      (error: unknown) => error instanceof LlmError && error.code === 'MALFORMED_RESPONSE',
    )
  })

  it('classifies an in-band error event', async () => {
    const body = sseBody([{ error: { message: 'Rate limit reached', type: 'rate_limit_error' } }])
    await assert.rejects(
      collect(translate(parseSse(body, () => {}), undefined)),
      (error: unknown) => error instanceof LlmError && error.code === 'RATE_LIMIT',
    )
  })
})

describe('translate in diffusing mode', () => {
  it('sends every frame to the observer and emits only the final text', async () => {
    const frames: string[] = []
    const body = sseBody([
      chunk({ role: 'assistant', content: 'H#l?o w#r?d' }),
      chunk({ content: 'Hel?o wor?d' }),
      chunk({ content: 'Hello world' }),
      chunk({ content: '' }, 'stop'),
      usageChunk(5, 3),
      '[DONE]',
    ])
    const out = await collect(translate(parseSse(body, () => {}), { frame: text => { frames.push(text) } }))
    assert.deepEqual(frames, ['H#l?o w#r?d', 'Hel?o wor?d', 'Hello world'])
    assert.deepEqual(out, [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hello world' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('opens the text block at the first frame so the bubble exists while diffusing', async () => {
    const order: string[] = []
    const body = sseBody([chunk({ content: 'a#c' }), chunk({ content: 'abc' }), chunk({}, 'stop'), '[DONE]'])
    for await (const value of translate(parseSse(body, () => {}), { frame: text => { order.push(`frame:${text}`) } })) {
      order.push(value.type === 'text-delta' ? `delta:${value.text}` : value.type)
    }
    assert.deepEqual(order, ['block-start', 'frame:a#c', 'frame:abc', 'delta:abc', 'block-end', 'finish'])
  })

  it('accepts tool-call arguments sent as complete snapshots', async () => {
    const body = sseBody([
      chunk({ tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'bash', arguments: '{"command":"l#"}' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] }),
      chunk({}, 'tool_calls'),
      '[DONE]',
    ])
    const out = await collect(translate(parseSse(body, () => {}), { frame: () => {} }))
    assert.deepEqual(assemble(out).blocks(), [{ type: 'tool-call', id: 'call_9', name: 'bash', arguments: '{"command":"ls"}' }])
  })

  it('accepts tool-call arguments sent as delta fragments', async () => {
    const body = sseBody([
      chunk({ content: 'Listing.' }),
      chunk({ tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'bash', arguments: '{"command":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }),
      chunk({}, 'tool_calls'),
      '[DONE]',
    ])
    const out = await collect(translate(parseSse(body, () => {}), { frame: () => {} }))
    assert.deepEqual(assemble(out).blocks(), [
      { type: 'text', text: 'Listing.' },
      { type: 'tool-call', id: 'call_9', name: 'bash', arguments: '{"command":"ls"}' },
    ])
  })
})
