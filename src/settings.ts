/**
 * The user-settings service, read without requiring it.
 *
 * Discovery runs from fibers that do not inject `settings`, and a composition
 * without the service must still serve the provider directory's defaults, so the
 * accessor is shared instead of re-declared per module.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Read face: namespaces and their resolved values. */
export interface SettingsReader {
  describe(options?: { redactSecrets?: boolean }): { ns: string; value?: unknown }[]
}

/** Read and write face: the same view plus path-addressed edits. */
export interface SettingsService extends SettingsReader {
  mutate(ns: string, ops: { op: 'set'; path: string[]; value: unknown }[], expectedRevision?: number): Promise<void>
}

/**
 * Read the settings service without requiring it.
 * @param ctx - plugin context.
 * @returns the service, or undefined when the host has none.
 */
export function settingsOf(ctx: Context): SettingsService | undefined {
  return ctx.get('settings') as SettingsService | undefined
}
