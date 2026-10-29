import { FastifyInstance } from 'fastify'
import { SubscriptionController } from './subscription-controller'

/**
 * Rotas de /subscription: exigem login (verifyJwt) mas FICAM FORA do portão de assinatura, porque é por
 * elas que a pessoa sem assinatura assina.
 */
export async function subscriptionRoutes (fastify: FastifyInstance) {
  const controller = new SubscriptionController()

  // GET /subscription — estado (ativa/vencida/nenhuma), data limite, dias que faltam, planos e provedor.
  fastify.get('/', async (request, reply) => controller.overview(request, reply))

  // POST /subscription/checkout — body: { months: 1|3|6|12 } -> { paymentId, checkoutUrl, … }
  fastify.post('/checkout', async (request, reply) => controller.checkout(request, reply))

  // POST /subscription/mock/decide — body: { paymentId, decision } — só com PAYMENT_PROVIDER=mock (senão 404).
  fastify.post('/mock/decide', async (request, reply) => controller.mockDecide(request, reply))
}

/** Webhooks dos provedores de pagamento: PÚBLICOS (sem JWT). Ver SubscriptionController.mercadoPagoWebhook. */
export async function webhookRoutes (fastify: FastifyInstance) {
  const controller = new SubscriptionController()
  fastify.post('/mercadopago', async (request, reply) => controller.mercadoPagoWebhook(request, reply))
}
