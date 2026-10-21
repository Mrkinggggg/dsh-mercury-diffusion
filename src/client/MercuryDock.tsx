/**
 * Input-zone dock entry: keeps the Session's frames stream open (presence) and
 * exposes a diffusion toggle for the model the composer would use next.
 *
 * Once the capability probe confirms the model, the launcher is always present:
 * collapsed it is a small Inception-marked button on the conversation's right
 * edge, expanded it is a one-line question with a single toggle button whose
 * label follows the current state. The probe runs on every new Session, every
 * re-entry, and every model switch; a capable model with diffusion off opens
 * the question automatically, and one with diffusion on stays collapsed.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HostObservable, PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffusionView } from './frame-source.ts'
import { INCEPTION_ICON } from './icon.ts'
import { DIFFUSION_ROUTE, SESSION_QUERY } from '../shared.ts'
import { NS } from './locales.ts'
import { CLASS } from './styles.ts'

/**
 * Inject face of a dock registration. The Session-scoped seat passes `sessionId`;
 * the Session-less seat (a brand-new conversation, which has no Session yet)
 * passes `root` and lets the Host resolve the default model instead.
 */
export interface MercuryDockInject {
  sessionId: string | undefined
  hooks: { diffusion: HostObservable<DiffusionView> }
}

/**
 * Composed props. Written explicitly rather than as one slot's runtime share:
 * the same component serves the Session seat and the Session-less seat, and only
 * the former receives a Session id and the projection reader.
 */
type Props = PropsLocale<typeof NS>
  & Omit<MercuryDockInject, 'hooks'>
  & PropsHooks<MercuryDockInject['hooks']>
  & {
    /** Present in the Session seat, absent in the Session-less one. */
    sessionId?: string
    /** Host-computed projections; Session scope only. */
    useProjection?: (key: string) => unknown
    /** Session lifecycle selector; Session scope only. */
    useSession?: (selector: (snapshot: { blank?: boolean }) => boolean) => boolean
  }

/**
 * How many Session-scoped docks are mounted. The Session-less seat exists only
 * to cover conversations that have no Session yet, so it stands down as soon as
 * a real conversation takes over — one toggle, never two.
 */
let sessionDocks = 0
const presenceListeners = new Set<() => void>()

function notifyPresence(): void {
  for (const listener of [...presenceListeners]) listener()
}

function subscribePresence(listener: () => void): () => void {
  presenceListeners.add(listener)
  return () => { presenceListeners.delete(listener) }
}

function useSessionDockMounted(): boolean {
  return useSyncExternalStore(subscribePresence, () => sessionDocks > 0, () => false)
}

interface DiffusionStatus {
  ok: boolean
  provider?: string
  model?: string
  /** Probe verdict: whether the upstream accepts the diffusion field. */
  verdict?: 'yes' | 'no' | 'unknown'
  supported: boolean
  enabled: boolean
  /** Whether a preference was ever recorded; false means "never asked". */
  decided?: boolean
  /** Which step decided the verdict: measured, no-route, no-credential, no-selection. */
  detail?: string
}

const EMPTY_STATUS: DiffusionStatus = { ok: false, supported: false, enabled: false }

/** One entry of the composer's model selection projection. */
interface ModelChoice {
  provider?: string
  model?: string
}

/**
 * Host-computed projection of the composer's model selection. `next` is the
 * explicit choice and is absent while the composer sits on the default — which
 * is itself information: the Host, not a stale previous model, resolves it.
 */
interface SelectionProjection {
  next?: ModelChoice
}

/**
 * Read the diffusion status for a Session.
 * @param sessionId - Session being viewed; absent for a not-yet-created conversation.
 * @param provider - explicitly chosen provider route, when the composer has one.
 * @param model - explicitly chosen model id, when the composer has one.
 * @returns the status, or the empty status when the route cannot answer.
 */
async function readStatus(sessionId: string | undefined, provider: string | undefined, model: string | undefined): Promise<DiffusionStatus> {
  const query = new URLSearchParams()
  if (sessionId !== undefined) query.set(SESSION_QUERY, sessionId)
  if (provider !== undefined && model !== undefined) {
    query.set('provider', provider)
    query.set('model', model)
  }
  try {
    const response = await fetch(`${DIFFUSION_ROUTE}?${query.toString()}`, { cache: 'no-store' })
    return response.ok ? await response.json() as DiffusionStatus : EMPTY_STATUS
  } catch (_statusUnavailable) {
    return EMPTY_STATUS
  }
}

/**
 * Record the diffusion preference for one route/model pair.
 * @param provider - provider route key.
 * @param model - model id.
 * @param enabled - the state to store.
 * @returns whether the Host accepted the write.
 */
async function writePreference(provider: string, model: string, enabled: boolean): Promise<boolean> {
  try {
    const response = await fetch(DIFFUSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, enabled }),
    })
    return response.ok
  } catch (_writeFailed) {
    return false
  }
}

function ignoreView(): null {
  return null
}

/**
 * Models whose question has already been shown in this page lifetime.
 *
 * The offer must outlive a component instance — a new conversation goes from
 * "no Session" to "Session" as soon as its first message lands, which unmounts
 * one seat and mounts the other — and it must not depend on Session identity,
 * or the second seat would ask the same question again. Keying on the model
 * alone makes "asked once per page" true across seats, conversations, and the
 * blank → active transition; a page reload clears it.
 */
const presented = new Set<string>()

