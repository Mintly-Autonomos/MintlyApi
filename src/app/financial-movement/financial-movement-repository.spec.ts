import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FinancialMovementRepository,
  movementToStorage,
  movementFromStorage,
} from './financial-movement-repository'
import type { RequestContext } from '../../core/context/request-context'

const CTX: RequestContext = { env: 'unit', restaurantId: 'rest-1' }

/** Collection fake: captura o `query` passado ao find() e devolve uma cadeia encadeável. */
function mockCollection () {
  const captured: any = {}
  const chain = {
    find: vi.fn((query: any) => { captured.query = query; return chain }),
    sort: vi.fn(() => chain),
    skip: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    toArray: vi.fn(async () => []),
  }
  return { chain, captured }
}

describe('movementToStorage / movementFromStorage', () => {
  it('to/from ignoram campos de dinheiro ausentes (null/undefined)', () => {
    // grossValue presente, feeValue ausente -> só o presente é convertido
    const out = movementToStorage({ grossValue: 100, feeValue: null })
    expect(out.grossValue).toBeDefined()
    expect(out.feeValue).toBeNull()
  })

  it('movementFromStorage devolve null quando o doc é null', () => {
    expect(movementFromStorage(null)).toBeNull()
  })

  it('movementFromStorage converte campos presentes e preserva ausentes', () => {
    const result = movementFromStorage({ grossValue: { toString: () => '50' } as any, netValue: null })
    expect(result?.netValue).toBeNull()
    expect(typeof result?.grossValue).toBe('number')
  })
})

describe('FinancialMovementRepository.findAll — montagem do filtro', () => {
  let repo: FinancialMovementRepository
  let col: ReturnType<typeof mockCollection>

  beforeEach(() => {
    repo = new FinancialMovementRepository()
    col = mockCollection()
    vi.spyOn(repo as any, 'getCollection').mockReturnValue(col.chain as any)
  })

  it('sem filtros: escopa só por restaurantId', async () => {
    await repo.findAll({}, CTX)
    expect(col.captured.query).toEqual({ restaurantId: 'rest-1' })
  })

  it('aplica direction e status quando informados', async () => {
    await repo.findAll({ direction: 'in', status: 'settled' }, CTX)
    expect(col.captured.query.direction).toBe('in')
    expect(col.captured.query.status).toBe('settled')
  })

  it('aplica intervalo de datas (dateFrom e dateTo)', async () => {
    await repo.findAll({ dateFrom: '2026-01-01', dateTo: '2026-02-01' }, CTX)
    expect(col.captured.query.date.$gte).toBeInstanceOf(Date)
    expect(col.captured.query.date.$lte).toBeInstanceOf(Date)
  })

  it('aplica só dateFrom quando só ele vem', async () => {
    await repo.findAll({ dateFrom: '2026-01-01' }, CTX)
    expect(col.captured.query.date.$gte).toBeInstanceOf(Date)
    expect(col.captured.query.date.$lte).toBeUndefined()
  })

  it('aplica só dateTo quando só ele vem', async () => {
    await repo.findAll({ dateTo: '2026-02-01' }, CTX)
    expect(col.captured.query.date.$lte).toBeInstanceOf(Date)
    expect(col.captured.query.date.$gte).toBeUndefined()
  })

  it('page/size inválidos (NaN) caem nos defaults 1 e 10 (skip=0, limit=10)', async () => {
    await repo.findAll({ page: 'abc', size: 'xyz' }, CTX)
    // pageNum=1, sizeNum=10 -> skip = (1-1)*10 = 0
    expect(col.chain.skip).toHaveBeenCalledWith(0)
    expect(col.chain.limit).toHaveBeenCalledWith(10)
  })

  it('busca textual (q) monta $or em title/account/category/paymentMethod/origin, com escape de regex', async () => {
    await repo.findAll({ q: 'a.b' }, CTX)
    expect(Array.isArray(col.captured.query.$or)).toBe(true)
    expect(col.captured.query.$or).toHaveLength(5)
    // metacaractere escapado (não vira regex cru)
    expect(col.captured.query.$or[0].title.$regex).toBe('a\\.b')
  })
})
