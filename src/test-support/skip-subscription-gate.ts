import { vi } from 'vitest'

/**
 * Só para os testes de integração que NÃO são sobre assinatura: troca o portão de assinatura por um
 * que deixa passar, para que eles continuem testando contas, categorias, lançamentos etc. sem precisar
 * assinar. É um recurso do teste (módulo substituído pelo vitest), não existe nada parecido no código de
 * produção. O comportamento real do portão é exercitado em `subscription.int.spec.ts`, que desfaz esta
 * substituição com `vi.unmock`.
 */
vi.mock('../core/hooks/require-active-subscription', () => ({
  requireActiveSubscription: async () => undefined,
}))
