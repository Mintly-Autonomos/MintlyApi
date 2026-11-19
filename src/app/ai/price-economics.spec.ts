import { describe, expect, it } from 'vitest'
import { bestPrice, elasticityOf } from './price-economics'

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
