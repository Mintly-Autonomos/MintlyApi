import { FinancialAccountType, MovementChannel, MovementDirection, PlatformKind } from 'mintly-lib'

/**
 * Canal efetivo (M3, S5): o informado pelo dono, ou o padrão — entrada em conta
 * plataforma é delivery (menos maquininha, S3.3, que é salão); outra entrada é salão; saída é da casa
 * inteira (shared).
 * Resolvido na leitura: dado antigo fica legível sem backfill, e a regra muda num
 * lugar só. Consumido pelos relatórios de custo (fatias 6 e 7).
 */
export function effectiveChannel (m: { direction: MovementDirection | string; account: { type: string; platformKind?: string | null }; channel?: MovementChannel | string | null }): MovementChannel {
  if (m.channel != null) return m.channel as MovementChannel
  if (m.direction === MovementDirection.In) {
    const app = m.account.type === FinancialAccountType.Platform && m.account.platformKind !== PlatformKind.CardMachine
    return app ? MovementChannel.Delivery : MovementChannel.DineIn
  }
  return MovementChannel.Shared
}
