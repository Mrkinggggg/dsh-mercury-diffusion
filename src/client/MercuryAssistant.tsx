/**
 * Replacement `conversation.chat.node[assistant-step]` renderer. While a
 * Mercury attempt diffuses, its bubble shows the denoising frames in place, as
 * chat.inceptionlabs.ai does; every other state renders like dsh ui-chat's own
 * AssistantNodeView (ported, MIT), reusing the official reasoning and image
 * Factories. A keyed cell can only be replaced, not wrapped, which is why the
 * normal path is ported here.
 */

import { Fragment, memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { DisclosureRow, IconThinkOutlineRegular, JsonBlock, MarkdownText, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, PropsHooks } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, ChatNodeViewProps, TurnTailOwnerProps, UseDisclosure, UseGroupAction,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DiffusionView } from './frame-source.ts'
import { CLASS } from './styles.ts'

/** Inject face of the renderer registration. */
export interface MercuryAssistantInject {
  hooks: { diffusion: HostObservable<DiffusionView> }
  /** Bind the current attempt to one bubble; see `SessionFrameSource.claim`. */
  claimDiffusion: (attempt: string, owner: string, text: string, streaming: boolean) => boolean
}

/** Composed renderer props. */
export type MercuryAssistantProps =
  & ChatNodeViewProps<'assistant-step'>
  & PropsHooks<MercuryAssistantInject['hooks']>
  & Omit<MercuryAssistantInject, 'hooks'>

type Translate = MercuryAssistantProps['t']
type RenderFactorySlot = MercuryAssistantProps['renderFactorySlot']

function selectView(view: DiffusionView): DiffusionView {
  return view
}

/**
 * Render one assistant step.
 * @param props - composed slot props.
 * @returns the diffusion frames of a claimed attempt, otherwise the ported native rendering.
 */
export const MercuryAssistantNode = memo(function MercuryAssistantNode({
  node, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions,
  renderFactorySlot, useDiffusion, claimDiffusion, t,
}: MercuryAssistantProps) {
  const data = node.data
  const view = useDiffusion(selectView)
  const owner = `${data.turn}:${data.step}`
  const answer = useMemo(() => data.blocks.map(block => block.kind === 'text' ? block.text : '').join(''), [data.blocks])
  // A bubble binds the attempt that produced it and keeps it through playback.
  const [attempt, setAttempt] = useState<string | undefined>(undefined)
  if (attempt === undefined && view.phase === 'diffusing'
    && claimDiffusion(view.attempt, owner, answer, data.status === 'running')) {
    setAttempt(view.attempt)
  }

  const turn = node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn : undefined
  const tail = useTurnData('turn-tail')
  const tailOwner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(() => tailOwner === undefined ? undefined : fileMentions(tailOwner), [fileMentions, tailOwner])
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])

  if (view.phase === 'diffusing' && view.attempt === attempt && groupPart !== 'reasoning') {
    return <DiffusionBody view={view} />
  }
  return (
    <AssistantBody
      blocks={data.blocks}
      groupPart={groupPart}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      useDisclosure={useDisclosure}
      useGroupAction={useGroupAction}
      renderFactorySlot={renderFactorySlot}
      mentions={mentions}
      t={t}
    />
  )
})

/** Frames rendered as one muted run that fades in as it converges. */
function DiffusionBody({ view }: { view: Extract<DiffusionView, { phase: 'diffusing' }> }) {
  const text = view.segments.map(segment => segment.text).join('')
  return (
    <div className={`${CLASS}-assistant`} data-streaming>
      <div className={`${CLASS}-assistant__body`}>
        <p className={`${CLASS}-decoding`} style={{ opacity: 0.2 + 0.8 * view.progress }}>{text}</p>
      </div>
    </div>
  )
}

function markdownLabels(t: Translate): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap') } },
    footnotes: t('markdown.footnotes'),
  }
}

