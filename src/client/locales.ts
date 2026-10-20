/** Locale-owned copy of the Configure page. */

/** Locale namespace registered by the client plugin. */
export const NS = 'mercury-diffusion'

/** Simplified Chinese copy. */
export const zh = {
  'config.summary': 'Inception Mercury 模型与扩散渲染',
  'config.apiKey': 'API Key',
  'config.apiKeyPlaceholder': '输入新的 Key（已保存的 Key 不会回显）',
  'config.apiKeyHint': '在 platform.inceptionlabs.ai 获取。留空保存会保留当前的 Key；未设置时使用环境变量 INCEPTION_API_KEY。',
  'config.clearKey': '清除已保存的 Key（改用环境变量）',
  'config.baseURL': 'API 地址',
  'config.resetBaseURL': '恢复默认地址',
  'config.invalidURL': '请输入 http:// 或 https:// 开头的地址',
  'config.diffusing': '扩散渲染',
  'config.diffusingHint': '开启后，对话页打开时会请求 diffusing 模式，回答在气泡里从乱码逐步收敛成正文。',
  'config.save': '保存',
  'config.saving': '保存中…',
  'config.saved': '已保存，立即生效',
  'config.failed': '保存失败：设置被拒绝或已被其他修改覆盖，请刷新后重试',
  'config.loading': '正在读取配置…',
  'config.unavailable': '当前无法读取这个插件的配置。',
  'config.readonly': '这些设置被更高优先级的配置层（如 --patch 或 ~/.dsh/cordis.patch.yml）覆盖，无法在此修改。',
}

/** Keys owned by the `mercury-diffusion` namespace. */
export type MercuryKey = keyof typeof zh

/** English copy. */
export const en: Record<MercuryKey, string> = {
  'config.summary': 'Inception Mercury models with live diffusion rendering',
  'config.apiKey': 'API key',
  'config.apiKeyPlaceholder': 'Enter a new key (a saved key is never shown)',
  'config.apiKeyHint': 'Get one at platform.inceptionlabs.ai. Saving with this field empty keeps the current key; with no saved key, INCEPTION_API_KEY is used.',
  'config.clearKey': 'Clear the saved key (use the environment variable)',
  'config.baseURL': 'API endpoint',
  'config.resetBaseURL': 'Restore the default endpoint',
  'config.invalidURL': 'Enter an address starting with http:// or https://',
  'config.diffusing': 'Diffusion rendering',
  'config.diffusingHint': 'When on, an open conversation requests diffusing mode and the answer resolves from noise inside its bubble.',
  'config.save': 'Save',
  'config.saving': 'Saving…',
  'config.saved': 'Saved; takes effect immediately',
  'config.failed': 'Save failed: the settings were refused or changed elsewhere. Reload and try again.',
  'config.loading': 'Reading configuration…',
  'config.unavailable': 'This plugin\'s configuration cannot be read right now.',
  'config.readonly': 'A higher configuration layer (such as --patch or ~/.dsh/cordis.patch.yml) overrides these settings, so they cannot be changed here.',
}
