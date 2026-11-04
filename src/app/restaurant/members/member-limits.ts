import { DEFAULT_SUBSCRIPTION_TIER, SUBSCRIPTION_MEMBER_LIMIT, SUBSCRIPTION_TIER_LABEL, memberLimitForTier } from 'mintly-lib'
import type { SubscriptionTier } from 'mintly-lib'
import { ValidationError } from '../../../core/errors/core/validation-error'

/**
 * Teto de logins de funcionário por restaurante, ativos ou não: ninguém é excluído (só inativado), então isto
 * segura a criação de logins em massa sem prender um negócio real que troca de equipe.
 * (O limite de funcionários ATIVOS por plano vem da lib: `SUBSCRIPTION_MEMBER_LIMIT`.)
 */
export const MAX_MEMBER_LOGINS = 50

export { memberLimitForTier }

/** Erro de "vagas esgotadas", com o plano e o caminho para resolver. */
export function memberLimitError (tier: SubscriptionTier | undefined): ValidationError {
  const plan = tier ?? DEFAULT_SUBSCRIPTION_TIER
  const limit = memberLimitForTier(plan)
  const upgrade = plan === 'basic' ? ` ou mude para o plano ${SUBSCRIPTION_TIER_LABEL.pro} (até ${SUBSCRIPTION_MEMBER_LIMIT.pro})` : ''
  return new ValidationError(
    `O plano ${SUBSCRIPTION_TIER_LABEL[plan]} permite até ${limit} funcionários ativos. Inative alguém${upgrade} para continuar.`,
  )
}
