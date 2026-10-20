import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, it } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { IDLE_VIEW, SessionFrameSource, segmentFrame, type DiffusionView } from '../src/client/frame-source.ts'
import { DiffusionHub, type SessionKey } from '../src/frames.ts'
import { applyFramesRoute } from '../src/route.ts'
import { FRAMES_ROUTE_PATH } from '../src/shared.ts'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Route { path: string; fetch: (request: Request) => Promise<Response> }

/** The slice of Context the route uses: effects and the Connection Fetch registry. */
function fakeContext(): { ctx: Context; route: () => Route; dispose: () => void } {
  let registered: Route | undefined
  const disposers: (() => unknown)[] = []
  const ctx = {
    effect(execute: () => () => unknown) { disposers.push(execute()) },
    connection: { fetch: { register(route: Route) { registered = route; return async () => { registered = undefined } } } },
  }
  return {
    ctx: ctx as Partial<Context> as Context,
    route: () => registered!,
    dispose: () => { for (const dispose of disposers.reverse()) void dispose() },
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

describe('segmentFrame', () => {
  it('marks code points that kept their value since the previous frame', () => {
    assert.deepEqual(segmentFrame(undefined, 'ab'), { segments: [{ text: 'ab', settled: false }], settledRatio: 0 })
    assert.deepEqual(segmentFrame('a#c?', 'abc!'), {
      segments: [{ text: 'a', settled: true }, { text: 'b', settled: false }, { text: 'c', settled: true }, { text: '!', settled: false }],
      settledRatio: 0.5,
    })
    assert.deepEqual(segmentFrame('😀x', '😀y').segments[0], { text: '😀', settled: true })
  })
})

describe('frames route to browser source', () => {
  it('streams a Session attempt from the hub into the dock view and back to idle', async () => {
    const hub = new DiffusionHub(() => {})
    const { ctx, route, dispose } = fakeContext()
    applyFramesRoute(ctx, hub, 60_000)
    assert.equal(route().path, FRAMES_ROUTE_PATH)
    globalThis.fetch = async (input, init) => route().fetch(new Request(new URL(String(input), 'http://127.0.0.1:3080/'), init))

    const source = new SessionFrameSource('s1', { frameMs: 5, holdMs: 20 })
    const views: DiffusionView[] = []
    const unsubscribe = source.subscribe(() => { views.push(source.getSnapshot()) })
    await until(() => hub.watching('s1' as SessionKey))

    const attempt = hub.open('s1' as SessionKey, 'mercury-3', 0)
    attempt.frame('H#l?o')
    attempt.frame('Hello')
    await until(() => views.length >= 2)
    const last = views.at(-1)
    assert.ok(last?.phase === 'diffusing')
    assert.equal(last.step, 2)
    assert.deepEqual(last.segments, [{ text: 'H', settled: true }, { text: 'e', settled: false }, { text: 'l', settled: true }, { text: 'l', settled: false }, { text: 'o', settled: true }])

    attempt.end('completed')
    await until(() => source.getSnapshot() === IDLE_VIEW)

    unsubscribe()
    await until(() => !hub.watching('s1' as SessionKey))
    dispose()
  })

  it('plays back a burst frame by frame and holds the converged text before hiding', async () => {
    const hub = new DiffusionHub(() => {})
    const { ctx, route, dispose } = fakeContext()
    applyFramesRoute(ctx, hub, 60_000)
    globalThis.fetch = async (input, init) => route().fetch(new Request(new URL(String(input), 'http://127.0.0.1:3380/'), init))
    const source = new SessionFrameSource('s2', { frameMs: 30, holdMs: 80 })
    const shown: { at: number; step: number | null }[] = []
    const start = performance.now()
    const unsubscribe = source.subscribe(() => {
      const view = source.getSnapshot()
      shown.push({ at: performance.now() - start, step: view.phase === 'diffusing' ? view.step : null })
    })
    await until(() => hub.watching('s2' as SessionKey))

    // Mercury's shape: several frames and the end inside one burst.
    const attempt = hub.open('s2' as SessionKey, 'mercury-3', 0)
    attempt.frame('?#?')
    attempt.frame('a#?')
    attempt.frame('abc')
    attempt.end('completed')
    await until(() => shown.at(-1)?.step === null)

    // Steps 1-3 play in order, the converged text is held fully settled, then playback ends.
    assert.deepEqual(shown.map(entry => entry.step), [1, 2, 3, 3, null])
    const [first, , last, held, hidden] = shown
    assert.ok(last!.at - first!.at >= 55, 'each frame stays on screen for the frame interval')
    assert.ok(hidden!.at - held!.at >= 75, 'the converged text is held before playback ends')
    const view = source.getSnapshot()
    assert.equal(view.phase, 'idle')
    unsubscribe()
    dispose()
  })

  it('binds an attempt to the first bubble that claims it', async () => {
    const hub = new DiffusionHub(() => {})
    const { ctx, route, dispose } = fakeContext()
    applyFramesRoute(ctx, hub, 60_000)
    globalThis.fetch = async (input, init) => route().fetch(new Request(new URL(String(input), 'http://127.0.0.1:3380/'), init))
    const source = new SessionFrameSource('s3', { frameMs: 5, holdMs: 50 })
    const unsubscribe = source.subscribe(() => {})
    await until(() => hub.watching('s3' as SessionKey))

    const first = hub.open('s3' as SessionKey, 'mercury-3', 0)
    first.frame('a#')
    await until(() => source.getSnapshot().phase === 'diffusing')
    const attemptA = (source.getSnapshot() as { attempt: string }).attempt
    assert.equal(source.claim(attemptA, 'turn0:step1', 'old answer', false), false, 'a settled bubble with other text is not the producer')
    assert.equal(source.claim(attemptA, 'turn1:step1', 'a#', false), true, 'a settled bubble whose text is the newest frame is the producer')
    assert.equal(source.claim(attemptA, 'turn1:step1', 'a#', false), true)
    assert.equal(source.claim(attemptA, 'turn1:step2', '', true), false, 'a later step cannot take a held attempt')

    first.end('completed')
    const second = hub.open('s3' as SessionKey, 'mercury-3', 0)
    second.frame('b?')
    await until(() => { const view = source.getSnapshot(); return view.phase === 'diffusing' && view.attempt !== attemptA })
    const attemptB = (source.getSnapshot() as { attempt: string }).attempt
    assert.equal(source.claim(attemptA, 'turn1:step1', 'a#', false), false, 'a retired attempt is no longer claimable')
    assert.equal(source.claim(attemptB, 'turn1:step2', '', true), true, 'a streaming bubble claims the current attempt')
    second.end('completed')
    unsubscribe()
    dispose()
  })

  it('rejects a request without a Session', async () => {
    const { ctx, route } = fakeContext()
    applyFramesRoute(ctx, new DiffusionHub(() => {}), 60_000)
    const response = await route().fetch(new Request(`http://127.0.0.1:3080${FRAMES_ROUTE_PATH}`))
    assert.equal(response.status, 400)
  })
})
