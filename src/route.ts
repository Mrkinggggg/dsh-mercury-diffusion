/** Exact Connection route streaming one Session's live diffusion frames to a Web Client. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { DiffusionHub } from './frames.ts'
import { FRAMES_ROUTE_PATH, SESSION_QUERY, type DiffusionWireFrame } from './shared.ts'

const encoder = new TextEncoder()

function sseData(frame: DiffusionWireFrame): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
}

/**
 * Mount the frames route. Each response follows one Session until the Client
 * disconnects or this plugin unloads; Connection admits only owner Peers.
 * @param ctx - context that owns `ctx.connection`.
 * @param hub - viewer registry fed by the adapter.
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
