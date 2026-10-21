/** Browser entry: in-bubble diffusion rendering and the conversation toggle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { FrameSources, IDLE_VIEW, type DiffusionView } from './frame-source.ts'
import { en, NS, zh, type MercuryKey } from './locales.ts'
import { MercuryAssistantNode, type MercuryAssistantInject } from './MercuryAssistant.tsx'
import { MercuryDock, type MercuryDockInject } from './MercuryDock.tsx'
import { installStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The diffusion toggle copy. */
    'mercury-diffusion': MercuryKey
  }
}

/** Package name owning the style tag, as dsh stamps plugin styles. */
const PLUGIN_ID = 'dsh-mercury-diffusion'

/**
 * A never-changing frame source for the Session-less seat. That seat shows no
 * canvas of its own — there is no Session to stream frames for — but the shared
 * component still requires the hook.
 */
const IDLE_SOURCE: HostObservable<DiffusionView> = {
  getSnapshot: () => IDLE_VIEW,
  subscribe: () => () => {},
}

/**
 * Shadowing rank of the assistant renderer. ui-chat registers its own at the
 * default rank 0; the lower rank renders, and unloading this plugin restores ui-chat's.
 */
const ASSISTANT_PRIORITY = -10

/** Plugin name shown in client diagnostics. */
export const name = 'mercury-diffusion'

/** Slot registration and localized copy. */
export const inject = ['slots', 'locale']

/**
 * Replace the assistant-step renderer and mount the conversation dock. The
 * provider's own settings are dsh's native model settings, so this half
 * registers no configuration page.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mercury-diffusion: dictionaries')
  ctx.effect(() => installStyles(PLUGIN_ID), 'mercury-diffusion: styles')
  const sources = new FrameSources()
  ctx.effect(() => () => { sources.dispose() }, 'mercury-diffusion: frame streams')
  // A displayed Session follows its frames before any assistant bubble exists; the Host asks for
  // `diffusing` only while someone follows, so a new chat's first answer also diffuses.
  // The same dock hosts the diffusion toggle for the composer's current model.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mercury-diffusion-dock',
    locale: NS,
    inject: (sessionId: string): MercuryDockInject => ({
      sessionId: sessionId as string | undefined,
      hooks: { diffusion: sources.source(sessionId) },
    }),
  }, MercuryDock))
  // A brand-new conversation has no Session yet, and the Session seat above
  // therefore does not exist. This root-scope seat covers that state: it asks the
  // Host about the default model and stands down once a Session seat mounts.
  ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    locale: NS,
    inject: (): MercuryDockInject => ({ sessionId: undefined, hooks: { diffusion: IDLE_SOURCE } }),
  }, MercuryDock))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    priority: ASSISTANT_PRIORITY,
    // ui-chat's namespace: the ported rendering uses Chat's own Markdown and reasoning copy.
    locale: 'chat',
    inject: (sessionId: string): MercuryAssistantInject => {
      const source = sources.source(sessionId)
      return { hooks: { diffusion: source }, claimDiffusion: source.claim }
    },
  }, MercuryAssistantNode))
}
