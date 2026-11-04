import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'

/**
 * Revoga todos os refresh tokens ainda válidos do usuário: ninguém consegue renovar o acesso, em nenhum
 * aparelho. Os access tokens já emitidos expiram sozinhos (15 min). Best-effort: falhar aqui não pode
 * desfazer a operação que pediu a revogação (troca de senha, inativação...).
 */
export async function revokeAllSessions (userId: string, ctx: RequestContext, reason: string): Promise<void> {
  try {
    const db = MongoDBConnection.getInstance().getDatabase(ctx.env)
    await db.collection('valkyrie_refresh_tokens').updateMany(
      { subject: userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revocationReason: reason } },
    )
  } catch {
    // Best-effort — access tokens expiram naturalmente em 15min
  }
}
