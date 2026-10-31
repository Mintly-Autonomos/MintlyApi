import { ObjectId } from 'mongodb'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import type { RequestContext } from '../context/request-context'

/**
 * A auditoria guarda QUEM mexeu como o id do usuário (`audit.createdBy`, `audit.updatedBy`,
 * `history[].by`). Para a tela mostrar o nome, a resposta ganha `audit.createdByName`,
 * `audit.updatedByName` e `history[].byName`, vindos de UMA consulta a `users` para todos os ids
 * da página. O id continua lá: o nome é só um acréscimo.
 *
 * Só olha usuários do MESMO restaurante e nunca derruba a resposta: se a consulta falhar, os itens
 * voltam como estavam (o front cai no id).
 */
type AuditedItem = Record<string, any>

const asId = (value: unknown): string | null =>
  typeof value === 'string' && ObjectId.isValid(value) && value.length === 24 ? value : null

function collectIds (items: AuditedItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    const audit = item?.audit
    for (const id of [asId(audit?.createdBy), asId(audit?.updatedBy)]) if (id) ids.add(id)
    if (Array.isArray(item?.history)) {
      for (const entry of item.history) {
        const id = asId(entry?.by)
        if (id) ids.add(id)
      }
    }
  }
  return ids
}

async function namesFor (ids: Set<string>, ctx: RequestContext): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (ids.size === 0 || !ctx.restaurantId) return names
  const users = await MongoDBConnection.getInstance()
    .getDatabase(ctx.env)
    .collection('users')
    .find(
      { _id: { $in: [...ids].map((id) => new ObjectId(id)) }, restaurantId: ctx.restaurantId },
      { projection: { 'person.name': 1 } },
    )
    .toArray()
  for (const user of users) {
    const name = user.person?.name
    if (typeof name === 'string' && name.trim()) names.set(String(user._id), name.trim())
  }
  return names
}

function withNames<T extends AuditedItem> (item: T, names: Map<string, string>): T {
  if (!item || typeof item !== 'object') return item
  const out: AuditedItem = { ...item }
  const audit = item.audit
  if (audit && typeof audit === 'object') {
    const createdByName = names.get(String(audit.createdBy))
    const updatedByName = names.get(String(audit.updatedBy))
    out.audit = {
      ...audit,
      ...(createdByName ? { createdByName } : {}),
      ...(updatedByName ? { updatedByName } : {}),
    }
  }
  if (Array.isArray(item.history)) {
    out.history = item.history.map((entry: AuditedItem) => {
      const byName = names.get(String(entry?.by))
      return byName ? { ...entry, byName } : entry
    })
  }
  return out as T
}

export async function attachAuditNames<T extends AuditedItem> (items: T[], ctx: RequestContext): Promise<T[]> {
  try {
    const names = await namesFor(collectIds(items), ctx)
    if (names.size === 0) return items
    return items.map((item) => withNames(item, names))
  } catch {
    return items
  }
}

export async function attachAuditNamesTo<T extends AuditedItem> (item: T, ctx: RequestContext): Promise<T> {
  if (!item || typeof item !== 'object') return item
  return (await attachAuditNames([item], ctx))[0]
}
