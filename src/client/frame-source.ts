/** Browser-side observable over one Session's diffusion frames route. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { FRAMES_ROUTE, SESSION_QUERY, readWireFrame, type DiffusionWireFrame } from '../shared.ts'

/** Reconnect backoff for the frames stream; protocol pacing, not deployment configuration. */
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000

/** Frames waiting for playback beyond this many drop from the oldest, so playback cannot fall far behind. */
const MAX_QUEUED_FRAMES = 24

/** Diagnostics for playback and bubble binding, on when localStorage `dsh-mercury-debug` is `1`. */
function debug(message: string, detail?: object): void {
  let enabled = false
  try { enabled = globalThis.localStorage?.getItem('dsh-mercury-debug') === '1' } catch (_storageBlocked) {
    // Blocked storage leaves diagnostics off.
  }
  if (enabled) console.debug(`[mercury-diffusion] ${message}`, detail ?? {})
}

/**
 * Playback pacing. Mercury denoises an answer in a handful of frames that
 * arrive within a fraction of a second, often in one burst, so frames are
 * replayed at a readable pace and the converged text is held before the dock
 * hides. The browser half receives no cordis.yml config.
 */
export interface PlaybackTiming {
  /** Minimum time each frame stays on screen. */
  readonly frameMs: number
  /** Time the last frame stays on screen after its attempt ends. */
  readonly holdMs: number
}

/** Shipped pacing. */
export const DEFAULT_TIMING: PlaybackTiming = { frameMs: 180, holdMs: 400 }

type LiveFrame = Extract<DiffusionWireFrame, { type: 'frame' }>

/** A run of characters that either kept its value since the previous frame or changed. */
export interface DiffusionSegment {
  readonly text: string
  /** True when every character in the run equals the previous frame at the same position. */
  readonly settled: boolean
}

/** What the dock renders for one Session. */
export type DiffusionView =
  | { readonly phase: 'idle' }
  | {
    readonly phase: 'diffusing'
    readonly attempt: string
    readonly step: number
    readonly model: string
    readonly segments: readonly DiffusionSegment[]
    /** Fraction of characters unchanged since the previous frame, from 0 to 1. */
    readonly settledRatio: number
    /** Monotonic convergence of the attempt from 0 to 1; 1 once the converged text is held. */
    readonly progress: number
  }

/** The shared idle snapshot; identity-stable for `useSyncExternalStore`. */
export const IDLE_VIEW: DiffusionView = Object.freeze({ phase: 'idle' })

/**
 * Split a frame into settled and changing runs by comparing code points at
 * equal positions with the previous frame of the same attempt.
 * @param previous - previous frame text, or undefined for an attempt's first frame.
 * @param text - current frame text.
 * @returns ordered runs covering `text`, and the settled fraction.
 */
