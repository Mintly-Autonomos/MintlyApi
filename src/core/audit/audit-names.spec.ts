import { beforeEach, describe, expect, it, vi } from 'vitest'

import { attachAuditNames, attachAuditNamesTo } from './audit-names'

const toArray = vi.fn()
const find = vi.fn(() => ({ toArray }))

vi.mock('../../infrastructure/db/mongodb/mongodb-connection', () => ({
  default: {
    getInstance: () => ({ getDatabase: () => ({ collection: () => ({ find }) }) }),
  },
}))

const ctx = { env: 'staging', restaurantId: 'rest1', userId: 'u' } as any
const ANA = '6ae3d251869deda7ae146a3d'
const BIA = '6ae3d251869deda7ae146a3e'

describe('attachAuditNames', () => {
  beforeEach(() => {
    toArray.mockReset()
    find.mockClear()
  })

  it('acrescenta o nome de quem criou e de quem alterou, mantendo os ids', async () => {
    toArray.mockResolvedValue([
      { _id: ANA, person: { name: 'Ana Costa' } },
      { _id: BIA, person: { name: ' Bia ' } },
    ])
    const [item] = await attachAuditNames([{ title: 'x', audit: { createdBy: ANA, updatedBy: BIA, createdAt: 1 } }], ctx)
    expect(item.audit).toEqual({ createdBy: ANA, updatedBy: BIA, createdAt: 1, createdByName: 'Ana Costa', updatedByName: 'Bia' })
  })

  it('traduz também o histórico (history[].by -> byName)', async () => {
    toArray.mockResolvedValue([{ _id: ANA, person: { name: 'Ana' } }])
    const [item] = await attachAuditNames([{ audit: { createdBy: ANA }, history: [{ by: ANA, action: 'a' }, { by: 'system', action: 'b' }] }], ctx)
    expect(item.history).toEqual([{ by: ANA, action: 'a', byName: 'Ana' }, { by: 'system', action: 'b' }])
  })

  it('faz UMA consulta para todos os itens, só dos ids válidos e do mesmo restaurante', async () => {
    toArray.mockResolvedValue([])
    await attachAuditNames(
      [{ audit: { createdBy: ANA, updatedBy: ANA } }, { audit: { createdBy: BIA } }, { audit: { createdBy: 'system', updatedBy: 'lixo' } }],
      ctx,
    )
    expect(find).toHaveBeenCalledTimes(1)
    const [filter] = find.mock.calls[0] as unknown as [{ _id: { $in: unknown[] }, restaurantId: string }]
    expect(filter.restaurantId).toBe('rest1')
    expect(filter._id.$in).toHaveLength(2)
  })

  it('usuário que não existe mais fica só com o id', async () => {
    toArray.mockResolvedValue([])
    const items = [{ audit: { createdBy: ANA } }]
    expect(await attachAuditNames(items, ctx)).toBe(items)
  })

  it('usuário sem nome não ganha nome', async () => {
    toArray.mockResolvedValue([{ _id: ANA, person: { name: '  ' } }, { _id: BIA }])
    const items = [{ audit: { createdBy: ANA, updatedBy: BIA } }]
    expect((await attachAuditNames(items, ctx))[0].audit.createdByName).toBeUndefined()
  })

  it('sem ids (ou sem restaurante) não consulta o banco', async () => {
    await attachAuditNames([{ title: 'sem auditoria' }, { audit: {} }], ctx)
    await attachAuditNames([{ audit: { createdBy: ANA } }], { ...ctx, restaurantId: undefined })
    expect(find).not.toHaveBeenCalled()
  })

  it('falha na consulta nunca derruba a resposta: devolve os itens como estavam', async () => {
    toArray.mockRejectedValue(new Error('mongo fora'))
    const items = [{ audit: { createdBy: ANA } }]
    expect(await attachAuditNames(items, ctx)).toBe(items)
  })

  it('não altera os itens originais', async () => {
    toArray.mockResolvedValue([{ _id: ANA, person: { name: 'Ana' } }])
    const original = { audit: { createdBy: ANA } }
    await attachAuditNames([original], ctx)
    expect(original.audit).toEqual({ createdBy: ANA })
  })
})

describe('attachAuditNamesTo', () => {
  it('um item só', async () => {
    toArray.mockResolvedValue([{ _id: ANA, person: { name: 'Ana' } }])
    expect((await attachAuditNamesTo({ audit: { createdBy: ANA } }, ctx)).audit.createdByName).toBe('Ana')
  })

  it('valor que não é objeto passa direto', async () => {
    expect(await attachAuditNamesTo(null as any, ctx)).toBeNull()
  })
})
