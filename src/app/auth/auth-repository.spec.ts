import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthRepository } from './auth-repository'
import type { RequestContext } from '../../core/context/request-context'

const CTX: RequestContext = { env: 'unit' }

/** Collection fake: só o findOneAndUpdate é relevante para o branch sob teste. */
function mockCollection (findOneAndUpdateResult: unknown) {
  return {
    findOneAndUpdate: vi.fn(async () => findOneAndUpdateResult),
  }
}

describe('AuthRepository.registerFailedAttempt', () => {
  const ID = '507f1f77bcf86cd799439011'
  const BLOCK_AT = new Date('2026-01-01T00:00:00.000Z')
  let repo: AuthRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new AuthRepository()
  })

  it('usa um update com pipeline de agregação (incremento + bloqueio na mesma op)', async () => {
    const col = mockCollection({ loginAttempts: 2, blockedUntil: null })
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)

    await repo.registerFailedAttempt(ID, 5, BLOCK_AT, CTX)

    const [, pipeline, opts] = (col.findOneAndUpdate as any).mock.calls[0]
    expect(Array.isArray(pipeline)).toBe(true)
    expect(opts).toMatchObject({ returnDocument: 'after' })
  })

  it('abaixo do teto: reporta a contagem incrementada e blocked=false', async () => {
    const col = mockCollection({ loginAttempts: 3, blockedUntil: null })
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)

    const res = await repo.registerFailedAttempt(ID, 5, BLOCK_AT, CTX)

    expect(res).toEqual({ attempts: 3, blocked: false })
  })

  it('ao cruzar o teto: doc volta com o blockedUntil gravado e contador zerado → blocked=true, attempts=max', async () => {
    // O pipeline zera loginAttempts ao bloquear; a detecção de "bloqueou agora" é
    // pelo blockedUntil == o instante (Date) que passamos.
    const col = mockCollection({ loginAttempts: 0, blockedUntil: BLOCK_AT })
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)

    const res = await repo.registerFailedAttempt(ID, 5, BLOCK_AT, CTX)

    expect(res).toEqual({ attempts: 5, blocked: true })
  })

  it('findOneAndUpdate null: attempts=1, blocked=false (fallback defensivo)', async () => {
    const col = mockCollection(null)
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)

    const res = await repo.registerFailedAttempt(ID, 5, BLOCK_AT, CTX)

    expect(res).toEqual({ attempts: 1, blocked: false })
  })
})
