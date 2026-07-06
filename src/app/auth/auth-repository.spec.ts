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

describe('AuthRepository.incrementLoginAttempts', () => {
  let repo: AuthRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new AuthRepository()
  })

  it('retorna o loginAttempts do documento atualizado', async () => {
    const col = mockCollection({ loginAttempts: 3 })
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)
    const attempts = await repo.incrementLoginAttempts('507f1f77bcf86cd799439011', CTX)
    expect(attempts).toBe(3)
  })

  it('retorna 1 quando o findOneAndUpdate devolve null', async () => {
    const col = mockCollection(null)
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)
    const attempts = await repo.incrementLoginAttempts('507f1f77bcf86cd799439011', CTX)
    expect(attempts).toBe(1)
  })

  it('retorna 1 quando o documento não tem loginAttempts', async () => {
    const col = mockCollection({ _id: 'x' })
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col as any)
    const attempts = await repo.incrementLoginAttempts('507f1f77bcf86cd799439011', CTX)
    expect(attempts).toBe(1)
  })
})
