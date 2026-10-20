/** Browser entry: in-bubble diffusion rendering and the plugin's Configure page. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { FrameSources } from './frame-source.ts'
import { en, NS, zh, type MercuryKey } from './locales.ts'
import { MercuryAssistantNode, type MercuryAssistantInject } from './MercuryAssistant.tsx'
import { MercurySettings, ROW_CONFIG_KEY } from './MercurySettings.tsx'
import { installStyles } from './styles.ts'
import { DiffusionPresence, type DiffusionPresenceInject } from './DiffusionPresence.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Mercury Configure page. */
    'mercury-diffusion': MercuryKey
  }
}

/** Package name owning the style tag, as dsh stamps plugin styles. */
const PLUGIN_ID = 'dsh-mercury-diffusion'

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
 * Replace the assistant-step renderer and register the Configure page.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mercury-diffusion: dictionaries')
  ctx.effect(() => installStyles(PLUGIN_ID), 'mercury-diffusion: styles')
  const sources = new FrameSources()
  ctx.effect(() => () => { sources.dispose() }, 'mercury-diffusion: frame streams')
  // A displayed Session follows its frames before any assistant bubble exists; the Host asks for
  // `diffusing` only while someone follows, so a new chat's first answer also diffuses.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mercury-diffusion-presence',
    inject: (sessionId: string): DiffusionPresenceInject => ({ hooks: { diffusion: sources.source(sessionId) } }),
  }, DiffusionPresence))
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
  // Gives the row a Configure control on the Plugins page while that page is mounted.
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
    name: 'plugins.row.config',
    key: ROW_CONFIG_KEY,
    locale: NS,
  }, MercurySettings))
}
