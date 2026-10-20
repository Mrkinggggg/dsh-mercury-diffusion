import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, it } from 'node:test'
import { DiffusionHub, type SessionKey } from '../src/frames.ts'
import type { DiffusionWireFrame } from '../src/shared.ts'

const SESSION = 's1' as SessionKey

describe('DiffusionHub', () => {
  it('reports watchers and delivers frames then the end of the attempt', () => {
    const hub = new DiffusionHub(() => {})
    const seen: DiffusionWireFrame[] = []
    assert.equal(hub.watching(SESSION), false)
    const detach = hub.attach(SESSION, frame => { seen.push(frame) })
    assert.equal(hub.watching(SESSION), true)
    const attempt = hub.open(SESSION, 'mercury-3', 0)
    attempt.frame('a#c')
    attempt.frame('abc')
    attempt.end('completed')
    attempt.frame('ignored')
    assert.deepEqual(seen.map(frame => frame.type === 'frame' ? frame.text : frame.outcome), ['a#c', 'abc', 'completed'])
    assert.deepEqual(seen.map(frame => frame.type === 'frame' ? frame.step : 0), [1, 2, 0])
    detach()
    assert.equal(hub.watching(SESSION), false)
  })

  it('replays the live frame to a viewer that attaches mid-attempt', () => {
    const hub = new DiffusionHub(() => {})
    const attempt = hub.open(SESSION, 'mercury-3', 0)
    attempt.frame('partial')
    const seen: DiffusionWireFrame[] = []
    hub.attach(SESSION, frame => { seen.push(frame) })
    assert.equal(seen[0]?.type === 'frame' && seen[0].text, 'partial')
    attempt.end('aborted')
    const late: DiffusionWireFrame[] = []
    hub.attach(SESSION, frame => { late.push(frame) })
    assert.deepEqual(late, [])
  })

  it('throttles to the newest frame per interval', async () => {
    const hub = new DiffusionHub(() => {})
    const texts: string[] = []
    hub.attach(SESSION, frame => { if (frame.type === 'frame') texts.push(`${frame.step}:${frame.text}`) })
    const attempt = hub.open(SESSION, 'mercury-3', 40)
    attempt.frame('one')
    attempt.frame('two')
    attempt.frame('three')
    assert.deepEqual(texts, ['1:one'])
    await delay(80)
    assert.deepEqual(texts, ['1:one', '3:three'])
    attempt.end('completed')
  })

  it('delivers the newest throttled frame before the end of an attempt', () => {
    const hub = new DiffusionHub(() => {})
    const seen: string[] = []
    hub.attach(SESSION, frame => { seen.push(frame.type === 'frame' ? `${frame.step}:${frame.text}` : `end:${frame.outcome}`) })
    const attempt = hub.open(SESSION, 'mercury-3', 1_000)
    attempt.frame('a#c')
    attempt.frame('ab?')
    attempt.frame('abc')
    attempt.end('completed')
    assert.deepEqual(seen, ['1:a#c', '3:abc', 'end:completed'])
  })

  it('detaches a viewer that throws and reports it', () => {
    const errors: unknown[] = []
    const hub = new DiffusionHub(error => { errors.push(error) })
    hub.attach(SESSION, () => { throw new Error('closed') })
    hub.open(SESSION, 'mercury-3', 0).frame('x')
    assert.equal(errors.length, 1)
    assert.equal(hub.watching(SESSION), false)
  })
})
