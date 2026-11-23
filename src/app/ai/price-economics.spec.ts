import { describe, expect, it } from 'vitest'
import { bestPrice, elasticityOf, menuClassOf } from './price-economics'

describe('menuClassOf (reteste 22/11, T10: a IA usa a classificação da tela)', () => {
  // Combo do reteste: margem de R$ 52,40 por unidade, acima da média do grupo; em % fica abaixo de pratos baratos.
  const dishes = [
    { id: 'combo', price: 79.9, cost: 27.5, sold: 305, category: 'Combos' },
    { id: 'hot', price: 25.4, cost: 5, sold: 400, category: 'Combos' },
    { id: 'temaki', price: 30, cost: 6, sold: 60, category: 'Combos' },
    { id: 'refri', price: 7, cost: 2, sold: 900, category: 'Bebidas' },
  ]

  it('margem em R$ por unidade contra a média pesada pelas vendas, só no mesmo perfil', () => {
    const c = menuClassOf('combo', dishes, [])!
    expect(c.group).toBe('Melhores')
    expect(c.unitMargin).toBe(52.4)
    // (52,4 × 305 + 20,4 × 400 + 24 × 60) / 765 = 33,44; a bebida (outro perfil) fica fora.
    expect(c.averageUnitMargin).toBeCloseTo(33.44, 2)
    expect(c.comparedDishes).toBe(3)
  })

  it('pouca venda e margem abaixo: Fracos; sem custo ou sem venda: fora da análise', () => {
    expect(menuClassOf('temaki', dishes, [])!.group).toBe('Fracos')
    expect(menuClassOf('hot', dishes, [])!.group).toBe('Populares')
    expect(menuClassOf('x', [{ id: 'x', price: 10, cost: 0, sold: 5 }], [])).toBeNull()
    expect(menuClassOf('x', [{ id: 'x', price: 10, cost: 2, sold: 0 }], [])).toBeNull()
  })
})

describe('price-economics (reteste 18/11, item 6)', () => {
  it('elasticidade: prato > perfil salvo da categoria > sugerido pelo nome > dia a dia', () => {
    expect(elasticityOf({ category: 'Doces', priceSensitivity: 'low' as any }, [])).toMatchObject({ elasticity: -1.2, source: 'dish' })
    expect(elasticityOf({ category: 'doces' }, [{ category: 'Doces', profile: 'order' as any }])).toMatchObject({ elasticity: -1, profile: 'order' })
    expect(elasticityOf({ category: 'Bebidas' }, [])).toMatchObject({ elasticity: -1.2, profile: 'drink' })
    expect(elasticityOf({ category: null }, [])).toMatchObject({ elasticity: -1.5, profile: 'everyday' })
  })

  it('torta do reteste: a R$ 22 o simulador perde dinheiro, então a conta não sugere 22', () => {
    // Torta holandesa: R$ 19, custo R$ 6,90, 23 vendidas, balcão (-2,0). Ótimo = 6,90 × 2 = 13,80 < 19: manter.
    const d = bestPrice({ price: 19, cost: 6.9, sold: 23, elasticity: -2, ceiling: 22.8 })!
    expect(d).toMatchObject({ price: 19, keep: true })
    expect(d.profitNow).toBeCloseTo(12.1 * 23, 2)
  })

  it('aumento que dá mais lucro: para no teto quando o ótimo passa dele; preço em passos de R$ 0,50', () => {
    expect(bestPrice({ price: 30, cost: 14, sold: 100, elasticity: -1.5, ceiling: 36 })).toMatchObject({ price: 36, keep: false })
    // e = -3, custo 20: ótimo 30; preço atual 25,30 → sobe até 30 (múltiplo de 0,50).
    expect(bestPrice({ price: 25.3, cost: 20, sold: 50, elasticity: -3, ceiling: 30.36 })!.price).toBe(30)
  })

  it('sem vendas registradas não dá para simular', () => {
    expect(bestPrice({ price: 30, cost: 14, sold: 0, elasticity: -1.5, ceiling: 36 })).toBeNull()
  })
})
