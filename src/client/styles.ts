/**
 * Plugin-owned stylesheet, installed for the client plugin lifetime. The
 * assistant and reasoning rules port dsh ui-chat's AssistantMarkdown and
 * ReasoningRow modules (MIT), so the replacement renderer keeps the native look.
 */

/** Class prefix of every element this plugin renders. */
export const CLASS = 'dsh-mercury'

const CSS = `
.${CLASS}-assistant {
  display: flex;
  flex-direction: column;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
}
.${CLASS}-assistant__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.${CLASS}-assistant__body .md-table-wide {
  --dsh-table-spare: max(0px, calc((100cqw - var(--dsh-chat-content-width)) / 2));
  --dsh-table-lead: calc(var(--dsh-table-spare) + min(var(--dsh-chat-content-width), 100cqw) - 100%);
  box-sizing: border-box;
  width: calc(100% + var(--dsh-table-lead) + var(--dsh-table-spare));
  max-width: none;
  margin-left: calc(-1 * var(--dsh-table-lead));
  padding-left: var(--dsh-table-lead);
}
.${CLASS}-assistant__body .md-table-wide > table {
  position: relative;
  z-index: 1;
}
.${CLASS}-assistant__body > [data-turn-process-inline][hidden] {
  margin-bottom: -16px;
}
.${CLASS}-assistant__stopped {
  align-self: flex-start;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}

/* Diffusion frames in place of the answer, as chat.inceptionlabs.ai's DecodingText draws them. */
.${CLASS}-decoding {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
  transition: opacity 100ms linear;
}

.${CLASS}-reasoning {
  display: flex;
  flex-direction: column;
}
.${CLASS}-reasoning:not([data-expanded]) {
  contain: size layout;
  height: calc(24px + var(--dsh-content-font-delta, 0px));
}
.${CLASS}-reasoning__row {
  overflow: hidden;
}
.${CLASS}-reasoning[data-expanded] [data-open] [data-disclosure-header] {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--dsw-alias-bg-base);
}
.${CLASS}-reasoning__leading {
  flex-shrink: 0;
}
.${CLASS}-reasoning__title {
  font-weight: 400;
}
.${CLASS}-reasoning__separator {
  flex: none;
  width: 2px;
  height: 2px;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
}
.${CLASS}-reasoning__summary {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  white-space: nowrap;
}
.${CLASS}-reasoning__summary-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${CLASS}-reasoning__summary[data-streaming] {
  mask-image: linear-gradient(to right, black calc(100% - 48px), transparent);
}
.${CLASS}-reasoning__summary[data-streaming] .${CLASS}-reasoning__summary-text {
  overflow: visible;
  text-overflow: clip;
}
.${CLASS}-reasoning:not([data-preview]) .${CLASS}-reasoning__separator,
.${CLASS}-reasoning:not([data-preview]) .${CLASS}-reasoning__summary {
  display: none;
}
.${CLASS}-reasoning__body {
  padding: 4px 0 4px calc(22px + var(--dsh-content-font-delta, 0px));
  min-width: 0;
}
.${CLASS}-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.${CLASS}-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
}
.${CLASS}-settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.${CLASS}-settings__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, CanvasText);
}
.${CLASS}-settings__hint,
.${CLASS}-settings__notice {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, GrayText);
}
.${CLASS}-settings__error {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-error, #e5484d);
}
.${CLASS}-settings__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
`

/**
 * Add the stylesheet to the document.
 * @param pluginId - package name stamped on the style tag, matching dsh's plugin style ownership tags.
 * @returns disposer that removes the tag.
 */
export function installStyles(pluginId: string): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = pluginId
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
