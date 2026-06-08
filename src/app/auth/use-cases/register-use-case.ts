import { randomBytes, scryptSync } from 'crypto'
import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { registerSchema, throwFieldError } from '../register-schema'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { User } from '../../user/user'
import { Restaurant } from '../../restaurant/restaurant'
import { FinancialAccount } from '../../financial/financial-account'
import { FinancialCategory } from '../../financial/financial-category'
import { AuditLog } from '../../audit/audit-log'
import { authDbName } from '../auth-db'

const TENANT = 'mintly'

export interface RegisterResult {
  accessToken: string
  refreshToken: string | null
  user: Pick<User, 'name' | 'email'>
  restaurant: { id: string; name: string }
}

const DEFAULT_CATEGORIES: Omit<FinancialCategory, '_id' | 'restaurantId' | 'createdAt' | 'updatedAt'>[] = [
  { name: 'Venda Balcão',   type: 'income',  behavior: 'variable', operationalNature: 'operational',     isSystem: true },
  { name: 'Venda Delivery', type: 'income',  behavior: 'variable', operationalNature: 'operational',     isSystem: true },
  { name: 'CMV / Insumos',  type: 'expense', behavior: 'variable', operationalNature: 'operational',     isSystem: true },
  { name: 'Salários',       type: 'expense', behavior: 'fixed',    operationalNature: 'operational',     isSystem: true },
  { name: 'Aluguel',        type: 'expense', behavior: 'fixed',    operationalNature: 'operational',     isSystem: true },
  { name: 'Impostos',       type: 'expense', behavior: 'fixed',    operationalNature: 'non_operational', isSystem: true },
]

export class RegisterUseCase {
  async execute (rawInput: unknown, env = 'default'): Promise<RegisterResult> {
    const data = registerSchema.parse(rawInput)

    if (data.password !== data.confirmPassword) {
      throwFieldError('confirmPassword', 'As senhas não conferem.')
    }
    if (!data.acceptedTerms) {
      throwFieldError('acceptedTerms', 'É necessário aceitar os termos de uso para prosseguir.')
    }
    if (!data.acceptedPrivacy) {
      throwFieldError('acceptedPrivacy', 'É necessário aceitar a política de privacidade para prosseguir.')
    }

    const mongoClient = MongoDBConnection.getInstance().getClient()
    const db = MongoDBConnection.getInstance().getDatabase(authDbName(env))
    const session = mongoClient.startSession()

    let result!: RegisterResult

    try {
      await session.withTransaction(async () => {
        const now = new Date().toISOString()

        // ── Email uniqueness (índice único garante atomicidade em concurrent writes) ──
        const existing = await db.collection('users').findOne({ email: data.email }, { session })
        if (existing) throw new ConflictError('Este e-mail já está cadastrado.')

        // ── Pre-allocate restaurant ID ────────────────────────────────────────
        const restaurantId = new ObjectId()

        // ── Create user ───────────────────────────────────────────────────────
        const userDoc: Omit<User, '_id'> = {
          name: data.name,
          email: data.email,
          passwordHash: this.hashPassword(data.password),
          status: 'active',
          role: 'admin',
          restaurantId: restaurantId.toString(),
          loginAttempts: 0,
          blockedUntil: null,
          termsAccepted: true,
          termsAcceptedAt: now,
          lastAccessAt: now,
          createdAt: now,
          updatedAt: now,
        }
        const userInsert = await db.collection<User>('users').insertOne(userDoc as User, { session })
        const userId = userInsert.insertedId.toString()

        // ── Create restaurant ─────────────────────────────────────────────────
        const restaurantDoc: Restaurant = {
          _id: restaurantId.toString() as any,
          name: data.restaurantName,
          createdAt: now,
          updatedAt: now,
        }
        await db.collection<Restaurant>('restaurants').insertOne(
          { ...restaurantDoc, _id: restaurantId } as any,
          { session },
        )

        // ── Onboarding: default account ───────────────────────────────────────
        const accountDoc: Omit<FinancialAccount, '_id'> = {
          restaurantId: restaurantId.toString(),
          name: 'Caixa',
          type: 'cash',
          isActive: true,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        }
        await db.collection<FinancialAccount>('financial_accounts').insertOne(
          accountDoc as FinancialAccount,
          { session },
        )

        // ── Onboarding: default categories ───────────────────────────────────
        const categoryDocs: Omit<FinancialCategory, '_id'>[] = DEFAULT_CATEGORIES.map(cat => ({
          ...cat,
          restaurantId: restaurantId.toString(),
          createdAt: now,
          updatedAt: now,
        }))
        await db.collection<FinancialCategory>('financial_categories').insertMany(
          categoryDocs as FinancialCategory[],
          { session },
        )

        // ── Audit trail ───────────────────────────────────────────────────────
        const auditLogs: Omit<AuditLog, '_id'>[] = [
          {
            event: 'account_created',
            userId,
            restaurantId: restaurantId.toString(),
            data: { email: data.email, name: data.name },
            createdAt: now,
          },
          {
            event: 'restaurant_created',
            userId,
            restaurantId: restaurantId.toString(),
            data: { restaurantName: data.restaurantName },
            createdAt: now,
          },
          {
            event: 'terms_accepted',
            userId,
            restaurantId: restaurantId.toString(),
            data: { acceptedTerms: true, acceptedPrivacy: true },
            createdAt: now,
          },
          {
            event: 'onboarding_completed',
            userId,
            restaurantId: restaurantId.toString(),
            data: { defaultAccounts: 1, defaultCategories: DEFAULT_CATEGORIES.length },
            createdAt: now,
          },
        ]
        await db.collection<AuditLog>('audit_logs').insertMany(auditLogs as AuditLog[], { session })

        // ── Generate JWT ──────────────────────────────────────────────────────
        const jwt = getJwtService()
        const tokens = await jwt.generate({
          tenantId: TENANT,
          subject: userId,
          claims: {
            name: data.name,
            email: data.email,
            restaurantId: restaurantId.toString(),
            role: 'admin',
          },
        })

        result = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user: { name: data.name, email: data.email },
          restaurant: { id: restaurantId.toString(), name: data.restaurantName },
        }
      })
    } finally {
      await session.endSession()
    }

    return result
  }

  private hashPassword (password: string): string {
    const salt = randomBytes(16).toString('hex')
    const hash = scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${hash}`
  }
}
