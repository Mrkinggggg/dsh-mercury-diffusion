/**
 * Auto-discovery of provider routes this plugin may bridge.
 *
 * A gateway route serves `inception/mercury-3` through an adapter that never
 * sends `diffusing`, so the bridge needs that route's endpoint and credential to
 * re-issue the request itself. Both live in the stored provider profiles, which
 * are the authoritative source: the provider directory only supplies
 * presentation defaults. Reading the profiles directly is what makes a route
 * added a moment ago visible without waiting for the directory to catch up.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { DEFAULT_KEY_ENV } from './credentials.ts'
import { settingsOf } from './settings.ts'
import type { BridgeRoute } from './shared.ts'

/** Endpoint assumed for a route that names none; the bundled gateway listens here. */
const FALLBACK_BASE_URL = 'http://127.0.0.1:3425/v1'

/** Read one nested member of a settings value, or undefined when any hop is absent. */
function at(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let node: unknown = value
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'object' && node !== null ? node as Record<string, unknown> : undefined
}

function text(field: unknown): string | undefined {
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined
}

/**
 * Build one route from a stored profile, falling back to the provider directory
 * for an endpoint or credential the profile does not name.
 * @param provider - provider route key.
 * @param profile - the stored provider profile.
 * @param entry - the directory entry for this route, when the directory lists it.
 * @returns the bridge route.
 */
function routeFrom(
  provider: string,
  profile: Record<string, unknown>,
  entry: LlmConfigurableProvider | undefined,
): BridgeRoute {
  const baseURL = text(profile['baseURL'])
    ?? text(entry?.defaultBaseURL)
    ?? FALLBACK_BASE_URL
  const apiKeyEnv = text(profile['apiKeyEnv'])
    ?? text(entry?.baseURLEnv?.[0])
    ?? text(entry?.nativeAuth?.env[0])
    ?? DEFAULT_KEY_ENV
  return { provider, baseURL, apiKeyEnv }
}

/**
 * Enumerate every stored provider route with the endpoint and credential needed
 * to interrogate it. Model names are deliberately not consulted: the capability
 * probe decides per model whether `diffusing` is honored, so a route is a
 * candidate simply by being configured.
 * @param ctx - context carrying `llm` and, once mounted, `settings`.
 * @returns one candidate route per configured provider.
 */
export async function discoverBridgeRoutes(ctx: Context): Promise<BridgeRoute[]> {
  const directory = (() => {
    try { return ctx.llm.listConfigurableProviders() } catch (_directoryUnavailable) { return [] }
  })()
  const described = (() => {
    try { return settingsOf(ctx)?.describe({ redactSecrets: false }) ?? [] } catch (_settingsUnavailable) { return [] }
  })()
  const routes = new Map<string, BridgeRoute>()
  for (const section of described) {
    const providers = at(section.value, ['providers'])
    if (providers === undefined) continue
    for (const provider of Object.keys(providers)) {
      const profile = at(providers, [provider])
      if (profile === undefined) continue
      routes.set(provider, routeFrom(provider, profile, directory.find(entry => entry.provider === provider)))
    }
  }
  return [...routes.values()]
}
