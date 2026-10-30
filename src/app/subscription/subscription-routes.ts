import { FastifyInstance } from 'fastify'
import { SubscriptionController } from './subscription-controller'

/**
 * Rotas de /subscription: exigem login (verifyJwt) mas FICAM FORA do portão de assinatura, porque é por
 * elas que a pessoa sem assinatura assina.
 */
export async function subscriptionRoutes (fastify: FastifyInstance) {
  const controller = new SubscriptionController()

  // GET /subscription — estado (ativa/vencida/nenhuma), tipo, data limite, dias que faltam, tipos com seus planos e provedor.
  fastify.get('/', async (request, reply) => controller.overview(request, reply))

  // POST /subscription/checkout — body: { months: 1|3|6|12, tier?: "basic"|"pro" } -> { paymentId, checkoutUrl, … }
  fastify.post('/checkout', async (request, reply) => controller.checkout(request, reply))

  // POST /subscription/mock/decide — body: { paymentId, decision } — só com PAYMENT_PROVIDER=mock (senão 404).
  fastify.post('/mock/decide', async (request, reply) => controller.mockDecide(request, reply))
}

/** Rotas de administração: PÚBLICAS (sem JWT), protegidas pela chave ADMIN_API_KEY. Ver GiftSubscriptionUseCase. */
export async function adminRoutes (fastify: FastifyInstance) {
  const controller = new SubscriptionController()
  // POST /admin/subscription-gift — body: { email } -> acesso até amanhã (agora + 24h), só se a conta não tiver mais que isso.
  fastify.post('/subscription-gift', async (request, reply) => controller.gift(request, reply))
}

/** Webhooks dos provedores de pagamento: PÚBLICOS (sem JWT). Ver SubscriptionController.mercadoPagoWebhook. */
export async function webhookRoutes (fastify: FastifyInstance) {
  const controller = new SubscriptionController()
  fastify.post('/mercadopago', async (request, reply) => controller.mercadoPagoWebhook(request, reply))
}
