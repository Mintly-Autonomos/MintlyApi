import {
  FinancialAccountType,
  SettlementRule,
  SettlementRuleKind,
  describeSettlementRule,
  resolveSettlementRule,
  validateSettlementRule,
} from 'mintly-lib'
import { ConflictError } from '../../core/errors/auth/conflict-error'
import { ValidationError } from '../../core/errors/core/validation-error'

export interface AccountUpdateChanges {
  type?: string
  feePercent?: number
  settlementDays?: number
  settlementRule?: SettlementRule
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

  const touchesFee =
    changes.feePercent !== undefined ||
    changes.settlementDays !== undefined ||
    changes.settlementRule !== undefined
  if (touchesFee && storedType !== FinancialAccountType.Platform) {
    throw new ConflictError(
      'Somente contas do tipo plataforma têm taxa (feePercent) e regra de repasse (settlementDays/settlementRule).',
    )
  }
  if (changes.settlementRule !== undefined) assertSettlementRuleValid(changes.settlementRule)
}

/** A regra de repasse faz sentido (a forma já foi validada pelo schema da lib). */
export function assertSettlementRuleValid (rule: SettlementRule): void {
  const problem = validateSettlementRule(rule)
  if (problem) throw new ValidationError(problem)
}

/**
 * Criação: conta plataforma precisa dizer QUANDO a plataforma repassa (`settlementRule` ou o
 * `settlementDays` antigo). O schema da lib tem os dois opcionais; que ao menos um exista é regra daqui.
 */
export function assertPlatformSettlement (input: {
  type?: string
  settlementDays?: number
  settlementRule?: SettlementRule
}): void {
  if (input.type !== FinancialAccountType.Platform) return
  if (resolveSettlementRule(input) === null) {
    throw new ValidationError('Informe quando a plataforma repassa (settlementRule).')
  }
  if (input.settlementRule) assertSettlementRuleValid(input.settlementRule)
}

/**
 * Mantém o `settlementDays` antigo coerente com a regra "N dias após a venda" (quem ainda lê só
 * `settlementDays` continua certo). Nas outras regras o campo não tem sentido e fica como está.
 */
export function syncLegacySettlementDays<T extends { settlementRule?: SettlementRule, settlementDays?: number }> (item: T): T {
  if (item.settlementRule?.kind === SettlementRuleKind.AfterDays) {
    return { ...item, settlementDays: item.settlementRule.days }
  }
  return item
}

/** Evento gravado em `history[]` da conta (mesmo formato dos use cases de padrão/inativação). */
export interface AccountHistoryEntry {
  at: Date
  by: string
  action: string
  detail?: string
}

export interface AccountHistoryState {
  name?: string
  status?: string
  feePercent?: number
  settlementDays?: number
  settlementRule?: SettlementRule
}

const fmtNumber = (n: number): string => String(n).replace('.', ',')

/**
 * Eventos de histórico de um PATCH de conta, comparando o estado ARMAZENADO com o que o
 * PATCH quer mudar. Só entra evento de campo que veio no PATCH E mudou de verdade (reenviar o
 * formulário inteiro sem alterar nada não suja o histórico).
 *
 * `action` é um código estável (a tela traduz); `detail` já vem pronto para leitura, no formato
 * do protótipo ("12% → 14%", "2 dias → 30 dias"). Taxa/prazo ausentes no armazenado valem 0.
 * Ordem: nome, status, taxa, prazo.
 */
export function buildAccountChangeHistory (
  stored: AccountHistoryState,
  changes: AccountHistoryState,
  by: string,
  now: Date = new Date(),
): AccountHistoryEntry[] {
  const entries: AccountHistoryEntry[] = []
  const add = (action: string, detail?: string) => {
    entries.push(detail === undefined ? { at: now, by, action } : { at: now, by, action, detail })
  }

  if (changes.name !== undefined && changes.name !== stored.name) {
    add('update-name', `${stored.name ?? ''} → ${changes.name}`)
  }

  if (changes.status !== undefined && changes.status !== stored.status) {
    add(changes.status === 'active' ? 'reactivate' : 'inactivate')
  }

  if (changes.feePercent !== undefined && changes.feePercent !== (stored.feePercent ?? 0)) {
    add('update-fee', `${fmtNumber(stored.feePercent ?? 0)}% → ${fmtNumber(changes.feePercent)}%`)
  }

  if (changes.settlementRule !== undefined) {
    const before = resolveSettlementRule(stored)
    const after = changes.settlementRule
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      add('update-settlement', `${before ? describeSettlementRule(before) : 'Sem repasse'} → ${describeSettlementRule(after)}`)
    }
  } else if (changes.settlementDays !== undefined && changes.settlementDays !== (stored.settlementDays ?? 0)) {
    add('update-settlement', `${fmtNumber(stored.settlementDays ?? 0)} dias → ${fmtNumber(changes.settlementDays)} dias`)
  }

  return entries
}
