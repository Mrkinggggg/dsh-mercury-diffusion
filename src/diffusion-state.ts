/**
 * User preference for diffusion, keyed per provider route and model.
 *
 * Capability is measured separately (see `capability.ts`); this only records
 * what the person chose. An unrecorded pair is off: the conversation toggle is
 * what offers diffusion the first time a capable model is used, so nobody gets
 * a different rendering without asking for it.
 */

/** Identity of one model on one route. */
export interface DiffusionTarget {
  provider: string
  model: string
}

function keyOf(target: DiffusionTarget): string {
  return `${target.provider}::${target.model}`
}

export class DiffusionState {
  private readonly chosen = new Map<string, boolean>()

  /**
   * @param stored - persisted preferences from plugin config, keyed `<provider>::<model>`.
   */
  constructor(stored: Readonly<Record<string, boolean>> = {}) {
    for (const [key, enabled] of Object.entries(stored)) this.chosen.set(key, enabled)
  }

  /**
   * Whether the person has decided anything for this pair. "Not decided yet" and
   * "decided off" are different answers: only the former earns a question.
   * @param target - provider route and model.
   * @returns whether a choice is recorded.
   */
  has(target: DiffusionTarget): boolean {
    return this.chosen.has(keyOf(target))
  }

  /**
   * Resolve the preference, applying the caller's default for an unset pair.
   * @param target - provider route and model.
   * @param fallback - value used when no choice was recorded.
   * @returns whether diffusion is preferred for this pair.
   */
  isEnabled(target: DiffusionTarget, fallback: boolean): boolean {
    return this.chosen.get(keyOf(target)) ?? fallback
  }

  /**
   * Record a choice for one pair.
   * @param target - provider route and model.
   * @param enabled - the new preference.
   */
  set(target: DiffusionTarget, enabled: boolean): void {
    this.chosen.set(keyOf(target), enabled)
  }
}
