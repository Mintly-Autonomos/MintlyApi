import {
  IMPORT_MOVEMENTS_MAX_ROWS,
  ImportMovementRowResult,
  ImportMovementsResult,
  importMovementRowSchema,
} from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
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

/** Sinal interno: desfaz a transação inteira porque ao menos uma linha não pôde ser gravada. */
class ImportRolledBack extends Error {}

export const ROLLED_BACK_CODE = 'ROLLED_BACK'
const ROLLED_BACK_MESSAGE = 'Não foi importada: outra linha tem problema e a importação inteira foi cancelada. Nada foi gravado.'

/**
 * Importa várias movimentações num só pedido, TUDO OU NADA: todas as linhas seguem as MESMAS regras do
 * `register` (conta e categoria vivas, categoria × direção, duplicidade, saldo) dentro de UMA
 * transação, mas em lote (`executeBatch`): conta, categoria e pratos são lidos uma vez, a duplicidade é
 * conferida numa consulta, as linhas entram num `insertMany` e cada saldo recebe um `$inc` só. Assim o
 * tempo não cresce por linha (500 linhas = umas poucas operações no banco, e não ~2.500).
 * Se qualquer linha falhar, a transação é desfeita: nada é gravado, nenhum saldo muda e o
 * resultado traz o motivo de cada linha com problema (as demais voltam como `ROLLED_BACK`).
 * O pedido todo é avaliado antes de desfazer, para a pessoa corrigir todos os erros de uma vez.
 *
 * Idempotência: a chave é reservada antes de gravar. Reenviar a mesma chave de uma importação que
 * deu certo devolve o resultado da primeira vez (`replayed: true`) sem gravar de novo; duas
 * importações iguais ao mesmo tempo não rodam juntas (a segunda recebe 409). Importação desfeita
 * libera a chave: como nada foi gravado, tentar de novo é seguro.
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
      const result = await this.importAllOrNothing(input.rows, ctx)
      if (result.failed > 0) {
        // Nada foi gravado: libera a chave para a pessoa poder tentar de novo (com ou sem correção).
        await this.imports.release(input.idempotencyKey, ctx).catch(() => null)
        return result
      }
      await this.imports.complete(input.idempotencyKey, result, ctx)
      return result
    } catch (error) {
      // Falha inesperada (não de linha): a transação foi desfeita, então a chave é liberada.
      await this.imports.release(input.idempotencyKey, ctx).catch(() => null)
      throw error
    }
  }

  private async importAllOrNothing (rows: unknown[], ctx: RequestContext): Promise<ImportMovementsResult> {
    const session = MongoDBConnection.getInstance().getClient().startSession()
    let results: ImportMovementRowResult[] = []

    try {
      await session.withTransaction(async () => {
        // O driver pode repetir o bloco em falha transitória: recomeça do zero.
        results = []
        const rowNumbers = rows.map((raw) => rowNumberOf(raw))
        const failures = new Map<number, ImportMovementRowResult>()
        const accepted: { index: number; input: RegisterMovementInput }[] = []

        for (const [index, raw] of rows.entries()) {
          try {
            importMovementRowSchema.parse(raw)
            // A linha vai como veio (a data em string, p. ex.): o register faz suas próprias conversões.
            const { row: _row, ...body } = raw as Record<string, unknown>
            accepted.push({ index, input: body as unknown as RegisterMovementInput })
          } catch (error) {
            failures.set(index, this.rowFailure(rowNumbers[index], error))
          }
        }

        // O lote todo vai junto (poucas operações no banco, não uma série por linha).
        const batch = await this.register.executeBatch(accepted.map((a) => a.input), ctx, session)
        if (batch.written && failures.size === 0) {
          // Nenhuma linha foi recusada: `accepted` são todas as linhas, na mesma ordem.
          results = batch.movements.map((movement, index) => ({ row: rowNumbers[index], status: 'created' as const, movement }))
          return
        }
        if (!batch.written) {
          for (const [position, error] of batch.errors) {
            const index = accepted[position].index
            failures.set(index, this.rowFailure(rowNumbers[index], error))
          }
        }

        // Alguma linha com problema: desfaz a transação (se o lote chegou a gravar, some junto), nada
        // fica gravado e as linhas boas voltam como desfeitas.
        results = rows.map((_, index) => failures.get(index) ?? {
          row: rowNumbers[index],
          status: 'failed' as const,
          error: { code: ROLLED_BACK_CODE, message: ROLLED_BACK_MESSAGE },
        })
        throw new ImportRolledBack()
      })
    } catch (error) {
      if (!(error instanceof ImportRolledBack)) throw error
    } finally {
      await session.endSession()
    }

    const created = results.filter((r) => r.status === 'created').length
    return { replayed: false, total: results.length, created, failed: results.length - created, results }
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

  /**
   * O erro de UMA linha vira o resultado dela. Falha de infraestrutura (ex.: a transação caiu) não é
   * culpa da linha: sobe, e o driver repete o bloco se for transitória; senão o pedido falha inteiro e
   * nada é gravado.
   */
  private rowFailure (row: number, error: unknown): ImportMovementRowResult {
    const rowError = toImportRowError(error)
    if (rowError.code === 'INTERNAL_ERROR') throw error
    return { row, status: 'failed', error: rowError }
  }
}

function rowNumberOf (raw: unknown): number {
  const rowNumber = Number((raw as { row?: unknown })?.row)
  return Number.isInteger(rowNumber) && rowNumber >= 1 ? rowNumber : 0
}

export { IMPORT_MOVEMENTS_MAX_ROWS }
