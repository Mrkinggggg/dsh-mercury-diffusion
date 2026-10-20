/** Normalize Inception HTTP and in-band errors into provider-neutral failures. */

import { isContextWindowExceededError, isQuotaExceededError, LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm'

function fields(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const retry = headers?.get('retry-after')
  if (retry == null) return undefined
  const delay = /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

/**
 * Classify one provider error from documented fields only
 * (https://docs.inceptionlabs.ai/resources/error-codes).
 * @param raw - decoded error body or in-band error event; undefined for a non-JSON body.
 * @param status - HTTP status when the error preceded streaming.
 * @param headers - response headers for retry delay and request identity.
 * @returns a stable failure consumed by `LlmRuntime` and `dsh-llm-retry`.
 */
export function providerError(raw: unknown, status: number | undefined, headers?: Headers): LlmError {
  const error = fields(fields(raw).error)
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `Mercury request failed (${status ?? 'stream error'})`
  const type = typeof error.type === 'string' ? error.type : ''
  const providerCode = typeof error.code === 'string' ? error.code : ''
  const detail = `${type} ${providerCode} ${message}`
  let code: string
  if (status === 401 || status === 403 || type === 'authentication_error' || type === 'permission_error') code = 'AUTH'
  else if (status === 402 || isQuotaExceededError(detail)) code = 'QUOTA'
  else if (status === 429 || type === 'rate_limit_error') code = 'RATE_LIMIT'
  else if (providerCode === 'context_length_exceeded' || isContextWindowExceededError(detail)) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (status === 404) code = 'UNKNOWN_MODEL'
  else if (status === 400 || status === 413 || status === 422 || type === 'invalid_request_error') code = 'INVALID_REQUEST'
  else if (status === undefined || status >= 500) code = 'SERVER'
  else code = `HTTP_${status}`
  const requestId = headers?.get('x-request-id') ?? headers?.get('request-id')
  const delay = retryAfterMs(headers)
  return new LlmError(message, code, {
    ...status === undefined ? {} : { status },
    ...requestId ? { requestId: ProviderRequestId(requestId) } : {},
    ...delay === undefined ? {} : { providerRetryAfterMs: delay },
  })
}
