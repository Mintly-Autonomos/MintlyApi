import { describe, it, expect, vi, beforeEach } from 'vitest'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { InvalidEnvError } from '../../core/errors/core/invalid-env-error'
import { assertValidEnv, resetEnvAllowlistCache } from './env-allowlist'

function mockConnection (opts: { connected: boolean; names?: string[]; throwOnRead?: boolean }) {
  const toArray = opts.throwOnRead
    ? vi.fn().mockRejectedValue(new Error('app db down'))
    : vi.fn().mockResolvedValue((opts.names ?? []).map(name => ({ name })))
  const collection = vi.fn().mockReturnValue({ find: vi.fn().mockReturnValue({ toArray }) })
  const getDatabase = vi.fn().mockReturnValue({ collection })
  vi.spyOn(MongoDBConnection, 'getInstance').mockReturnValue({
    isConnected: () => opts.connected,
    getDatabase,
  } as any)
  return { getDatabase, collection, toArray }
}

describe('assertValidEnv', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetEnvAllowlistCache()
  })

  it('permissivo quando o Mongo não está conectado (dev/unit)', async () => {
    const { getDatabase } = mockConnection({ connected: false })
    await expect(assertValidEnv('qualquer-coisa')).resolves.toBeUndefined()
    expect(getDatabase).not.toHaveBeenCalled()
  })

  it('permissivo quando a allowlist está vazia (não seedada)', async () => {
    mockConnection({ connected: true, names: [] })
    await expect(assertValidEnv('int-test-123')).resolves.toBeUndefined()
  })

  it('permissivo quando a leitura do app DB falha (fail-open)', async () => {
    mockConnection({ connected: true, throwOnRead: true })
    await expect(assertValidEnv('production')).resolves.toBeUndefined()
  })

  it('aceita env presente na allowlist', async () => {
    mockConnection({ connected: true, names: ['staging', 'production'] })
    await expect(assertValidEnv('production')).resolves.toBeUndefined()
  })

  it('lança InvalidEnvError p/ env fora da allowlist', async () => {
    mockConnection({ connected: true, names: ['staging', 'production'] })
    await expect(assertValidEnv('hacker-env')).rejects.toBeInstanceOf(InvalidEnvError)
  })

  it('cacheia a allowlist (não relê o app DB dentro do TTL)', async () => {
    const { toArray } = mockConnection({ connected: true, names: ['staging'] })
    await assertValidEnv('staging', 1_000)
    await assertValidEnv('staging', 1_500) // dentro do TTL
    expect(toArray).toHaveBeenCalledTimes(1)
  })

  it('recarrega a allowlist após o TTL expirar', async () => {
    const { toArray } = mockConnection({ connected: true, names: ['staging'] })
    await assertValidEnv('staging', 1_000)
    await assertValidEnv('staging', 1_000 + 60_001) // além do TTL
    expect(toArray).toHaveBeenCalledTimes(2)
  })
})
