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

/* Expanded question: a compact card with a header, one line, and one toggle. */
.${CLASS}-hint {
  position: fixed;
  top: 20%;
  right: 16px;
  z-index: 60;
  box-sizing: border-box;
  width: 208px;
  max-width: calc(100vw - 32px);
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.08));
  border-radius: 10px;
  background: var(--dsw-alias-bg-base, Canvas);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06);
  font-family: inherit;
}
.${CLASS}-hint__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.${CLASS}-hint__badge {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex: none;
  display: block;
}
.${CLASS}-hint__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--dsw-alias-label-primary, CanvasText);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CLASS}-hint__close {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, GrayText);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.${CLASS}-hint,
.${CLASS}-hint__launcher {
  -webkit-app-region: no-drag;
}
.${CLASS}-hint__close:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-primary, CanvasText);
}
.${CLASS}-hint__body {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, GrayText);
}
/* The single control: filled while offering diffusion, outlined while it is on. */
.${CLASS}-hint__toggle {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: var(--dsw-alias-button-primary-fill, #2f6bff);
  color: var(--dsw-alias-label-primary-foreground, #fff);
  font-family: inherit;
  font-size: 12px;
  line-height: 26px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.${CLASS}-hint__toggle:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #255ae0);
}
.${CLASS}-hint__toggle[data-on] {
  background: transparent;
  border-color: var(--dsw-alias-border-l3, rgba(128,128,128,0.3));
  color: var(--dsw-alias-label-primary, CanvasText);
}
.${CLASS}-hint__toggle[data-on]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12));
}
.${CLASS}-hint__toggle:disabled {
  opacity: 0.55;
  cursor: default;
}
/* Collapsed offer: a small round launcher on the conversation's right edge. */
.${CLASS}-hint__launcher {
  position: fixed;
  top: 20%;
  right: 16px;
  z-index: 60;
  width: 32px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.22));
  background: var(--dsw-alias-bg-base, Canvas);
  color: var(--dsw-alias-state-business-primary, #4c8dff);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: transform 120ms ease;
}
.${CLASS}-hint__launcher:hover {
  transform: scale(1.08);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.15));
}
/* Diffusion already on: an accent ring, never fading — dimming reads as "off". */
.${CLASS}-hint__launcher[data-enabled] {
  border-color: var(--dsw-alias-state-business-primary, #4c8dff);
  box-shadow: 0 0 0 2px rgba(76, 141, 255, 0.28), 0 4px 14px rgba(0, 0, 0, 0.12);
}
.${CLASS}-hint__icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: block;
  pointer-events: none;
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
