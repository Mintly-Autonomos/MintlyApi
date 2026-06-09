import { randomBytes, scryptSync } from 'crypto'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import {
  signupRequestSchema,
  UserRole,
  UserStatus,
  RecordStatus,
  FinancialAccountType,
  CategoryType,
  CategoryBehavior,
  OperationalNature,
} from 'mintly-lib'
import type { SignupResult } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { RequestContext } from '../../../core/context/request-context'
import { AuditLog } from '../../audit/audit-log'

const TENANT = 'mintly'

interface DefaultCategory {
  name: string
  type: CategoryType
  behavior: CategoryBehavior
  operationalNature: OperationalNature
}

const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Venda Balcão', type: CategoryType.Revenue, behavior: CategoryBehavior.Variable, operationalNature: OperationalNature.Operational },
  { name: 'Venda Delivery', type: CategoryType.Revenue, behavior: CategoryBehavior.Variable, operationalNature: OperationalNature.Operational },
  { name: 'CMV/Insumos', type: CategoryType.Expense, behavior: CategoryBehavior.Variable, operationalNature: OperationalNature.Operational },
  { name: 'Salários', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.Operational },
  { name: 'Aluguel', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.Operational },
  { name: 'Impostos', type: CategoryType.Expense, behavior: CategoryBehavior.Fixed, operationalNature: OperationalNature.NonOperational },
]

// Garante o índice único de e-mail uma vez por env (banco).
const indexedEnvs = new Set<string>()

export class RegisterUseCase {
  async execute (rawInput: unknown, ctx: RequestContext): Promise<SignupResult> {
    // 1. Valida o payload via contrato compartilhado da lib
    const data = signupRequestSchema.parse(rawInput)

    // 2. Aceite obrigatório (cross-field)
    if (!data.termsAccepted) {
      throw new SapphireValidationError([
        { path: ['termsAccepted'], code: 'custom' as any, message: 'É necessário aceitar os termos de uso e a política de privacidade.' },
      ])
    }

    const connection = MongoDBConnection.getInstance()
    const db = connection.getDatabase(ctx.env)
    await this.ensureUserIndexes(ctx.env)

    const session = connection.getClient().startSession()
    let result!: SignupResult

    try {
      await session.withTransaction(async () => {
        const now = new Date().toISOString()
        const audit = { createdAt: now, updatedAt: now }

        // ── e-mail único ──────────────────────────────────────────────────────
        const existing = await db.collection('users').findOne({ email: data.email }, { session })
        if (existing) throw new ConflictError('Este e-mail já está cadastrado.')

        // ── person ────────────────────────────────────────────────────────────
        const personInsert = await db.collection('people').insertOne(
          { name: data.person.name, phone: data.person.phone, audit },
          { session },
        )
        const personId = personInsert.insertedId.toHexString()

        // ── restaurant ────────────────────────────────────────────────────────
        const restaurantInsert = await db.collection('restaurants').insertOne(
          { name: data.restaurantName, audit },
          { session },
        )
        const restaurantId = restaurantInsert.insertedId.toHexString()

        // ── user (person como Extended Reference) ─────────────────────────────
        const passwordHash = this.hashPassword(data.password)
        const userInsert = await db.collection('users').insertOne(
          {
            person: { _id: personId, name: data.person.name },
            email: data.email,
            passwordHash,
            role: UserRole.Owner,
            status: UserStatus.Active,
            restaurantId,
            termsAcceptedAt: now,
            lastAccessAt: now,
            audit,
          },
          { session },
        )
        const userId = userInsert.insertedId.toHexString()

        // ── onboarding: conta Caixa padrão ────────────────────────────────────
        await db.collection('financial_accounts').insertOne(
          {
            restaurantId,
            name: 'Caixa',
            type: FinancialAccountType.Cash,
            status: RecordStatus.Active,
            isDefault: true,
            audit,
          },
          { session },
        )

        // ── onboarding: categorias padrão (isSystem) ──────────────────────────
        const categoryDocs = DEFAULT_CATEGORIES.map(cat => ({
          restaurantId,
          name: cat.name,
          type: cat.type,
          behavior: cat.behavior,
          operationalNature: cat.operationalNature,
          status: RecordStatus.Active,
          isSystem: true,
          audit,
        }))
        await db.collection('financial_categories').insertMany(categoryDocs, { session })

        // ── auditoria de eventos ──────────────────────────────────────────────
        const auditLogs: Array<Omit<AuditLog, '_id'>> = [
          { event: 'account_created', userId, restaurantId, data: { email: data.email, name: data.person.name }, createdAt: now },
          { event: 'restaurant_created', userId, restaurantId, data: { restaurantName: data.restaurantName }, createdAt: now },
          { event: 'terms_accepted', userId, restaurantId, data: { termsAccepted: true }, createdAt: now },
          { event: 'onboarding_completed', userId, restaurantId, data: { defaultAccounts: 1, defaultCategories: DEFAULT_CATEGORIES.length }, createdAt: now },
        ]
        await db.collection('audit_logs').insertMany(auditLogs, { session })

        // ── JWT ───────────────────────────────────────────────────────────────
        const jwt = getJwtService(ctx.env)
        const tokens = await jwt.generate({
          tenantId: TENANT,
          subject: userId,
          claims: { name: data.person.name, email: data.email, role: UserRole.Owner, restaurantId },
        })

        result = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user: {
            _id: userId,
            person: { _id: personId, name: data.person.name },
            email: data.email,
            role: UserRole.Owner,
            status: UserStatus.Active,
            restaurantId,
            termsAcceptedAt: now,
            lastAccessAt: now,
            audit,
          },
          restaurant: { _id: restaurantId, name: data.restaurantName, audit },
        }
      })
    } finally {
      await session.endSession()
    }

    return result
  }

  private async ensureUserIndexes (env: string): Promise<void> {
    if (indexedEnvs.has(env)) return
    const db = MongoDBConnection.getInstance().getDatabase(env)
    await db.collection('users').createIndex({ email: 1 }, { unique: true })
    indexedEnvs.add(env)
  }

  private hashPassword (password: string): string {
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${hash}`
  }
}
