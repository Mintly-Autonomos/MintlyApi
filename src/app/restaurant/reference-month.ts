import { ValidationError } from '../../core/errors/core/validation-error'
import { toLocalMonth } from '../reports/shared/period'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `?month=AAAA-MM` do GET /restaurants/me: padrão o mês corrente; futuro não existe. */
export function parseReferenceMonth (value: string | undefined, now: Date): string {
  const current = toLocalMonth(now)
  if (value == null) return current
  if (!MONTH.test(value)) throw new ValidationError('month inválido: use AAAA-MM.')
  if (value > current) throw new ValidationError('month não pode estar no futuro.')
  return value
}
