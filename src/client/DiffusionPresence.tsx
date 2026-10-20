/** Invisible input-zone entry that keeps the displayed Session's frames stream open. */

import type { HostObservable, PropsHooks, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DiffusionView } from './frame-source.ts'

/** Inject face of the presence registration. */
export interface DiffusionPresenceInject {
  hooks: { diffusion: HostObservable<DiffusionView> }
}

type Props = PropsRuntime<'conversation.input.dock'> & PropsHooks<DiffusionPresenceInject['hooks']>

function ignoreView(): null {
  return null
}

/**
 * Subscribe to the Session's diffusion source for as long as its input zone is
 * mounted. The subscription is what tells the Host a viewer exists.
 * @param props - composed slot props.
 * @returns nothing visible.
 */
export function DiffusionPresence({ useDiffusion }: Props) {
  useDiffusion(ignoreView)
  return null
}
