/** Configure page of the Mercury row on the Plugins page: API key, endpoint, and diffusion switch. */

import { useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { CLASS as PREFIX } from './styles.ts'

/** `plugins.row.config` key: package name and the row id its patch declares. */
export const ROW_CONFIG_KEY = 'dsh-mercury-diffusion#mercury-diffusion'

type Translate = PropsLocale<typeof NS> extends { t: infer T } ? T : never

/** Composed page props. */
export type MercurySettingsProps = PropsRuntime<'plugins.row.config'> & PropsLocale<typeof NS>

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

const CLASS = `${PREFIX}-settings`

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_notUrl) {
    return false
  }
}

function hasField(layer: unknown, field: string): boolean {
  return typeof layer === 'object' && layer !== null && field in layer
}

/**
 * Render the row's one-line summary or its editable page.
 * @param props - composed slot props.
 * @returns the summary text, the form, or a notice when the Host exposes no form.
 */
export function MercurySettings({ view, form, t }: MercurySettingsProps) {
  if (view === 'summary') return t('config.summary')
  if (form === undefined) return <p className={`${CLASS}__notice`}>{t('config.unavailable')}</p>
  return <SettingsForm form={form} t={t} />
}

function SettingsForm({ form, t }: { form: ConfigPageForm; t: Translate }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState<string | undefined>(undefined)
  const [diffusing, setDiffusing] = useState<boolean | undefined>(undefined)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const { state } = form
  if (state.status === 'loading') return <p className={`${CLASS}__notice`}>{t('config.loading')}</p>
  if (state.status === 'unavailable' || state.value === undefined) return <p className={`${CLASS}__notice`}>{t('config.unavailable')}</p>

  const value = state.value
  const currentURL = typeof value.baseURL === 'string' ? value.baseURL : ''
  const currentDiffusing = value.diffusing !== false
  const shownURL = baseURL ?? currentURL
  const shownDiffusing = diffusing ?? currentDiffusing
  const urlInvalid = !isHttpUrl(shownURL.trim())
  const dirty = apiKey.trim().length > 0 || shownURL.trim() !== currentURL || shownDiffusing !== currentDiffusing
  const busy = status === 'saving'
  const disabled = busy || !state.writable

  const commit = async (ops: Parameters<ConfigPageForm['mutate']>[0]): Promise<void> => {
    setStatus('saving')
    let accepted = false
    try { accepted = await form.mutate(ops, state.revision) } catch (_transportFailed) {
      // A lost write leaves the Host values unknown; the page shows the failure and the owner reloads them.
    }
    setStatus(accepted ? 'saved' : 'failed')
    if (!accepted) return
    setApiKey('')
    setBaseURL(undefined)
    setDiffusing(undefined)
  }

  const save = (): void => {
    const ops: Parameters<ConfigPageForm['mutate']>[0] = [
      ...apiKey.trim().length > 0 ? [{ op: 'set' as const, path: ['apiKey'], value: apiKey.trim() }] : [],
      ...shownURL.trim() !== currentURL ? [{ op: 'set' as const, path: ['baseURL'], value: shownURL.trim() }] : [],
      ...shownDiffusing !== currentDiffusing ? [{ op: 'set' as const, path: ['diffusing'], value: shownDiffusing }] : [],
    ]
    void commit(ops)
  }

  return (
    <form className={CLASS} onSubmit={(event) => { event.preventDefault(); if (dirty && !urlInvalid) save() }}>
      {!state.writable ? <p className={`${CLASS}__notice`} role="status">{t('config.readonly')}</p> : null}

      <label className={`${CLASS}__field`}>
        <span className={`${CLASS}__label`}>{t('config.apiKey')}</span>
        <Input type="password" autoComplete="new-password" value={apiKey} disabled={disabled}
          placeholder={t('config.apiKeyPlaceholder')} onChange={(event) => { setApiKey(event.target.value); setStatus('idle') }} />
        <span className={`${CLASS}__hint`}>{t('config.apiKeyHint')}</span>
      </label>
      {/* The Host redacts secrets from every layer it sends, so whether a key is saved is unknowable here. */}
      <div><Button type="button" size="sm" variant="outline" disabled={disabled}
        onClick={() => { void commit([{ op: 'unset', path: ['apiKey'] }]) }}>{t('config.clearKey')}</Button></div>

      <label className={`${CLASS}__field`}>
        <span className={`${CLASS}__label`}>{t('config.baseURL')}</span>
        <Input value={shownURL} disabled={disabled} aria-invalid={urlInvalid}
          onChange={(event) => { setBaseURL(event.target.value); setStatus('idle') }} />
        {urlInvalid ? <span className={`${CLASS}__error`} role="status">{t('config.invalidURL')}</span> : null}
      </label>
      {hasField(state.user, 'baseURL')
        ? <div><Button type="button" size="sm" variant="outline" disabled={disabled}
          onClick={() => { void commit([{ op: 'unset', path: ['baseURL'] }]) }}>{t('config.resetBaseURL')}</Button></div>
        : null}

      <div className={`${CLASS}__field`}>
        <span className={`${CLASS}__label`}>{t('config.diffusing')}</span>
        <Switch checked={shownDiffusing} disabled={disabled} label={t('config.diffusing')}
          onChange={(next) => { setDiffusing(next); setStatus('idle') }} />
        <span className={`${CLASS}__hint`}>{t('config.diffusingHint')}</span>
      </div>

      <div className={`${CLASS}__actions`}>
        <Button type="submit" variant="primary" disabled={disabled || !dirty || urlInvalid}>
          {busy ? t('config.saving') : t('config.save')}
        </Button>
        {status === 'saved' ? <span className={`${CLASS}__hint`} role="status">{t('config.saved')}</span> : null}
        {status === 'failed' ? <span className={`${CLASS}__error`} role="status">{t('config.failed')}</span> : null}
      </div>
    </form>
  )
}
