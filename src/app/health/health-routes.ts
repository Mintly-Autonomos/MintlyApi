import { FastifyInstance } from 'fastify'

export async function healthRoutes (fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    return { status: 'ok' }
  })
}
