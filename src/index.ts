/**
 * Host entry: registers the Mercury provider route and, when the Web Connection
 * is present, the frames route that feeds the browser diffusion dock.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { MercuryAdapter } from './adapter.ts'
import { assertModels, Config } from './config.ts'
import { DiffusionHub } from './frames.ts'
import { applyFramesRoute } from './route.ts'

export { Config } from './config.ts'
export type { MercuryModel } from './config.ts'
export type { DiffusionOutcome, DiffusionWireFrame } from './shared.ts'

/** Plugin name shown in diagnostics and the plugin list. */
export const name = 'mercury-diffusion'

/** The adapter registry; the frames route waits separately for `connection`. */
export const inject = ['llm']

/**
 * Register the adapter and mount the frames route as a child plugin, so a
 * composition without the Web Connection (headless, ACP) still serves the
 * provider with ordinary streaming.
 * @param ctx - plugin context.
 * @param config - validated configuration.
 * @throws {Error} for an invalid model list.
 */
export function apply(ctx: Context, config: Config): void {
  assertModels(config.models)
  const logger = ctx.logger('mercury-diffusion')
  if (config.apiKey.get() === undefined) {
    logger.warn('no API key is set; Mercury requests fail until one is set in Plugins → dsh-mercury-diffusion → Configure or INCEPTION_API_KEY')
  }
  const hub = new DiffusionHub((error) => { logger.warn('frame viewer failed and was detached', error) })
  ctx.llm.registerAdapter([config.provider], new MercuryAdapter(config, hub))
  // The browser half ships its own Configure page instead of a schema-generated one.
  ctx.inject(['settings'], (settings: Context) => {
    settings.effect(() => settings.settings.configure({ auto: false }, ctx.fiber), 'mercury-diffusion: settings page policy')
  })
  ctx.plugin({
    name: 'mercury-diffusion-frames',
    inject: ['connection'],
    apply: (child: Context) => { applyFramesRoute(child, hub, config.heartbeatMs) },
  })
}