export function segmentFrame(previous: string | undefined, text: string): { segments: DiffusionSegment[]; settledRatio: number } {
  const current = Array.from(text)
  const before = previous === undefined ? [] : Array.from(previous)
  const segments: DiffusionSegment[] = []
  let settledCount = 0
  let run = ''
  let runSettled = false
  for (const [position, char] of current.entries()) {
    const settled = before[position] === char
    if (settled) settledCount += 1
    if (run.length > 0 && settled !== runSettled) {
      segments.push({ text: run, settled: runSettled })
      run = ''
    }
    runSettled = settled
    run += char
  }
  if (run.length > 0) segments.push({ text: run, settled: runSettled })
  return { segments, settledRatio: current.length === 0 ? 0 : settledCount / current.length }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/**
 * Observable diffusion state of one Session. The frames stream is open exactly
 * while the snapshot has subscribers, so an unmounted dock costs no request.
 */
export class SessionFrameSource {
  private readonly url: string
  private readonly listeners = new Set<() => void>()
  private readonly timing: PlaybackTiming
  private view: DiffusionView = IDLE_VIEW
  private lifetime: AbortController | undefined
  /** Attempt being played back; frames of another attempt restart playback. */
  private attempt: string | undefined
  private queue: LiveFrame[] = []
  private ended = false
  /** Text on screen, the baseline the next frame is compared with. */
  private shownText: string | undefined
  /** Highest settled fraction shown for the attempt. */
  private progress = 0
  /** Chat bubble that plays the current attempt; the first claimant wins. */
  private claimant: string | undefined
  /** Newest frame received for the attempt, which is the text its answer settles to. */
  private latestText: string | undefined
  /** Pending frame-advance or hold timer; undefined while playback waits for frames. */
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param session - Session id addressed by the frames route.
   * @param timing - playback pacing.
   */
  constructor(session: string, timing: PlaybackTiming = DEFAULT_TIMING) {
    this.url = `${FRAMES_ROUTE}?${SESSION_QUERY}=${encodeURIComponent(session)}`
    this.timing = timing
  }

  /** @returns the current view; identity changes only when the view changes. */
  readonly getSnapshot = (): DiffusionView => this.view

  /**
   * @param listener - invalidation callback.
   * @returns unsubscribe; the last unsubscribe closes the stream.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.lifetime === undefined) {
      const lifetime = new AbortController()
      this.lifetime = lifetime
      void this.run(lifetime.signal)
    }
    return () => {
      if (!this.listeners.delete(listener) || this.listeners.size > 0) return
      this.close()
    }
  }

  /**
   * Bind the current attempt to one Chat bubble: a bubble still streaming, or
   * one whose text already equals the attempt's newest frame. Mercury often
   * finishes within one render, so the settled text is the common evidence.
   * The first eligible claimant wins, so a later step's bubble that renders
   * while an earlier attempt is still held cannot take it over.
   * @param attempt - attempt the caller saw in the view.
   * @param owner - stable identity of the claiming bubble.
   * @param text - the bubble's current answer text.
   * @param streaming - whether the bubble is still streaming.
   * @returns whether `owner` plays `attempt`.
   */
  readonly claim = (attempt: string, owner: string, text: string, streaming: boolean): boolean => {
    if (attempt !== this.attempt) return false
    if (this.claimant === undefined && (streaming || (text.length > 0 && text === this.latestText))) this.claimant = owner
    debug('claim', { owner, streaming, textLength: text.length, latestLength: this.latestText?.length, matches: text === this.latestText, claimant: this.claimant })
    return this.claimant === owner
  }

  /** Close the stream and drop live state regardless of subscribers. */
  close(): void {
    this.lifetime?.abort()
    this.lifetime = undefined
    this.finish()
  }

  private async run(signal: AbortSignal): Promise<void> {
    let delay = RETRY_MIN_MS
    while (!signal.aborted) {
      try { await this.follow(signal, () => { delay = RETRY_MIN_MS }) } catch (_streamFailed) {
        // A failed or aborted stream retries below unless the source closed; the next stream replays the live attempt.
      }
      if (signal.aborted) return
      this.finish()
      await sleep(delay, signal)
      delay = Math.min(delay * 2, RETRY_MAX_MS)
    }
  }

  /** Read one frames stream until it ends; `connected` runs once the route accepts the request. */
  private async follow(signal: AbortSignal, connected: () => void): Promise<void> {
    const response = await fetch(this.url, { signal, cache: 'no-store', headers: { accept: 'text/event-stream' } })
    if (!response.ok || response.body === null) throw new Error(`frames route answered ${response.status}`)
    connected()
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      this.accept(value.data)
    }
  }

  private accept(data: string): void {
    let raw: unknown
    try { raw = JSON.parse(data) } catch (_invalidFrameJson) {
      // A malformed frame carries nothing renderable; the next frame supersedes it.
      return
    }
    const frame = readWireFrame(raw)
    if (frame === undefined) return
    debug(frame.type, frame.type === 'frame' ? { attempt: frame.attempt, step: frame.step, length: frame.text.length } : frame)
    if (frame.type === 'end') {
      if (frame.attempt !== this.attempt) return
      this.ended = true
      if (this.timer === undefined) this.hold()
      return
    }
    if (frame.attempt !== this.attempt) {
      this.reset()
      this.attempt = frame.attempt
    }
    this.queue.push(frame)
    this.latestText = frame.text
    if (this.queue.length > MAX_QUEUED_FRAMES) this.queue.splice(0, this.queue.length - MAX_QUEUED_FRAMES)
    if (this.timer === undefined) this.advance()
  }

  /** Show the next queued frame and keep it for at least one frame interval. */
  private advance(): void {
    this.timer = undefined
    const frame = this.queue.shift()
    if (frame === undefined) {
      if (this.ended) this.hold()
      return
    }
    const { segments, settledRatio } = segmentFrame(this.shownText, frame.text)
    this.shownText = frame.text
    this.progress = Math.max(this.progress, settledRatio)
    this.publish({ phase: 'diffusing', attempt: frame.attempt, step: frame.step, model: frame.model, segments, settledRatio, progress: this.progress })
    this.timer = setTimeout(() => { this.advance() }, this.timing.frameMs)
  }

  /** Show the converged text fully settled, then hide after the hold time. */
  private hold(): void {
    const view = this.view
    if (view.phase === 'diffusing') {
      this.publish({ ...view, segments: [{ text: view.segments.map(segment => segment.text).join(''), settled: true }], settledRatio: 1, progress: 1 })
    }
    this.timer = setTimeout(() => { this.finish() }, this.timing.holdMs)
  }

  /** Drop playback state and hide the dock. */
  private finish(): void {
    this.reset()
    this.publish(IDLE_VIEW)
  }

  private reset(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.attempt = undefined
    this.queue = []
    this.ended = false
    this.shownText = undefined
    this.progress = 0
    this.claimant = undefined
    this.latestText = undefined
  }

  private publish(view: DiffusionView): void {
    if (view === this.view) return
    this.view = view
    for (const listener of [...this.listeners]) listener()
  }
}

/** One cached {@link SessionFrameSource} per Session for the plugin lifetime. */
export class FrameSources {
  private readonly sources = new Map<string, SessionFrameSource>()

  /**
   * @param session - Session id.
   * @returns the identity-stable source for that Session.
   */
  source(session: string): SessionFrameSource {
    let source = this.sources.get(session)
    if (source === undefined) {
      source = new SessionFrameSource(session)
      this.sources.set(session, source)
    }
    return source
  }

  /** Close every stream; called when the plugin unloads. */
  dispose(): void {
    for (const source of this.sources.values()) source.close()
    this.sources.clear()
  }
}
