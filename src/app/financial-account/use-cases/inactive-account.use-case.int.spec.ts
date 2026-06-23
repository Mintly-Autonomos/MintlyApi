import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mongoConnection } from '../../../infrastructure/db/mongodb'
import { FinancialAccountRepository } from '../financial-account-repository'
import { InactivateAccountUseCase } from './inactivate-account.use-case'
import { NotFoundError } from '../../../core/errors/core/not-found-error'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import type { RequestContext } from '../../../core/context/request-context'

/**
 * Integração — MIN-65: InactivateAccountUseCase
 *
 * Exercita o use case contra um MongoDB real (replica set, p/ transações),
 * com repositório real, índices reais (unique parcial de isDefault) e
 * find/update reais por _id.
 *
 * PRÉ-REQUISITO: o find base deve normalizar _id string -> ObjectId
 * (igual a findById/update/delete). Sem isso, a 1ª busca não casa o ObjectId.
 *
 * Transações exigem replica set — por isso MongoMemoryReplSet, e não o
 * helper startInMemoryMongo() (que sobe standalone).
 */

const ENV = 'inttest_inactivate'
const RESTAURANT_ID = 'rest-int-1'
const CTX: RequestContext = { env: ENV, userId: 'user-int', restaurantId: RESTAURANT_ID }

interface SeedOverrides {
  name?: string
  type?: string
  status?: string
  isDefault?: boolean
  availableBalance?: number
  predictedBalance?: number
}

describe('InactivateAccountUseCase (integração)', () => {
  let replset: MongoMemoryReplSet
  let repo: FinancialAccountRepository
  let sut: InactivateAccountUseCase

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replset.getUri()
    await mongoConnection.connect()

    repo = new FinancialAccountRepository()
    await repo.createIndexes(CTX) // unique {restaurantId,name,type} + unique parcial isDefault + {restaurantId,status}
    sut = new InactivateAccountUseCase(repo)
  })

  afterAll(async () => {
    await mongoConnection.disconnect()
    await replset.stop()
  })

  beforeEach(async () => {
    await mongoConnection.getDatabase(ENV).collection('financial_accounts').deleteMany({})
  })

  // Insere uma conta e devolve o id (string) gerado pelo Mongo (ObjectId -> string)
  const seed = async (over: SeedOverrides = {}): Promise<string> => {
    const inserted = await repo.insert(
      {
        name: over.name ?? 'Conta',
        type: over.type ?? 'cash',
        status: over.status ?? 'active',
        isDefault: over.isDefault ?? false,
        restaurantId: RESTAURANT_ID,
        availableBalance: over.availableBalance ?? 0,
        predictedBalance: over.predictedBalance ?? 0,
        history: [],
        audit: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      } as any,
      CTX,
    )
    return String((inserted as any)._id)
  }

  const read = async (id: string): Promise<any> => repo.findById(id, CTX)

  it('inativa uma conta não-padrão e registra auditoria', async () => {
    // Arrange — alvo + outra ativa (p/ não cair no guard de única ativa)
    const targetId = await seed({ name: 'Caixa' })
    await seed({ name: 'Banco', type: 'bank' })

    // Act
    await sut.execute(targetId, CTX)

    // Assert
    const target = await read(targetId)
    expect(target.status === 'inactive').toBe(true)
    expect(target.isDefault === false).toBe(true)
    expect(target.history.length === 1).toBe(true)
    expect(target.history[0].action === 'inactivate').toBe(true)
    expect(target.history[0].by === 'user-int').toBe(true)
  })

  it('inativa a conta padrão promovendo a substituta (swap) — respeitando o índice unique parcial', async () => {
    // Arrange
    const defaultId = await seed({ name: 'Caixa', isDefault: true })
    const replacementId = await seed({ name: 'Banco', type: 'bank', isDefault: false })

    // Act
    await sut.execute(defaultId, CTX, replacementId)

    // Assert — alvo inativo e sem default; substituta vira default
    const oldDefault = await read(defaultId)
    expect(oldDefault.status === 'inactive').toBe(true)
    expect(oldDefault.isDefault === false).toBe(true)

    const newDefault = await read(replacementId)
    expect(newDefault.isDefault === true).toBe(true)
    expect(newDefault.status === 'active').toBe(true)

    // Invariante: exatamente uma conta padrão no restaurante
    const defaults = await mongoConnection
      .getDatabase(ENV)
      .collection('financial_accounts')
      .countDocuments({ restaurantId: RESTAURANT_ID, isDefault: true })
    expect(defaults === 1).toBe(true)
  })

  it('bloqueia (ConflictError) e não altera a conta quando há saldo disponível ≠ 0', async () => {
    // Arrange
    const targetId = await seed({ name: 'Caixa', availableBalance: 100 })
    await seed({ name: 'Banco', type: 'bank' })

    // Act + Assert
    await expect(sut.execute(targetId, CTX)).rejects.toBeInstanceOf(ConflictError)

    const target = await read(targetId)
    expect(target.status === 'active').toBe(true) // permanece ativa
  })

  it('bloqueia (ConflictError) quando é a única conta ativa do restaurante', async () => {
    // Arrange — só uma conta ativa
    const targetId = await seed({ name: 'Caixa' })

    // Act + Assert
    await expect(sut.execute(targetId, CTX)).rejects.toBeInstanceOf(ConflictError)

    const target = await read(targetId)
    expect(target.status === 'active').toBe(true)
  })

  it('bloqueia (ConflictError) ao inativar a padrão sem informar substituta', async () => {
    // Arrange — alvo é padrão; existe outra ativa (não cai em única ativa); sem substituta
    const defaultId = await seed({ name: 'Caixa', isDefault: true })
    await seed({ name: 'Banco', type: 'bank' })

    // Act + Assert
    await expect(sut.execute(defaultId, CTX)).rejects.toBeInstanceOf(ConflictError)

    const target = await read(defaultId)
    expect(target.status === 'active').toBe(true)
    expect(target.isDefault === true).toBe(true) // continua sendo a padrão
  })

  it('lança NotFoundError quando a conta-alvo não existe', async () => {
    // Arrange — id válido (ObjectId) porém inexistente
    const missingId = new ObjectId().toString()

    // Act + Assert
    await expect(sut.execute(missingId, CTX)).rejects.toBeInstanceOf(NotFoundError)
  })
})
