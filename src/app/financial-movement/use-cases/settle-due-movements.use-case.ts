import { Filter, Document } from 'mongodb'
import { MovementStatus, MovementStatusSource } from 'mintly-lib'
import MongoDBConnection from '../../../infrastructure/db/mongodb/mongodb-connection'
import { applyStatusTransition } from '../movement-status'

export interface SettleDueResult {
  settled: number
  failed: number
}

/**
 * Critério do que é um "pendente vencido". Serve à varredura (fora da transação)
 * E à releitura dentro da sessão — tem que ser o MESMO nos dois lugares, senão a
 * releitura deixa de ser um guard.
 *
 * `statusSource` AUSENTE casa com `$ne: 'manual'` no Mongo — é assim que o
 * backlog anterior ao campo é tratado como `auto` e liquida na primeira rodada,
 * sem script de migração.
 */
const dueFilter = (now: Date): Filter<Document> => ({
  status: MovementStatus.Pending,
  statusSource: { $ne: MovementStatusSource.Manual },
  predictedReceiptDate: { $lte: now },
})

/**
 * Liquidação automática por data (P1). Movimentos de conta `platform` nascem
 * `pending` (saldo "a receber") e, até aqui, NUNCA saíam de lá sozinhos: o
 * `predictedReceiptDate` era gravado e ninguém o lia. Resultado: o saldo
 * disponível subestimava o caixa real indefinidamente.
 *
 * Este use-case é **puro de infraestrutura de request**: não conhece Fastify,
 * header nem RequestContext — recebe o `env` e trabalha. É o que permite chamá-lo
 * de um script agendado hoje e de uma Lambda amanhã, sem reescrever nada.
 *
 * **Cross-tenant de propósito.** O tenant (`restaurantId`) é campo do documento,
 * não banco: uma única query por ambiente pega os movimentos de TODOS os
 * restaurantes. Não existe "enumerar tenants". É a única operação da API que roda
 * sem `restaurantId` — e roda fora de request, nunca a partir de um token. As
 * ESCRITAS seguem escopadas por tenant (`applyStatusTransition` filtra por
 * `restaurantId` do próprio documento).
 *
 * **Uma transação por movimento**, não uma gigante: um documento problemático não
 * pode derrubar a rodada inteira nem prender o lock do banco por minutos.
 */
export class SettleDueMovementsUseCase {
  async execute (params: { env: string; now?: Date }): Promise<SettleDueResult> {
    const now = params.now ?? new Date()
    const connection = MongoDBConnection.getInstance()
    const db = connection.getDatabase(params.env)
    const movements = db.collection('financial_movements')
    const accounts = db.collection('financial_accounts')

    // Varredura FORA da transação: descobrir candidatos é barato e não segura
    // lock. Os documentos daqui servem só como lista de _ids — o estado deles
    // pode estar velho no instante em que a transação abrir.
    const candidates = await movements.find(dueFilter(now), { projection: { _id: 1 } }).toArray()

    let settled = 0
    let failed = 0

    for (const candidate of candidates) {
      const session = connection.getClient().startSession()
      try {
        let applied = false
        await session.withTransaction(async () => {
          applied = false // withTransaction pode reexecutar o callback (retry)

          // RELEITURA dentro da sessão, reaplicando os MESMOS critérios da
          // varredura. Usar o documento da varredura seria um bug de saldo: se o
          // dono editou o valor bruto no meio do caminho, a reversão do impacto
          // antigo usaria valores velhos e a conta ficaria com drift silencioso.
          const movement = await movements.findOne({ _id: candidate._id, ...dueFilter(now) }, { session })

          // Não casa mais (o dono mexeu, ou outra rodada já liquidou): pula em
          // silêncio. Não é falha — é a concorrência funcionando como deveria.
          if (!movement) return

          await applyStatusTransition({
            movements,
            accounts,
            movement,
            newStatus: MovementStatus.Settled,
            actor: 'system',
            statusSource: MovementStatusSource.Auto,
            session,
            now,
          })
          applied = true
        })
        if (applied) settled++
      } catch (error) {
        // Um movimento que falha (conta apagada, corrida com o dono) não pode
        // abortar a rodada dos outros. Loga e segue; o próximo run tenta de novo.
        failed++
        console.error(`[settler] falha ao liquidar ${String(candidate._id)} (env=${params.env}):`, error)
      } finally {
        await session.endSession()
      }
    }

    return { settled, failed }
  }
}