/** Resolve an authored absolute image path against the document's file API, as ui-chat does. */
function localPathMediaUrl(base: string, value: string): string | undefined {
  let path: string
  try { path = decodeURIComponent(value.split(/[?#]/u)[0] ?? '') } catch (_malformedEscape) {
    return undefined // Malformed URL escapes cannot identify a file.
  }
  const absolute = path.startsWith('/') || /^[A-Za-z]:[/\\]/u.test(path) || path.startsWith('\\\\')
  if ((!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) || !absolute
    || /^[/\\]{2}/u.test(path) || /[\u0000-\u001f\u007f]/u.test(path)) return undefined
  return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href
}

interface AssistantBodyProps {
  blocks: readonly AssistantBlock[]
  groupPart: string | undefined
  streaming: boolean
  interrupted: boolean
  loadImage: MercuryAssistantProps['loadImage']
  reasoningHidden: boolean
  revealProcess: () => void
  useDisclosure: UseDisclosure
  useGroupAction: UseGroupAction
  renderFactorySlot: RenderFactorySlot
  mentions: MarkdownFileMentions | undefined
  t: Translate
}

const AssistantBody = memo(function AssistantBody({
  blocks, groupPart, streaming, interrupted, loadImage, reasoningHidden, revealProcess,
  useDisclosure, useGroupAction, renderFactorySlot, mentions, t,
}: AssistantBodyProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  const pathImages = useMemo<MarkdownPathImages>(() => ({ resolve: value => localPathMediaUrl(document.baseURI, value) }), [])
  const hasVisible = streaming || interrupted || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const last = blocks.length - 1
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    if (groupPart === 'reasoning' && block.kind !== 'reasoning') continue
    if (groupPart === 'response' && block.kind === 'reasoning') continue
    switch (block.kind) {
      case 'text':
        rendered.push(<MarkdownText key={i} text={block.text} streaming={streaming} labels={labels} fileMentions={mentions} pathImages={pathImages} />)
        break
      case 'reasoning':
        if (block.text.trim() === '') break
        rendered.push(
          <ProcessReasoning key={i} hidden={reasoningHidden} reveal={revealProcess} useGroupAction={useGroupAction}>
            <ReasoningRow text={block.text} running={streaming && i === last} useDisclosure={useDisclosure} renderFactorySlot={renderFactorySlot} t={t} />
          </ProcessReasoning>,
        )
        break
      case 'image': {
        // Consecutive images share one gallery, keyed by the first index so streaming appends do not remount it.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderFactorySlot('conversation.images.content', { images: group.map(({ attachment }) => ({ attachment })), loadImage, align: 'start' })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by the Chat view.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock key={i} label={t('message.unknownBlock')} payload={block.block} truncatedLabel={total => t('json.truncated', { total })} />,
        )
    }
  }
  return (
    <div className={`${CLASS}-assistant`} data-streaming={streaming || undefined}>
      <div className={`${CLASS}-assistant__body`}>
        {rendered}
        {interrupted && (groupPart === undefined || groupPart === 'response'
          || !blocks.some(block => block.kind !== 'reasoning' && block.kind !== 'tool-call'))
          && <span className={`${CLASS}-assistant__stopped`}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})

function ProcessReasoning({ hidden, reveal, useGroupAction, children }: {
  hidden: boolean
  reveal: () => void
  useGroupAction: UseGroupAction
  children: ReactNode
}) {
  const ref = useGroupAction(hidden, reveal)
  return <div ref={ref} data-turn-process-inline={hidden || undefined}>{children}</div>
}

const THINK_ICON = <IconThinkOutlineRegular size={14} />

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestCompletedParagraphFirstLine(text: string): string {
  let summary = ''
  let paragraphStart = 0
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  while (true) {
    const nextParagraph = separator.exec(text)
    const paragraphEnd = nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf('\n')
    const newline = text.indexOf('\n', paragraphStart)
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim()
      if (candidate !== '') summary = candidate
    }
    if (nextParagraph === null) return summary
    paragraphStart = nextParagraph.index + nextParagraph[0].length
  }
}

/**
 * Reasoning disclosure ported from ui-chat. The native row also reads Chat's
 * settled-preview policy, which only ui-chat's own registration receives; here
 * the collapsed preview shows while the block streams.
 */
const ReasoningRow = memo(function ReasoningRow({ text, running, useDisclosure, renderFactorySlot, t }: {
  text: string
  running: boolean
  useDisclosure: UseDisclosure
  renderFactorySlot: RenderFactorySlot
  t: Translate
}) {
  const { expanded, toggle } = useDisclosure()
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text)
  const summary = useMemo(() => summaryText.replaceAll('**', ''), [summaryText])
  const preview = !expanded && summary !== '' && running
  const collapsedContent = useMemo(() => (
    <>
      <span className={`${CLASS}-reasoning__separator`} data-shimmer-decoration aria-hidden />
      <span className={`${CLASS}-reasoning__summary`} data-streaming={running || undefined}>
        <span className={`${CLASS}-reasoning__summary-text`}><TextShimmer>{summary}</TextShimmer></span>
      </span>
    </>
  ), [running, summary])
  const content = useMemo(() => expanded
    ? <div className={`${CLASS}-reasoning__body`}>{renderFactorySlot('conversation.chat.reasoning.content', { text, running })}</div>
    : undefined, [expanded, renderFactorySlot, running, text])
  return (
    <div
      className={`${CLASS}-reasoning`}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      {running && <span className={`${CLASS}-visually-hidden`}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={`${CLASS}-reasoning__row`}
        leadingClassName={`${CLASS}-reasoning__leading`}
        titleClassName={`${CLASS}-reasoning__title`}
        icon={THINK_ICON}
        title={t('message.think')}
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={toggle}
        collapsedContent={collapsedContent}
      >
        {content}
      </DisclosureRow>
    </div>
  )
})
