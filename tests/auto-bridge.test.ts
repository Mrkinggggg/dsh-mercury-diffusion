import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { discoverBridgeRoutes } from '../src/auto-bridge.ts'

/** One directory entry plus the settings section that stores its profile. */
function fakeContext(entry: LlmConfigurableProvider, value: unknown): Context {
  return {
    llm: { listConfigurableProviders: () => [entry] },
    get: (service: string) => service === 'settings'
      ? { describe: () => [{ ns: entry.settingsNs, value }] }
      : undefined,
  } as unknown as Context
}

/** A settings section holding one provider profile. */
function section(provider: string, profile: Record<string, unknown>): unknown {
  return { providers: { [provider]: profile } }
}

const AZURE: LlmConfigurableProvider = {
  provider: 'azure',
  displayName: 'Azure OpenAI',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'azure'],
  baseURLEnv: ['AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_RESOURCE_NAME'],
  nativeAuth: { env: ['AZURE_OPENAI_API_KEY'], oauth: false },
}

describe('discoverBridgeRoutes', () => {
  it('skips a route whose endpoint is built from the environment', async () => {
    const ctx = fakeContext(AZURE, section('azure', { models: [{ id: 'gpt-4o' }] }))
    // The route never names a host; inventing one would send this route's
    // credential somewhere it was never configured to go.
    assert.deepEqual(await discoverBridgeRoutes(ctx), [])
  })

  it('keeps the implicit gateway endpoint when no environment builds it', async () => {
    const entry: LlmConfigurableProvider = {
      provider: 'gw',
      displayName: 'Local gateway',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'gw'],
      nativeAuth: { env: ['GW_KEY'], oauth: false },
    }
    const ctx = fakeContext(entry, section('gw', { apiKeyEnv: 'GW_KEY', models: [{ id: 'mercury-3' }] }))
    assert.deepEqual(await discoverBridgeRoutes(ctx), [{
      provider: 'gw',
      baseURL: 'http://127.0.0.1:3425/v1',
      apiKeyEnv: 'GW_KEY',
    }])
  })

  it('keeps a route with a named endpoint', async () => {
    const entry: LlmConfigurableProvider = {
      provider: 'inception',
      displayName: 'Inception',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'inception'],
      nativeAuth: { env: ['INCEPTION_API_KEY'], oauth: false },
    }
    const ctx = fakeContext(entry, section('inception', {
      baseURL: 'https://api.inceptionlabs.ai/v1',
      apiKeyEnv: 'INCEPTION_API_KEY',
      models: [{ id: 'mercury-3' }],
    }))
    assert.deepEqual(await discoverBridgeRoutes(ctx), [{
      provider: 'inception',
      baseURL: 'https://api.inceptionlabs.ai/v1',
      apiKeyEnv: 'INCEPTION_API_KEY',
    }])
  })
})
