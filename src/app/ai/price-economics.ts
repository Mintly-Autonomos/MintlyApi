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

/** Grupos da matriz do cardápio, com os nomes que a tela mostra (Kasavana & Smith, 1982). */
export type MenuGroup = 'Melhores' | 'Populares' | 'Promissores' | 'Fracos'
/** Regra dos 70%: popular é quem vende pelo menos 70% da média de vendas por prato. */
export const POPULARITY_FACTOR = 0.7

export interface MenuClass {
  group: MenuGroup
  /** Margem do prato por unidade, em R$ (preço − custo). */
  unitMargin: number
  /** Margem média por unidade dos pratos comparados, pesada pelas vendas. */
  averageUnitMargin: number
  /** Perfil de venda do grupo comparado: a tela compara cada prato só com os do mesmo perfil. */
  profile: SalesProfile
  comparedDishes: number
}

/**
 * A mesma classificação da matriz do cardápio do web (reteste 22/11, T10): entra o prato ativo com custo e vendas,
 * comparado só com os do mesmo perfil de venda; margem em R$ por unidade contra a média pesada pelas vendas; popular
 * com pelo menos 70% da média de vendas. Antes a IA comparava a margem em % com a média simples e dizia "margem
 * abaixo da média" de um prato que a tela punha em "Melhores". null: o prato não entra na análise.
 */
export function menuClassOf (
  dishId: string,
  dishes: { id: string, price: number, cost: number, sold: number, category?: string | null, priceSensitivity?: PriceSensitivity | null }[],
  profiles: MenuCategoryProfile[],
): MenuClass | null {
  const withProfile = dishes.map((d) => ({ ...d, profile: elasticityOf(d, profiles).profile }))
  const target = withProfile.find((d) => d.id === dishId)
  if (!target || !(target.cost > 0) || !(target.sold > 0)) return null
  const peers = withProfile.filter((d) => d.profile === target.profile && d.cost > 0 && d.sold > 0)
  const totalSold = peers.reduce((s, d) => s + d.sold, 0)
  const threshold = (totalSold / peers.length) * POPULARITY_FACTOR
  const avg = peers.reduce((s, d) => s + (d.price - d.cost) * d.sold, 0) / totalSold
  const unit = target.price - target.cost
  const popular = target.sold >= threshold
  const good = unit >= avg
  const group: MenuGroup = popular && good ? 'Melhores' : popular ? 'Populares' : good ? 'Promissores' : 'Fracos'
  return { group, unitMargin: money(unit), averageUnitMargin: money(avg), profile: target.profile, comparedDishes: peers.length }
}

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
