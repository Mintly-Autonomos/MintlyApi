import {
  IMPORT_MOVEMENTS_MAX_ROWS,
  ImportMovementRowResult,
  ImportMovementsResult,
  importMovementRowSchema,
} from 'mintly-lib'
import { RequestContext } from '../../../core/context/request-context'
import { ConflictError } from '../../../core/errors/auth/conflict-error'
import { ValidationError } from '../../../core/errors/core/validation-error'
import { toImportRowError } from '../import-row-error'
import { MovementImportRepository } from '../movement-import-repository'
import { RegisterMovementInput, RegisterMovementUseCase } from './register-movement.use-case'

export interface ImportMovementsInput {
  idempotencyKey: string
  rows: unknown[]
}

/**
 * Importa várias movimentações num só pedido. Cada linha passa pelo MESMO `register` (conta e
 * categoria vivas, categoria × direção, duplicidade, saldo na transação) e é gravada de forma
 * independente: linha com problema vira `failed` no resultado e não derruba as demais.
 *
 * Idempotência: a chave é reservada antes de gravar. Reenviar a mesma chave devolve o resultado
 * da primeira vez (`replayed: true`) sem gravar de novo; duas importações iguais ao mesmo tempo
 * não rodam juntas (a segunda recebe 409).
 */
export class ImportMovementsUseCase {
  constructor (
    private readonly register: RegisterMovementUseCase = new RegisterMovementUseCase(),
    private readonly imports: MovementImportRepository = new MovementImportRepository(),
  ) {}

  async execute (input: ImportMovementsInput, ctx: RequestContext): Promise<ImportMovementsResult> {
    this.validateEnvelope(input)
    const reserved = await this.imports.reserve(input.idempotencyKey, ctx)

    if (!reserved) {
      const previous = await this.imports.find(input.idempotencyKey, ctx)
      if (previous?.status === 'done' && previous.result) return { ...previous.result, replayed: true }
      throw new ConflictError('Esta importação já está em andamento. Aguarde terminar antes de reenviar.')
    }

    try {
      const results: ImportMovementRowResult[] = []
      for (const raw of input.rows) {
        results.push(await this.importRow(raw, ctx))
      }

      const created = results.filter((r) => r.status === 'created').length
      const result: ImportMovementsResult = {
        replayed: false,
        total: results.length,
        created,
        failed: results.length - created,
        results,
      }
      await this.imports.complete(input.idempotencyKey, result, ctx)
      return result
    } catch (error) {
      // Só chega aqui falha inesperada (não de linha). Sem nada gravado a chave é liberada.
      await this.imports.release(input.idempotencyKey, ctx).catch(() => null)
      throw error
    }
  }

  /** Só o envelope falha o pedido inteiro; o conteúdo de cada linha é validado linha a linha. */
  private validateEnvelope (input: ImportMovementsInput): void {
    const key = input?.idempotencyKey
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new ValidationError('idempotencyKey é obrigatório (de 8 a 128 caracteres).')
    }
    if (!Array.isArray(input.rows) || input.rows.length === 0) {
      throw new ValidationError('rows deve ter ao menos uma linha.')
    }
    if (input.rows.length > IMPORT_MOVEMENTS_MAX_ROWS) {
      throw new ValidationError(`rows aceita no máximo ${IMPORT_MOVEMENTS_MAX_ROWS} linhas por importação.`)
    }
  }

  private async importRow (raw: unknown, ctx: RequestContext): Promise<ImportMovementRowResult> {
    const rowNumber = Number((raw as { row?: unknown })?.row)
    const row = Number.isInteger(rowNumber) && rowNumber >= 1 ? rowNumber : 0

    try {
      importMovementRowSchema.parse(raw)
      // A linha vai como veio (a data em string, p. ex.): o register faz suas próprias conversões.
      const { row: _row, ...body } = raw as Record<string, unknown>
      const movement = await this.register.execute(body as unknown as RegisterMovementInput, ctx)
      return { row, status: 'created', movement }
    } catch (error) {
      return { row, status: 'failed', error: toImportRowError(error) }
    }
  }
}

export { IMPORT_MOVEMENTS_MAX_ROWS }
