/**
 * Credential resolution shared by the bridge and the diffusion route.
 *
 * A route names a credential reference; the value comes from the host's
 * credential plane when one is composed, and from the launch environment
 * otherwise. Both readers live here so the two call sites cannot drift apart.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Credential reference read when a route names none, matching the bundled gateway. */
export const DEFAULT_KEY_ENV = 'MAGPIE_GATEWAY_KEY'

/** Credential plane face this plugin needs, when the host composes one. */
export interface CredentialsService {
  resolve(ref: string): Promise<{ value?: string } | undefined>
}

/**
 * Read the credential plane without requiring it: the plugin loads in
 * compositions that have none.
 * @param ctx - plugin context.
 * @returns the service, or undefined when absent.
 */
export function credentialsOf(ctx: Context): CredentialsService | undefined {
  return ctx.get('credentials') as CredentialsService | undefined
}

/**
 * Resolve one credential reference, preferring the host plane over the process
 * environment.
 * @param ctx - plugin context carrying an optional credentials service.
 * @param ref - reference name such as `MAGPIE_GATEWAY_KEY`.
 * @returns the trimmed value, or undefined when neither layer supplies one.
 */
export async function resolveCredential(ctx: Context, ref: string): Promise<string | undefined> {
  const credentials = credentialsOf(ctx)
  if (credentials !== undefined) {
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved?.value !== undefined && resolved.value.trim().length > 0) return resolved.value.trim()
    } catch (_credentialsUnavailable) {
      // Fall through to the process environment.
    }
  }
  const fromEnv = process.env[ref]
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined
}
