import { ObjectId } from 'mongodb'
import type { ClientSession, Collection } from 'mongodb'
import type { PaymentProviderName } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import type { PaymentStatus } from './payment-provider'

export const PAYMENTS_COLLECTION = 'payments'

export interface PaymentRecord {
  _id: ObjectId
  restaurantId: string
  userId?: string
  provider: PaymentProviderName
  months: number
  amountCents: number
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