function offerKey(provider: string, model: string): string {
  return `${provider}::${model}`
}

/**
 * Presence + diffusion toggle dock.
 * @param props - composed slot props.
 * @returns the launcher, the expanded question, or nothing while the model is unmeasured.
 */
export function MercuryDock(props: Props) {
  const { sessionId, useDiffusion, t } = props
  useDiffusion(ignoreView)
  const isSessionSeat = sessionId !== undefined
  const coveredBySession = useSessionDockMounted()
  // The Session-less seat exists only while no real conversation is mounted.
  const dormant = !isSessionSeat && coveredBySession
  // Session-scope slots receive the projection reader; the composer's explicit
  // choice is the authority. An absent choice means "default", not "last used".
  const readProjection = props.useProjection
  const selection = readProjection?.('modelSelection') as SelectionProjection | undefined
  const provider = selection?.next?.provider
  const model = selection?.next?.model
  // Only a conversation that has not started yet may open the question by itself.
  // Once the Session carries content, the model is committed to an exchange and a
  // popup would be an interruption — the launcher stays the only entry point.
  const readSession = props.useSession
  const pristine = isSessionSeat && readSession !== undefined ? readSession(snapshot => snapshot.blank === true) : true

  const [status, setStatus] = useState<DiffusionStatus | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const card = useRef<HTMLDivElement | null>(null)

  // Register this seat so the Session-less one knows a real conversation owns
  // the toggle and stands down.
  useEffect(() => {
    if (!isSessionSeat) return
    sessionDocks += 1
    notifyPresence()
    return () => {
      sessionDocks -= 1
      notifyPresence()
    }
  }, [isSessionSeat])

  // Clicking anywhere outside the card, or pressing Escape, collapses it back to
  // the launcher — the same result as the × button.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const element = card.current
      if (element !== null && event.target instanceof Node && element.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  useEffect(() => {
    let alive = true
    setOpen(false)
    setStatus(undefined)
    // A dormant seat renders nothing, so it must not mark the question as asked
    // either — that would suppress the offer in the next conversation.
    if (dormant) return
    // A brand-new conversation may have no Session id yet; the Host still knows
    // the default model, so the question can be asked before the first message.
    void readStatus(sessionId, provider, model).then((next) => {
      if (!alive) return
      // Kept where a person can read it back without the network panel.
      try {
        globalThis.localStorage?.setItem('dsh-mercury-last-status', JSON.stringify(next))
        if (globalThis.localStorage?.getItem('dsh-mercury-debug') === '1') console.info('[mercury-diffusion] status', next)
      } catch (_storageBlocked) {
        // A blocked store only loses the diagnostic copy.
      }
      // Only a measured-capable model gets a launcher; `unknown` shows nothing.
      if (!next.supported || next.provider === undefined || next.model === undefined) return
      setStatus(next)
      // Ask only while the question is open AND this page has not asked it for
      // this model yet. The second condition is what keeps the offer from
      // reappearing when the Session-less seat hands over to the Session seat.
      const key = offerKey(next.provider, next.model)
      const open = pristine && next.decided !== true && !presented.has(key)
      if (open) presented.add(key)
      setOpen(open)
    })
    return () => { alive = false }
  }, [sessionId, provider, model, dormant])

  const toggle = async (): Promise<void> => {
    if (status?.provider === undefined || status.model === undefined) return
    const target = { provider: status.provider, model: status.model }
    setBusy(true)
    const enabled = !status.enabled
    const ok = await writePreference(target.provider, target.model, enabled)
    setBusy(false)
    if (!ok) return
    setStatus({ ...status, enabled, decided: true })
  }

  const dismiss = (): void => {
    // Marking the model as asked is what keeps the next seat quiet; the entry
    // was already recorded when the question opened, so this only needs to close.
    if (status?.provider !== undefined && status.model !== undefined) {
      presented.add(offerKey(status.provider, status.model))
    }
    setOpen(false)
  }

  if (dormant || status === undefined) return null

  if (!open) {
    return (
      <button
        type="button"
        className={`${CLASS}-hint__launcher`}
        data-enabled={status.enabled || undefined}
        aria-label={t('hint.title')}
        title={`${t('hint.title')} · ${status.enabled ? t('hint.on') : t('hint.off')}`}
        onClick={() => setOpen(true)}
        // The Session-less seat lives inside the draggable header strip.
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <img className={`${CLASS}-hint__icon`} src={INCEPTION_ICON} alt="" aria-hidden />
      </button>
    )
  }

  return (
    <div
      className={`${CLASS}-hint`}
      role="dialog"
      aria-live="polite"
      ref={card}
      // The Session-less seat lives inside the draggable header strip.
      onPointerDown={(event) => { event.stopPropagation() }}
    >
      <div className={`${CLASS}-hint__head`}>
        <img className={`${CLASS}-hint__badge`} src={INCEPTION_ICON} alt="" aria-hidden />
        <span className={`${CLASS}-hint__title`}>{t('hint.title')}</span>
        <button type="button" className={`${CLASS}-hint__close`} aria-label={t('hint.dismiss')} onClick={dismiss}>×</button>
      </div>
      <div className={`${CLASS}-hint__body`}>{t('hint.body')}</div>
      <button
        type="button"
        className={`${CLASS}-hint__toggle`}
        data-on={status.enabled || undefined}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {status.enabled ? t('hint.disable') : t('hint.enable')}
      </button>
    </div>
  )
}
