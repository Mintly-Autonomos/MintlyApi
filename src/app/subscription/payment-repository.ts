import { ObjectId } from 'mongodb'
import type { ClientSession, Collection } from 'mongodb'
import type { PaymentProviderName, SubscriptionPlanMonths, SubscriptionTier } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import type { PaymentStatus } from './payment-provider'

export const PAYMENTS_COLLECTION = 'payments'

export interface PaymentRecord {
  _id: ObjectId
  restaurantId: string
  userId?: string
  provider: PaymentProviderName
  /** Tipo comprado (Básico ou Pro). Pagamentos antigos, sem o campo, eram Básico. */
  tier?: SubscriptionTier
  months: SubscriptionPlanMonths
  amountCents: number
  /** `recurring`: faz parte de uma renovação automática. Sem o campo (ou `one_time`): pagamento único. */
  kind?: 'one_time' | 'recurring'
  /** Id da assinatura (renovação automática) no provedor. */
  preapprovalId?: string
  status: PaymentStatus
  /** Id do pagamento no provedor (só depois que o provedor avisa). */
  providerPaymentId?: string
  /** Só no provedor simulado: o que a pessoa decidiu na tela de simulação. */
  mockDecision?: 'approved' | 'rejected'
  createdAt: Date
  updatedAt: Date
  /** Marca de que ESTE pagamento já foi somado à assinatura: garante que aviso repetido não soma de novo. */
  appliedAt?: Date
  /** Quanto tempo (ms) ESTE pagamento acrescentou à assinatura: é exatamente isso que um estorno desconta. */
  grantedMs?: number
  /**
   * O tempo deste pagamento deixou de existir na assinatura (a compra seguinte recomeçou a contagem:
   * troca de tipo ou assinatura já vencida). Estornar um pagamento assim não tira nada de `endsAt`.
   */
  supersededAt?: Date
  /** Marca de que o estorno/chargeback deste pagamento JÁ foi descontado da assinatura (uma vez só). */
  revokedAt?: Date
}

export class PaymentRepository {
  private col (env: string): Collection<PaymentRecord> {
    return MongoDBConnection.getInstance().getDatabase(env).collection<PaymentRecord>(PAYMENTS_COLLECTION)
  }

  async create (env: string, doc: Omit<PaymentRecord, '_id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<PaymentRecord> {
    const now = new Date()
    const record: PaymentRecord = { ...doc, _id: new ObjectId(), status: 'pending', createdAt: now, updatedAt: now }
    await this.col(env).insertOne(record)
    return record
  }

  async findByProviderPaymentId (env: string, providerPaymentId: string): Promise<PaymentRecord | null> {
    return this.col(env).findOne({ providerPaymentId })
  }

  async setPreapproval (env: string, id: ObjectId, preapprovalId: string): Promise<void> {
    await this.col(env).updateOne({ _id: id }, { $set: { preapprovalId, updatedAt: new Date() } })
  }

  /**
   * Registro de UMA cobrança de uma renovação automática, copiando o plano da assinatura (`intent`). O id
   * do pagamento do provedor é único: se a cobrança já foi registrada (aviso repetido ou simultâneo),
   * devolve `null` e nada é somado de novo.
   */
  async createCharge (env: string, intent: PaymentRecord, providerPaymentId: string): Promise<PaymentRecord | null> {
    const now = new Date()
    const record: PaymentRecord = {
      _id: new ObjectId(),
      restaurantId: intent.restaurantId,
      userId: intent.userId,
      provider: intent.provider,
      tier: intent.tier,
      months: intent.months,
      amountCents: intent.amountCents,
      kind: 'recurring',
      preapprovalId: intent.preapprovalId,
      status: 'pending',
      providerPaymentId,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await this.col(env).insertOne(record)
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return null
      throw error
    }
    return record
  }

  async findById (env: string, id: string): Promise<PaymentRecord | null> {
    if (!ObjectId.isValid(id)) return null
    return this.col(env).findOne({ _id: new ObjectId(id) })
  }

  async setStatus (env: string, id: ObjectId, status: PaymentStatus, extra: Partial<PaymentRecord> = {}): Promise<void> {
    await this.col(env).updateOne({ _id: id }, { $set: { status, updatedAt: new Date(), ...extra } })
  }

  async setMockDecision (env: string, id: ObjectId, decision: 'approved' | 'rejected'): Promise<void> {
    await this.col(env).updateOne({ _id: id }, { $set: { mockDecision: decision, updatedAt: new Date() } })
  }

  /**
   * Reserva a aplicação do pagamento: só UMA chamada leva o documento de "não aplicado" para
   * "aplicado". Devolve `true` para quem reservou e `false` para as repetições (aviso duplicado).
   */
  async claimApplication (env: string, id: ObjectId, providerPaymentId: string, session: ClientSession): Promise<boolean> {
    const now = new Date()
    const res = await this.col(env).findOneAndUpdate(
      { _id: id, appliedAt: { $exists: false } },
      { $set: { appliedAt: now, status: 'approved', providerPaymentId, updatedAt: now } },
      { session },
    )
    return res !== null
  }

  /** Uma compra que recomeça a contagem encerra o tempo de todos os pagamentos aplicados antes dela. */
  async supersedePrevious (env: string, restaurantId: string, exceptId: ObjectId, session: ClientSession): Promise<void> {
    await this.col(env).updateMany(
      { restaurantId, _id: { $ne: exceptId }, appliedAt: { $exists: true }, supersededAt: { $exists: false } },
      { $set: { supersededAt: new Date() } },
      { session },
    )
  }

  async setGrantedMs (env: string, id: ObjectId, grantedMs: number, session: ClientSession): Promise<void> {
    await this.col(env).updateOne({ _id: id }, { $set: { grantedMs } }, { session })
  }

  /**
   * Reserva o desconto do estorno: só UMA chamada leva um pagamento já aplicado (e do mesmo id no
   * provedor) de "não revogado" para "revogado". Avisos repetidos de estorno não descontam de novo.
   */
  async claimRevocation (env: string, id: ObjectId, providerPaymentId: string, session: ClientSession): Promise<boolean> {
    const now = new Date()
    const res = await this.col(env).findOneAndUpdate(
      { _id: id, appliedAt: { $exists: true }, revokedAt: { $exists: false }, providerPaymentId },
      { $set: { revokedAt: now, status: 'refunded', updatedAt: now } },
      { session },
    )
    return res !== null
  }
}
