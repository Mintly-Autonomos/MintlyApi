import { Db } from 'mongodb'
import { OperationalNature } from 'mintly-lib'

/**
 * Ids das categorias com Natureza "Não operacional" (empréstimo recebido, aporte, saldo inicial, equipamento,
 * parcelas, juros). O que entra ou sai nelas não é venda nem custo da operação: fica fora da receita, das
 * despesas, do RBT12 e do ponto de equilíbrio, e aparece só nas linhas de "não operacional" do Resultado.
 *
 * A classificação é a da categoria ATUAL (como o grupo do DRE): corrigir a categoria corrige o histórico.
 * O lançamento guarda `category._id` como texto, então o filtro é `{ 'category._id': { $nin: ids } }`.
 */
export async function nonOperatingCategoryIds (db: Db, restaurantId: string | undefined): Promise<string[]> {
  const docs = await db.collection('financial_categories')
    .find({ restaurantId, operationalNature: OperationalNature.NonOperational }, { projection: { _id: 1 } })
    .toArray()
  return docs.map((d) => String(d._id))
}

/** Filtro Mongo que deixa de fora os lançamentos dessas categorias (vazio = não filtra nada). */
export function excludeCategories (ids: string[]): Record<string, unknown> {
  return ids.length > 0 ? { 'category._id': { $nin: ids } } : {}
}
