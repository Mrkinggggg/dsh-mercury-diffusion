/** Locale-owned copy of the diffusion toggle. */

/** Locale namespace registered by the client plugin. */
export const NS = 'mercury-diffusion'

/** Simplified Chinese copy. */
export const zh = {
  'hint.title': '扩散渲染',
  'hint.body': '是否开启扩散渲染',
  'hint.enable': '开启',
  'hint.disable': '关闭',
  'hint.dismiss': '收起',
  'hint.on': '已开启',
  'hint.off': '未开启',
}

/** Keys owned by the `mercury-diffusion` namespace. */
export type MercuryKey = keyof typeof zh

/** English copy. */
export const en: Record<MercuryKey, string> = {
  'hint.title': 'Diffusion rendering',
  'hint.body': 'Enable diffusion rendering',
  'hint.enable': 'Enable',
  'hint.disable': 'Disable',
  'hint.dismiss': 'Collapse',
  'hint.on': 'on',
  'hint.off': 'off',
}
