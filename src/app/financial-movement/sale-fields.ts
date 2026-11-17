import { MovementDirection } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'

/**
 * S3.4: hora da venda (`HH:MM`) e quantas vendas o lançamento soma (fechamento do dia). Só existem em
 * entrada. O formato é conferido pelo schema da lib no documento final; aqui fica a regra de negócio.
 */
export interface SaleFields {
  saleTime?: string
  salesCount?: number
}

export const SALE_FIELDS_ONLY_IN = 'Hora da venda e número de vendas só valem para entradas.'

/**
 * Valores finais dos dois campos. No registro não há `current`. Na edição: ausente mantém o que estava,
 * `null` limpa e valor troca. Saída com qualquer um dos dois informado → 400.
 */
export function resolveSaleFields (args: {
  direction: MovementDirection | string
  current?: SaleFields
  saleTime?: string | null
  salesCount?: number | null
}): SaleFields {
  if (args.direction !== MovementDirection.In) {
    if (args.saleTime != null || args.salesCount != null) throw new ValidationError(SALE_FIELDS_ONLY_IN)
    return {}
  }
  const saleTime = args.saleTime === undefined ? args.current?.saleTime : args.saleTime
  const salesCount = args.salesCount === undefined ? args.current?.salesCount : args.salesCount
  const out: SaleFields = {}
  if (saleTime != null) out.saleTime = saleTime
  if (salesCount != null) out.salesCount = salesCount
  return out
}
