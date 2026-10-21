/** Connection routes: live diffusion frames and per-model diffusion status/toggle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { DiffusionCapability } from './capability.ts'
import type { DiffusionState } from './diffusion-state.ts'
import type { DiffusionHub } from './frames.ts'
import { DIFFUSION_ROUTE_PATH, FRAMES_ROUTE_PATH, SESSION_QUERY, type DiffusionWireFrame, type ProbeOutcome } from './shared.ts'

const encoder = new TextEncoder()

function sseData(frame: DiffusionWireFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
}

/**
 * Mount the frames route. Each response follows one Session until the Client
 * disconnects or this plugin unloads; Connection admits only owner Peers.
 * @param ctx - context that owns `ctx.connection`.
 * @param hub - viewer registry fed by the bridge.
 * @param heartbeatMs - interval of keep-alive comments on each open stream.
 */
export function applyFramesRoute(ctx: Context, hub: DiffusionHub, heartbeatMs: number): void {
  const open = new Set<() => void>()
  ctx.effect(() => () => {
    for (const close of [...open]) close()
  }, 'mercury-diffusion: close frame streams')
  ctx.effect(() => ctx.connection.fetch.register({
    path: FRAMES_ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const session = new URL(request.url).searchParams.get(SESSION_QUERY)
      if (session === null || session.length === 0) {
        return new Response(`missing ${SESSION_QUERY} query parameter`, { status: 400 })
      }
      let close = (): void => {}
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const heartbeat = setInterval(() => { controller.enqueue(encoder.encode(': keep-alive\n\n')) }, heartbeatMs)
          let detach = (): void => {}
          close = () => {
            if (!open.delete(close)) return
            clearInterval(heartbeat)
            detach()
            request.signal.removeEventListener('abort', close)
            try { controller.close() } catch (_alreadyClosed) {
              // The client cancelled first; the stream is already closed.
            }
          }
          open.add(close)
          request.signal.addEventListener('abort', close, { once: true })
          controller.enqueue(encoder.encode(': connected\n\n'))
          detach = hub.attach(session, (frame) => { controller.enqueue(sseData(frame)) })
          if (request.signal.aborted) close()
        },
        cancel() { close() },
      })
      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
        },
      })
    },
  }), 'mercury-diffusion: frames route')
}

/** Host session narrowed to what the diffusion status route reads. */
interface SessionHandle {
  requestHeader(): { config?: { provider?: string; model?: string } } | undefined
}

interface SessionsService {
  get(id: string): SessionHandle | undefined
}

/**
 * Resolve a Session's current provider/model from its latest request header.
 * @param ctx - connection-scoped context with a sessions service.
 * @param sessionId - session to inspect.
 * @returns the provider/model, or undefined when unknown.
 */
function sessionModel(ctx: Context, sessionId: string): { provider: string; model: string } | undefined {
  try {
    const sessions = ctx.get('sessions') as SessionsService | undefined
    const header = sessions?.get(sessionId)?.requestHeader()
    const config = header?.config
    if (config === undefined) return undefined
    const provider = config.provider
    const model = config.model
    if (provider === undefined || model === undefined) return undefined
    return { provider, model }
  } catch (_sessionUnavailable) {
    return undefined
  }
}

/**
 * Mount the diffusion status/toggle route. GET reports what the capability
 * probe concluded for the Session's current model and whether diffusion is
 * preferred for it; POST records the preference and persists it through the
 * settings service, so nothing here ever asks a person to hand-edit a file.
 * @param ctx - context that owns `ctx.connection` (and sessions).
 * @param state - the person's diffusion preference.
 * @param capability - probe verdicts already measured for a route/model pair.
 * @param probe - on-demand measurement for a route/model pair.
 * @param defaultSelection - the model a Session without a request header would use.
 * @param persist - writes one preference into the user settings so it survives a restart.
 */
export function applyDiffusionRoute(
  ctx: Context,
  state: DiffusionState,
  capability: DiffusionCapability,
  probe: (provider: string, model: string) => Promise<ProbeOutcome>,
  defaultSelection: () => { provider: string; model: string } | undefined,
  persist: (provider: string, model: string, enabled: boolean) => Promise<void>,
): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: DIFFUSION_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      if (request.method === 'GET') {
        const session = url.searchParams.get(SESSION_QUERY)
        // The caller's explicit selection wins: the composer may already point at
        // a different model than the Session's last request header recorded.
        const askedProvider = url.searchParams.get('provider')
        const askedModel = url.searchParams.get('model')
        const asked = askedProvider !== null && askedModel !== null ? { provider: askedProvider, model: askedModel } : undefined
        const live = asked ?? (session === null ? undefined : sessionModel(ctx, session)) ?? defaultSelection()
        const provider = live?.provider ?? ''
        const model = live?.model
        // Opening a conversation asks the upstream once; the answer is cached,
        // so only the first visit pays for it. `detail` names the step that
        // decided, which is what explains a toggle that never appears.
        const cached = model === undefined || provider.length === 0 ? undefined : capability.verdictOf(provider, model)
        const measured = cached === undefined && model !== undefined && provider.length > 0
          ? await probe(provider, model)
          : undefined
        const verdict = cached ?? measured?.verdict
        const detail = measured?.detail ?? (cached === undefined ? 'no-selection' : 'measured')
        // Diffusion stays off until the person accepts the offer, so the offer is
        // what introduces it rather than a surprise on the first answer.
        const enabled = model === undefined ? false : state.isEnabled({ provider, model }, false)
        // `decided` separates "never asked" from "asked and turned off": only the
        // former is worth re-asking when the conversation is opened again.
        const decided = model !== undefined && state.has({ provider, model })
        return Response.json({ ok: true, provider, model, verdict, detail, supported: verdict === 'yes', enabled, decided })
      }
      let raw: unknown
      try { raw = await request.json() } catch (_badJson) {
        return new Response('{"ok":false,"error":"invalid json"}', { status: 400 })
      }
      const body = raw as { model?: unknown; enabled?: unknown; provider?: unknown }
      const model = typeof body.model === 'string' ? body.model : ''
      const provider = typeof body.provider === 'string' ? body.provider : ''
      const enabled = body.enabled === true
      if (model.length === 0 || provider.length === 0) {
        return new Response('{"ok":false,"error":"provider and model are required"}', { status: 400 })
      }
      state.set({ provider, model }, enabled)
      await persist(provider, model, enabled)
      return Response.json({ ok: true, provider, model, enabled })
    },
  }), 'mercury-diffusion: diffusion route')
}
