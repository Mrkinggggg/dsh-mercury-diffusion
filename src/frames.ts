/** Process-local fan-out of live diffusion frames from bridge attempts to watching Web Clients. */

import { randomUUID } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { DiffusionOutcome, DiffusionWireFrame } from './shared.ts'
import type { DiffusionObserver } from './translate.ts'

/** Session identity stamped on loop-built requests. */
export type SessionKey = NonNullable<GenerateOptions['sessionId']>

/** Identity of one diffusing model attempt. */
export type DiffusionAttemptId = Branded<'MercuryDiffusionAttemptId'>

/** Receives frames for one watched Session; a throw detaches the viewer. */
export type DiffusionViewer = (frame: DiffusionWireFrame) => void

type LiveFrame = Extract<DiffusionWireFrame, { type: 'frame' }>

/**
 * Viewer registry plus the latest frame of each Session's live attempt.
 * Frames are presentation only: they never reach the model or the Session log.
 */
export class DiffusionHub {
  private readonly viewers = new Map<string, Set<DiffusionViewer>>()
  private readonly live = new Map<string, LiveFrame>()
  private readonly onViewerError: (error: unknown) => void

  /**
   * @param onViewerError - diagnostic for a viewer that threw and was detached.
   */
  constructor(onViewerError: (error: unknown) => void) {
    this.onViewerError = onViewerError
  }

  /**
   * Whether any Web Client currently follows a Session's frames.
   * @param session - Session to check.
   * @returns true while at least one viewer is attached.
   */
  watching(session: SessionKey): boolean {
    return (this.viewers.get(session)?.size ?? 0) > 0
  }

  /**
   * Follow one Session. A viewer attached mid-attempt first receives that attempt's latest frame.
   * @param session - Session id from the frames route query.
   * @param viewer - frame sink.
   * @returns idempotent detach.
   */
  attach(session: string, viewer: DiffusionViewer): () => void {
    let set = this.viewers.get(session)
    if (set === undefined) {
      set = new Set()
      this.viewers.set(session, set)
    }
    set.add(viewer)
    const current = this.live.get(session)
    if (current !== undefined) this.deliver(session, viewer, current)
    return () => { this.detach(session, viewer) }
  }

  /**
   * Start publishing one diffusing attempt.
   * @param session - requesting Session.
   * @param model - provider model id serving the attempt.
   * @param intervalMs - minimum spacing between delivered frames.
   * @returns the attempt's frame observer; the caller must call `end()` exactly once.
   */
  open(session: SessionKey, model: string, intervalMs: number): DiffusionAttempt {
    return new DiffusionAttempt(this, session, model, intervalMs)
  }

  /** @internal Deliver one frame of a Session's attempt and update its live state. */
  publish(session: SessionKey, frame: DiffusionWireFrame): void {
    if (frame.type === 'frame') this.live.set(session, frame)
    else if (this.live.get(session)?.attempt === frame.attempt) this.live.delete(session)
    for (const viewer of [...this.viewers.get(session) ?? []]) this.deliver(session, viewer, frame)
  }

  private deliver(session: string, viewer: DiffusionViewer, frame: DiffusionWireFrame): void {
    try {
      viewer(frame)
    } catch (error) {
      this.detach(session, viewer)
      this.onViewerError(error)
    }
  }

  private detach(session: string, viewer: DiffusionViewer): void {
    const set = this.viewers.get(session)
    if (set === undefined) return
    set.delete(viewer)
    if (set.size === 0) this.viewers.delete(session)
  }
}

/** Throttled frame publisher for one model attempt. */
export class DiffusionAttempt implements DiffusionObserver {
  private readonly id: DiffusionAttemptId = brandString<DiffusionAttemptId>(randomUUID())
  private readonly hub: DiffusionHub
  private readonly session: SessionKey
  private readonly model: string
  private readonly intervalMs: number
  private step = 0
  private pending: string | undefined
  private lastSent = Number.NEGATIVE_INFINITY
  private timer: ReturnType<typeof setTimeout> | undefined
  private ended = false

  /**
   * @param hub - owning fan-out.
   * @param session - requesting Session.
   * @param model - provider model id.
   * @param intervalMs - minimum spacing between delivered frames; 0 delivers every frame.
   */
  constructor(hub: DiffusionHub, session: SessionKey, model: string, intervalMs: number) {
    this.hub = hub
    this.session = session
    this.model = model
    this.intervalMs = intervalMs
  }

  /** @param text - complete text at the next denoising step. */
  frame(text: string): void {
    if (this.ended) return
    this.step += 1
    this.pending = text
    const wait = this.lastSent + this.intervalMs - performance.now()
    if (wait <= 0) this.flush()
    else this.timer ??= setTimeout(() => { this.flush() }, wait)
  }

  /**
   * Retire the attempt; later frames are ignored.
   * @param outcome - how the provider stream ended.
   */
  end(outcome: DiffusionOutcome): void {
    if (this.ended) return
    // A provider can finish inside one throttle interval; the newest throttled frame is still part of the attempt.
    this.flush()
    this.ended = true
    this.hub.publish(this.session, { type: 'end', attempt: this.id, outcome })
  }

  private flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.pending === undefined || this.ended) return
    this.hub.publish(this.session, { type: 'frame', attempt: this.id, step: this.step, model: this.model, text: this.pending })
    this.pending = undefined
    this.lastSent = performance.now()
  }
}
