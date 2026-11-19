import {
  DEFAULT_SALES_PROFILE,
  PRICE_SENSITIVITY_ELASTICITY,
  SALES_PROFILE_ELASTICITY,
  suggestSalesProfile,
} from 'mintly-lib'
import type { MenuCategoryProfile, PriceSensitivity, SalesProfile } from 'mintly-lib'

/**
 * Conta do preço do prato com elasticidade (reteste 18/11, item 6) — a mesma do simulador do web:
 *   vendas no preço p = vendas hoje × (p ÷ preço atual) ^ e;  lucro = (p − custo) × vendas
 * Elasticidade na ordem: a escolhida no prato > o perfil da categoria (salvo, ou sugerido pelo nome) > dia a dia.
 * (A medida no último reajuste fica no web, que tem as vendas com o preço de cada dia.)
 */
export function elasticityOf (
  dish: { category?: string | null, priceSensitivity?: PriceSensitivity | null },
  profiles: MenuCategoryProfile[],
): { elasticity: number, source: 'dish' | 'category', profile: SalesProfile } {
  const name = (dish.category ?? '').trim().toLocaleLowerCase('pt-BR')
  const saved = profiles.find((p) => p.category.trim().toLocaleLowerCase('pt-BR') === name)
  const profile = saved?.profile ?? (name ? suggestSalesProfile(dish.category) : DEFAULT_SALES_PROFILE)
  if (dish.priceSensitivity) return { elasticity: PRICE_SENSITIVITY_ELASTICITY[dish.priceSensitivity], source: 'dish', profile }
  return { elasticity: SALES_PROFILE_ELASTICITY[profile], source: 'category', profile }
}

const money = (n: number) => Math.round(n * 100) / 100

export interface PriceDecision {
  /** Preço que mais dá lucro entre o atual e o teto (de R$ 0,50 em R$ 0,50); igual ao atual = manter. */
  price: number
  keep: boolean
  profitNow: number
  profitAtPrice: number
  soldNow: number
  soldAtPrice: number
}

/** Melhor preço entre o atual e `ceiling`. Sem vendas registradas, null (não dá para simular). */
export function bestPrice (p: { price: number, cost: number, sold: number, elasticity: number, ceiling: number }): PriceDecision | null {
  if (!(p.sold > 0) || !(p.price > 0)) return null
  const soldAt = (x: number) => p.sold * Math.pow(x / p.price, p.elasticity)
  const profitAt = (x: number) => (x - p.cost) * soldAt(x)
  const profitNow = profitAt(p.price)
  let best = p.price
  let bestProfit = profitNow
  for (let x = Math.ceil((p.price + 0.01) * 2) / 2; x <= p.ceiling + 1e-9; x += 0.5) {
    const v = profitAt(x)
    if (v > bestProfit + 0.005) { best = x; bestProfit = v }
  }
  return {
    price: money(best),
    keep: best === p.price,
    profitNow: money(profitNow),
    profitAtPrice: money(bestProfit),
    soldNow: Math.round(p.sold),
    soldAtPrice: Math.round(soldAt(best)),
  }
}
