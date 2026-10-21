/** Wire facts shared by the Host frames route and the browser frame source. */

import type { DiffusionVerdict } from './capability.ts'

/** Exact Connection route serving live diffusion frames as server-sent events. */
export const FRAMES_ROUTE_PATH = '/api/mercury-diffusion/frames'

/** Document-relative form of {@link FRAMES_ROUTE_PATH}, resolved under whatever mount served the page. */
export const FRAMES_ROUTE = FRAMES_ROUTE_PATH.slice(1)

/** Query parameter naming the Session whose frames one stream carries. */
export const SESSION_QUERY = 'session'

/** Exact Connection route reading and toggling per-model diffusion for the toggle. */
export const DIFFUSION_ROUTE_PATH = '/api/mercury-diffusion/diffusion'

/** Document-relative form of {@link DIFFUSION_ROUTE_PATH}. */
export const DIFFUSION_ROUTE = DIFFUSION_ROUTE_PATH.slice(1)

/** How one diffusing attempt ended. */
export type DiffusionOutcome = 'completed' | 'aborted' | 'failed'

/**
 * One provider route this plugin may bridge. Membership is a routing fact
 * (endpoint and credential), never a model-name guess: whether a model on the
 * route accepts `diffusing` is measured by the capability probe.
 */
export interface BridgeRoute {
  /** Provider route key whose requests may be bridged. */
  provider: string
  /** Endpoint serving `/chat/completions`. */
  baseURL: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv: string
}

/**
 * One measured capability result. `detail` names the step that decided it, so a
 * missing toggle can be explained from the status payload alone.
 */
export interface ProbeOutcome {
  readonly verdict: DiffusionVerdict
  readonly detail: 'measured' | 'no-route' | 'no-credential'
}

/**
 * One live diffusion publication for one model attempt. `frame.text` is the
 * complete current denoising state, not a delta; a later frame of the same
 * attempt supersedes it. `end` retires the attempt.
 */
export type DiffusionWireFrame =
  | {
    readonly type: 'frame'
    /** Process-local attempt identity; a new attempt replaces the previous one. */
    readonly attempt: string
    /** One-based denoising step counted by the bridge, including throttled steps. */
    readonly step: number
    /** Provider model id serving the attempt. */
    readonly model: string
    /** Complete text at this denoising step. */
    readonly text: string
  }
  | {
    readonly type: 'end'
    readonly attempt: string
    readonly outcome: DiffusionOutcome
  }

/**
 * Validate one decoded frame received over the wire.
 * @param raw - JSON-decoded SSE `data` payload.
 * @returns the frame, or undefined when the payload has unknown or malformed fields.
 */
export function readWireFrame(raw: unknown): DiffusionWireFrame | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.attempt !== 'string' || value.attempt.length === 0) return undefined
  switch (value.type) {
    case 'frame':
      if (typeof value.text !== 'string' || typeof value.model !== 'string') return undefined
      if (typeof value.step !== 'number' || !Number.isSafeInteger(value.step) || value.step < 1) return undefined
      return { type: 'frame', attempt: value.attempt, step: value.step, model: value.model, text: value.text }
    case 'end':
      if (value.outcome !== 'completed' && value.outcome !== 'aborted' && value.outcome !== 'failed') return undefined
      return { type: 'end', attempt: value.attempt, outcome: value.outcome }
    default:
      return undefined
  }
}
