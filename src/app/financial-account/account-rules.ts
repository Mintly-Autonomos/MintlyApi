import { FinancialAccountType } from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'

export interface AccountUpdateChanges {
  type?: string
  feePercent?: number
  settlementDays?: number
}

/**
 * Regras do PATCH de conta (P5) — puras, testáveis sem Mongo (espelha
 * `financial-movement/movement-rules.ts`).
 *
 * Por que a regra mora AQUI e não no schema: a coerência `platform ⇔ taxa/prazo`
 * depende do tipo ARMAZENADO, e num PATCH parcial o `type` não vem no payload. O
 * Sapphire também não tem `refine`/`superRefine`, então a união discriminada só
 * consegue impor a regra na CRIAÇÃO. O update depende de estado — logo, é regra de
 * aplicação.
 *
 * O `type` é IMUTÁVEL: trocá-lo permitiria criar uma conta `platform` sem taxa/prazo
 * (estado que a criação proíbe) e reescreveria o significado do histórico, já que
 * `defaultStatus`/`computeSnapshot` decidem tudo pelo tipo da conta. O schema da lib
 * já rejeita o campo; este guard existe para dar uma mensagem clara em vez de um
 * VALIDATION_ERROR seco.
 */
export function assertAccountUpdateAllowed (storedType: string, changes: AccountUpdateChanges): void {
  if (changes.type !== undefined) {
    throw new ConflictError(
      'O tipo da conta não pode ser alterado. Inative esta conta e crie outra com o tipo correto.',
    )
  }

  const touchesFee = changes.feePercent !== undefined || changes.settlementDays !== undefined
  if (touchesFee && storedType !== FinancialAccountType.Platform) {
    throw new ConflictError(
      'Somente contas do tipo plataforma têm taxa (feePercent) e prazo de liquidação (settlementDays).',
    )
  }
}
