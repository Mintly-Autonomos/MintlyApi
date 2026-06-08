import { randomBytes, scryptSync } from 'crypto'
import { ClientSession, ObjectId } from 'mongodb'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { getJwtService } from '../../../infrastructure/jwt/jwt-service'
import { registerSchema, throwFieldError } from '../register-schema'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { User } from '../../user/user'
import { Organization } from '../../organization/organization'
import { OrganizationMember } from '../../organization/organization-member'
import { FinancialAccount } from '../../financial/financial-account'
import { FinancialCategory } from '../../financial/financial-category'
import { AuditLog } from '../../audit/audit-log'

const TENANT = 'mintly'

const DB_NAME = () => process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly'

export interface RegisterResult {
  accessToken: string
  refreshToken: string | null
  user: Pick<User, 'nome' | 'email'>
  organization: Pick<Organization, 'nome'> & { id: string }
}

const DEFAULT_CATEGORIES: Omit<FinancialCategory, '_id' | 'organizationId' | 'createdAt' | 'updatedAt'>[] = [
  { nome: 'Venda Balcão',   tipo: 'Receita',  comportamentoFinanceiro: 'Variável', naturezaOperacional: 'Operacional'     },
  { nome: 'Venda Delivery', tipo: 'Receita',  comportamentoFinanceiro: 'Variável', naturezaOperacional: 'Operacional'     },
  { nome: 'CMV / Insumos',  tipo: 'Despesa',  comportamentoFinanceiro: 'Variável', naturezaOperacional: 'Operacional'     },
  { nome: 'Salários',       tipo: 'Despesa',  comportamentoFinanceiro: 'Fixa',     naturezaOperacional: 'Operacional'     },
  { nome: 'Aluguel',        tipo: 'Despesa',  comportamentoFinanceiro: 'Fixa',     naturezaOperacional: 'Operacional'     },
  { nome: 'Impostos',       tipo: 'Despesa',  comportamentoFinanceiro: 'Fixa',     naturezaOperacional: 'Não Operacional' },
]

export class RegisterUseCase {
  async execute (rawInput: unknown): Promise<RegisterResult> {
    // 1. Validate shape + field rules via Sapphire (throws SapphireValidationError)
    const data = registerSchema.parse(rawInput)

    // 2. Cross-field validations
    if (data.senha !== data.confirmarSenha) {
      throwFieldError('confirmarSenha', 'As senhas não conferem.')
    }
    if (!data.aceitouTermos) {
      throwFieldError('aceitouTermos', 'É necessário aceitar os termos de uso para prosseguir.')
    }
    if (!data.aceitouPrivacidade) {
      throwFieldError('aceitouPrivacidade', 'É necessário aceitar a política de privacidade para prosseguir.')
    }

    // 3. Transactional registration + onboarding
    const mongoClient = MongoDBConnection.getInstance().getClient()
    const db = MongoDBConnection.getInstance().getDatabase(DB_NAME())
    const session = mongoClient.startSession()

    let result!: RegisterResult

    try {
      await session.withTransaction(async () => {
        const now = new Date().toISOString()

        // ── Check email uniqueness ────────────────────────────────────────────
        const existing = await db.collection('users').findOne({ email: data.email }, { session })
        if (existing) throw new ConflictError('Este e-mail já está cadastrado.')

        // ── Create user ───────────────────────────────────────────────────────
        const passwordHash = this.hashPassword(data.senha)
        const userDoc: Omit<User, '_id'> = {
          nome: data.nome,
          email: data.email,
          passwordHash,
          termosAceitos: true,
          aceitouTermosEm: now,
          ultimoAcesso: now,
          createdAt: now,
          updatedAt: now,
        }
        const userInsert = await db.collection<User>('users').insertOne(userDoc as User, { session })
        const userId = userInsert.insertedId.toString()

        // ── Create organization ───────────────────────────────────────────────
        const orgDoc: Omit<Organization, '_id'> = {
          nome: data.nomeRestaurante,
          createdAt: now,
          updatedAt: now,
        }
        const orgInsert = await db.collection<Organization>('organizations').insertOne(orgDoc as Organization, { session })
        const orgId = orgInsert.insertedId.toString()

        // ── Create org member (admin) ─────────────────────────────────────────
        const memberDoc: Omit<OrganizationMember, '_id'> = {
          organizationId: orgId,
          userId,
          papel: 'administrador',
          createdAt: now,
        }
        await db.collection<OrganizationMember>('organization_members').insertOne(memberDoc as OrganizationMember, { session })

        // ── Onboarding: default account ───────────────────────────────────────
        const accountDoc: Omit<FinancialAccount, '_id'> = {
          organizationId: orgId,
          nome: 'Caixa',
          tipo: 'Caixa',
          ativa: true,
          padrao: true,
          createdAt: now,
          updatedAt: now,
        }
        await db.collection<FinancialAccount>('financial_accounts').insertOne(accountDoc as FinancialAccount, { session })

        // ── Onboarding: default categories ───────────────────────────────────
        const categoryDocs: Omit<FinancialCategory, '_id'>[] = DEFAULT_CATEGORIES.map(cat => ({
          ...cat,
          organizationId: orgId,
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
            evento: 'conta_criada',
            userId,
            organizationId: orgId,
            dados: { email: data.email, nome: data.nome },
            criadoEm: now,
          },
          {
            evento: 'organizacao_criada',
            userId,
            organizationId: orgId,
            dados: { nomeRestaurante: data.nomeRestaurante },
            criadoEm: now,
          },
          {
            evento: 'termos_aceitos',
            userId,
            organizationId: orgId,
            dados: { aceitouTermos: true, aceitouPrivacidade: true, ip: 'N/A' },
            criadoEm: now,
          },
          {
            evento: 'onboarding_concluido',
            userId,
            organizationId: orgId,
            dados: { contasPadrao: 1, categoriasPadrao: DEFAULT_CATEGORIES.length },
            criadoEm: now,
          },
        ]
        await db.collection<AuditLog>('audit_logs').insertMany(auditLogs as AuditLog[], { session })

        // ── Generate JWT ──────────────────────────────────────────────────────
        const jwt = getJwtService()
        const tokens = await jwt.generate({
          tenantId: TENANT,
          subject: userId,
          claims: {
            nome: data.nome,
            email: data.email,
            organizationId: orgId,
            papel: 'administrador',
          },
        })

        result = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user: { nome: data.nome, email: data.email },
          organization: { id: orgId, nome: data.nomeRestaurante },
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
