import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { Collection, ObjectId } from 'mongodb'
import { startInMemoryMongo, clearAllDatabases, stopInMemoryMongo } from '../../../../tests/helpers/in-memory-mongo'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { SettleDueMovementsUseCase } from './settle-due-movements.use-case'
import { toDecimal128 } from '../../../core/money/money'

const ENV = 'test'
const RESTAURANT = 'r1'

describe('SettleDueMovementsUseCase (P1)', () => {
  // Replica set: o settler roda em transação, e transação exige replica set.
  beforeAll(async () => { await startInMemoryMongo({ replSet: true }) })
  afterAll(async () => { await stopInMemoryMongo() })
  beforeEach(async () => { await clearAllDatabases() })
  afterEach(() => { vi.restoreAllMocks() })

  const db = () => MongoDBConnection.getInstance().getDatabase(ENV)

  async function seed (movement: Record<string, any>, account: Record<string, any> = {}) {
    const accountId = new ObjectId()
    await db().collection('financial_accounts').insertOne({
      _id: accountId,
      restaurantId: RESTAURANT,
      name: 'iFood',
      type: 'platform',
      status: 'active',
      isDefault: false,
      feePercent: 10,
      settlementDays: 5,
      availableBalance: toDecimal128(0),
      predictedBalance: toDecimal128(90),
      audit: { createdAt: new Date(), updatedAt: new Date() },
      ...account,
    })

    const movId = new ObjectId()
    await db().collection('financial_movements').insertOne({
      _id: movId,
      restaurantId: RESTAURANT,
      direction: 'in',
      title: 'Venda iFood',
      status: 'pending',
      date: new Date('2026-01-01T00:00:00.000Z'),
      grossValue: toDecimal128(100),
      feeValue: toDecimal128(10),
      netValue: toDecimal128(90),
      feePercentApplied: 10,
      settlementDaysApplied: 5,
      predictedReceiptDate: new Date('2026-01-06T00:00:00.000Z'),
      account: { _id: String(accountId), name: 'iFood', type: 'platform' },
      category: { _id: String(new ObjectId()), name: 'Vendas', type: 'revenue' },
      paymentMethod: 'pix',
      origin: 'manual',
      history: [],
      audit: { createdAt: new Date(), updatedAt: new Date() },
      ...movement,
    })

    return { accountId, movId }
  }

  const balances = async (accountId: ObjectId) => {
    const acc = await db().collection('financial_accounts').findOne({ _id: accountId })
    return {
      available: Number(acc!.availableBalance.toString()),
      predicted: Number(acc!.predictedBalance.toString()),
    }
  }

  /**
   * Simula a CORRIDA: executa `interference` exatamente entre a varredura
   * (o `find` fora da transação, que descobre os candidatos) e a transação de
   * cada movimento. É o instante em que o dono pode mexer no lançamento.
   */
  function interfereAfterScan (interference: () => Promise<void>): void {
    const originalFind = Collection.prototype.find
    const spy = vi.spyOn(Collection.prototype, 'find').mockImplementation(function (this: any, ...args: any[]) {
      const cursor = originalFind.apply(this, args as any)
      const originalToArray = cursor.toArray.bind(cursor)
      cursor.toArray = async () => {
        const docs = await originalToArray()
        spy.mockRestore() // só interfere na primeira varredura
        await interference()
        return docs
      }
      return cursor
    } as any)
  }

  const NOW = new Date('2026-07-13T00:00:00.000Z')

  it('liquida o pendente vencido e move o dinheiro de predicted para available', async () => {
    const { accountId, movId } = await seed({ statusSource: 'auto' })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 1, failed: 0 })

    const mov = await db().collection('financial_movements').findOne({ _id: movId })
    expect(mov!.status).toBe('settled')

    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('trata statusSource AUSENTE como auto (destrava o backlog antigo)', async () => {
    const { accountId } = await seed({}) // sem statusSource

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result.settled).toBe(1)
    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('IGNORA movimento marcado como manual (o dono disse que não recebeu)', async () => {
    const { accountId, movId } = await seed({ statusSource: 'manual' })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 0, failed: 0 })

    const mov = await db().collection('financial_movements').findOne({ _id: movId })
    expect(mov!.status).toBe('pending')
    expect(await balances(accountId)).toEqual({ available: 0, predicted: 90 })
  })

  it('NÃO liquida quem ainda não venceu', async () => {
    await seed({ statusSource: 'auto', predictedReceiptDate: new Date('2026-12-31T00:00:00.000Z') })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result.settled).toBe(0)
  })

  it('é IDEMPOTENTE: rodar duas vezes não duplica saldo', async () => {
    const { accountId } = await seed({ statusSource: 'auto' })

    await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })
    const second = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(second).toEqual({ settled: 0, failed: 0 })
    expect(await balances(accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('NÃO liquida o movimento cujo status mudou entre a varredura e a transação (pula em silêncio)', async () => {
    const { accountId, movId } = await seed({ statusSource: 'auto' })

    // O dono cancela o lançamento DEPOIS da varredura e ANTES da transação.
    interfereAfterScan(async () => {
      await db().collection('financial_movements').updateOne(
        { _id: movId },
        { $set: { status: 'cancelled', statusSource: 'manual' } },
      )
      await db().collection('financial_accounts').updateOne(
        { _id: accountId },
        { $set: { predictedBalance: toDecimal128(0) } },
      )
    })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    // Concorrência funcionando: não é falha, é um candidato que deixou de ser candidato.
    expect(result).toEqual({ settled: 0, failed: 0 })

    const mov = await db().collection('financial_movements').findOne({ _id: movId })
    expect(mov!.status).toBe('cancelled')
    expect(await balances(accountId)).toEqual({ available: 0, predicted: 0 })
  })

  it('usa os valores RELIDOS na sessão quando o valor muda entre a varredura e a transação (sem drift)', async () => {
    const { accountId, movId } = await seed({ statusSource: 'auto' })

    // O dono corrige o valor bruto 100 → 200 (net 180) depois da varredura: o
    // saldo previsto da conta vai a 180. Se o settler usasse o documento VELHO
    // (net 90), liquidaria 90 e deixaria 90 presos no previsto — drift silencioso.
    interfereAfterScan(async () => {
      await db().collection('financial_movements').updateOne(
        { _id: movId },
        { $set: { grossValue: toDecimal128(200), feeValue: toDecimal128(20), netValue: toDecimal128(180) } },
      )
      await db().collection('financial_accounts').updateOne(
        { _id: accountId },
        { $set: { predictedBalance: toDecimal128(180) } },
      )
    })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 1, failed: 0 })
    expect(await balances(accountId)).toEqual({ available: 180, predicted: 0 })
  })

  it('cross-tenant: uma rodada liquida movimentos de restaurantes diferentes', async () => {
    const a = await seed({ statusSource: 'auto' })
    const b = await seed({ statusSource: 'auto', restaurantId: 'r2' }, { restaurantId: 'r2' })

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 2, failed: 0 })
    expect(await balances(a.accountId)).toEqual({ available: 90, predicted: 0 })
    expect(await balances(b.accountId)).toEqual({ available: 90, predicted: 0 })
  })

  it('um movimento quebrado (conta apagada) conta como falha e NÃO derruba a rodada', async () => {
    const broken = await seed({ statusSource: 'auto' })
    await db().collection('financial_accounts').deleteOne({ _id: broken.accountId })
    const ok = await seed({ statusSource: 'auto' })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await new SettleDueMovementsUseCase().execute({ env: ENV, now: NOW })

    expect(result).toEqual({ settled: 1, failed: 1 })

    const brokenMov = await db().collection('financial_movements').findOne({ _id: broken.movId })
    expect(brokenMov!.status).toBe('pending') // transação abortada: nada gravado
    expect(await balances(ok.accountId)).toEqual({ available: 90, predicted: 0 })
  })
})
