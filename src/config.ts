/** Validated configuration: framing and timeout knobs only. */

import Schema from '@deepseek-ai/schemastery'

/**
 * The plugin owns no provider configuration.
 *
 * Every provider route it bridges is one the person already added in dsh's own
 * model settings — hand-declared or custom, the plugin does not care which — so
 * there is no provider name or endpoint to configure here. `diffusion` is the
 * only state it keeps, and the conversation toggle writes it through dsh's
 * settings service, the same store every other preference lives in.
 */
export const Config = Schema.object({
  /**
   * Per-model diffusion preference, keyed `<provider>::<model>`. Written by the
   * conversation toggle; absent means "not decided yet".
   */
  diffusion: Schema.dict(Schema.boolean()).default({}).volatile().description('Per-model diffusion preference.'),
  /**
   * Minimum spacing between frames published to viewers; the newest skipped
   * frame is sent when the interval elapses or the attempt ends.
   */
  frameIntervalMs: Schema.natural().default(0),
  /** Abort a bridged stream that delivers no SSE event for this long. */
  streamIdleTimeoutMs: Schema.natural().min(1).default(300_000),
  /** Comment written to each open frames stream at this interval so proxies keep it open. */
  heartbeatMs: Schema.natural().min(1).default(15_000),
})

/** Plugin configuration after schema defaults. */
export type Config = ReturnType<typeof Config>
