import { ObjectId } from 'mongodb'
import type { ClientSession, Db } from 'mongodb'
import { MOVEMENT_ITEM_QTY_MAX } from 'mintly-lib'
import { ValidationError } from '../../core/errors/core/validation-error'

/** Prato vendido como o cliente envia: só o prato e a quantidade. */
export interface MovementItemRequest {
  menuItemId: string
  qty: number
}

/** Prato vendido como fica guardado: cópia do cardápio no dia da venda. */
export interface StoredMovementItem {
  menuItemId: string
  name: string
  qty: number
  unitPrice: number
}

/**
 * O mesmo prato repetido na lista vira uma linha só, com as quantidades somadas (a ordem da primeira
 * aparição se mantém). Passar de 99 unidades do mesmo prato é recusado.
 */
export function mergeItemRequests (items: MovementItemRequest[]): MovementItemRequest[] {
  const merged = new Map<string, number>()
  for (const item of items) {
    merged.set(item.menuItemId, (merged.get(item.menuItemId) ?? 0) + item.qty)
  }
  return Array.from(merged, ([menuItemId, qty]) => {
    if (qty > MOVEMENT_ITEM_QTY_MAX) {
      throw new ValidationError(`Quantidade acima de ${MOVEMENT_ITEM_QTY_MAX} para o mesmo prato.`)
    }
    return { menuItemId, qty }
  })
}

/**
 * Resolve os pratos pedidos contra o cardápio VIVO do restaurante e devolve o que fica guardado na
 * venda: nome e preço vêm do cardápio, nunca do cliente (ele não pode forjar o ranking de mais
 * vendidos). Prato de outro restaurante ou inexistente é recusado, como prato fora do cardápio
 * (inativo) — a não ser que já estivesse na venda editada (`keepInactive`), para editar uma venda
 * antiga sem ser obrigado a tirar um prato que saiu do cardápio depois.
 */
export async function resolveMovementItems (params: {
  db: Db
  restaurantId: string
  items: MovementItemRequest[]
  session?: ClientSession
  keepInactive?: ReadonlySet<string>
}): Promise<StoredMovementItem[]> {
  const requested = mergeItemRequests(params.items)
  if (requested.length === 0) return []

  const invalid = requested.find((i) => !ObjectId.isValid(i.menuItemId))
  if (invalid) throw new ValidationError('Prato inválido na venda.')

  const docs = await params.db.collection('menu_items')
    .find(
      { _id: { $in: requested.map((i) => new ObjectId(i.menuItemId)) }, restaurantId: params.restaurantId },
      { session: params.session },
    )
    .toArray()
  const byId = new Map(docs.map((d) => [String(d._id), d]))

  return requested.map(({ menuItemId, qty }) => {
    const dish = byId.get(menuItemId)
    if (!dish) throw new ValidationError('Prato não encontrado no cardápio deste restaurante.')
    if (dish.status !== 'active' && !params.keepInactive?.has(menuItemId)) {
      throw new ValidationError(`O prato "${dish.name}" está fora do cardápio.`)
    }
    return { menuItemId, name: String(dish.name), qty, unitPrice: Number(dish.price ?? 0) }
  })
}
