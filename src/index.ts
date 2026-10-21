/**
 * Host entry: adds live diffusion playback to whatever provider route serves
 * Mercury, and mounts the frames route that feeds the browser dock.
 *
 * It deliberately registers no provider of its own. dsh's model settings render
 * a real card only for the `llm-deepseek` and `llm-pi-ai` namespaces; a plugin
 * namespace lands on a placeholder that only says "edit cordis.patch.yml". So
 * the Inception endpoint is added on that page like any other custom provider,
 * and this plugin supplies the diffusion layer underneath it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { discoverBridgeRoutes } from './auto-bridge.ts'
import { applyBridge } from './bridge.ts'
import { DiffusionCapability } from './capability.ts'
import { Config } from './config.ts'
import { resolveCredential } from './credentials.ts'
import { DiffusionState } from './diffusion-state.ts'
import { DiffusionHub } from './frames.ts'
import { applyDiffusionRoute, applyFramesRoute } from './route.ts'
import { settingsOf } from './settings.ts'
import type { BridgeRoute, ProbeOutcome } from './shared.ts'

export { Config } from './config.ts'

/** Plugin name shown in diagnostics and the plugin list. */
export const name = 'mercury-diffusion'

/** The provider registry the bridge bridges against. */
export const inject = ['llm']

/** Settings section this plugin's own configuration lives under. */
const SETTINGS_NS = 'mercury-diffusion'

/**
 * Install the diffusion layer, mount the frames route, and keep route discovery
 * current as providers come and go.
 * @param ctx - plugin context.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('mercury-diffusion')
  const hub = new DiffusionHub((error) => { logger.warn('frame viewer failed and was detached', error) })
  const capability = new DiffusionCapability()
  const diffusion = new DiffusionState(config.diffusion.get())
  let discovered: readonly BridgeRoute[] = []

  /**
   * Refresh the candidate routes. Called at load, on provider/settings changes,
   * and lazily whenever a lookup finds nothing — the provider directory can
   * settle after this plugin loads, and an empty table must never be permanent.
   * @returns the routes now known.
   */
  const rediscover = async (): Promise<readonly BridgeRoute[]> => {
    try {
      discovered = await discoverBridgeRoutes(ctx)
    } catch (error) {
      logger.warn('route discovery failed', error)
    }
    return discovered
  }

  /** Look up one route, refreshing once when the table is empty. */
  const routeOf = async (provider: string): Promise<BridgeRoute | undefined> => {
    const known = discovered.find(candidate => candidate.provider === provider)
    if (known !== undefined) return known
    const refreshed = await rediscover()
    return refreshed.find(candidate => candidate.provider === provider)
  }

  // Measured per route and model; nothing here needs configuring.
  applyBridge(ctx, () => discovered, () => { void rediscover() }, hub, diffusion, capability, config.frameIntervalMs, config.streamIdleTimeoutMs)

  /**
   * The model a conversation would use before it has sent anything: the
   * configured agent default. Without this a brand-new Session has no request
   * header yet, so the toggle would stay silent until the first answer landed.
   * @returns the configured default provider/model, or undefined when unset.
   */
  const defaultSelection = (): { provider: string; model: string } | undefined => {
    try {
      // Only provider and model are read here, so redaction does not matter.
      const section = settingsOf(ctx)?.describe().find(entry => entry.ns === 'agent-default-model')
      const value = section?.value as { provider?: unknown; model?: unknown } | undefined
      if (typeof value?.provider !== 'string' || typeof value.model !== 'string') return undefined
      return { provider: value.provider, model: value.model }
    } catch (_settingsUnavailable) {
      return undefined
    }
  }

  /**
   * Probe one route/model pair on demand — this is what the conversation toggle
   * asks when a conversation opens, so the offer only appears once the upstream
   * has been measured.
   * @param provider - provider route key.
   * @param model - model id about to be used.
   * @returns the settled verdict.
   */
  const probe = async (provider: string, model: string): Promise<ProbeOutcome> => {
    const cached = capability.verdictOf(provider, model)
    if (cached !== undefined) return { verdict: cached, detail: 'measured' }
    const route = await routeOf(provider)
    if (route === undefined) return { verdict: 'unknown', detail: 'no-route' }
    const apiKey = await resolveCredential(ctx, route.apiKeyEnv)
    if (apiKey === undefined) return { verdict: 'unknown', detail: 'no-credential' }
    return { verdict: await capability.verdict({ provider, model, baseURL: route.baseURL, apiKey }), detail: 'measured' }
  }

  /**
   * Store one preference in dsh's own user settings, so the choice survives a
   * restart without anyone editing a configuration file. The live in-memory
   * state is authoritative; a failed write only costs durability.
   * @param provider - provider route key.
   * @param model - model id.
   * @param enabled - the state to remember.
   */
  const persist = async (provider: string, model: string, enabled: boolean): Promise<void> => {
    const settings = settingsOf(ctx)
    if (settings === undefined) return
    try {
      await settings.mutate(SETTINGS_NS, [
        { op: 'set', path: ['diffusion', `${provider}::${model}`], value: enabled },
      ])
    } catch (error) {
      logger.warn('diffusion preference could not be saved', error)
    }
  }

  ctx.effect(() => {
    void rediscover()
    const offAdapters = ctx.on('llm/adapters-updated', () => { void rediscover() })
    return () => { offAdapters() }
  }, 'mercury-diffusion: route discovery')
  ctx.inject(['settings'], (settings: Context) => {
    settings.effect(() => {
      void rediscover()
      const offSettings = settings.on('settings/document-updated', () => { void rediscover() })
      return () => { offSettings() }
    }, 'mercury-diffusion: route rediscovery')
  })

  ctx.plugin({
    name: 'mercury-diffusion-frames',
    inject: ['connection', 'sessions'],
    apply: (child: Context) => {
      applyFramesRoute(child, hub, config.heartbeatMs)
      applyDiffusionRoute(child, diffusion, capability, probe, defaultSelection, persist)
    },
  })
}
