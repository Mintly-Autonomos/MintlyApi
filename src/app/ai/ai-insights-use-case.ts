import { ObjectId } from 'mongodb'
import { AI_INSIGHT_MAX_WORDS, aiInsightsRequestSchema } from 'mintly-lib'
import type { AiInsightText, AiInsightsResponse, OverviewInsight, OverviewReport } from 'mintly-lib'
import MongoDBConnection from '../../infrastructure/db/mongodb/mongodb-connection'
import { RequestContext } from '../../core/context/request-context'
import { requireTenant } from '../../core/context/require-tenant'
import { OverviewQuery } from '../dashboard/use-cases/overview.query'
import { AiUnavailableError } from './ai-errors'
import { AI_INSIGHT_TITLE_MAX_WORDS, AI_SYSTEM_PROMPT, INSIGHTS_SCHEMA, buildInsightsPrompt } from './ai-prompts'
import { AiRepository } from './ai-repository'
import { cleanAiText, countWords, roundMoney, sanitizeFact, stableHash } from './ai-text-rules'
import { TextGenerator, getTextGenerator } from './text-generator'

/** Números e textos de um insight, no formato que vai para a IA (texto de gente já higienizado). */
function insightFacts (insight: OverviewInsight, index: number): Record<string, unknown> {
  const facts: Record<string, unknown> = { index }
  for (const [key, value] of Object.entries(insight)) {
    if (typeof value === 'number') facts[key] = Math.round(value * 10_000) / 10_000
    else if (typeof value === 'string') facts[key] = sanitizeFact(value)
  }
  return facts
}

/**
 * POST /ai/insights — reescreve o título e a descrição dos insights da Visão Geral para este restaurante.
 * Os dados vêm do próprio relatório (montado aqui, pelo token): o cliente só diz a tela e o mês. Texto igual para
 * os mesmos dados no mesmo dia vem do cache e não gasta chamada. Falha da IA devolve a chamada ao limite.
 */
export class AiInsightsUseCase {
  constructor (
    private readonly overview: OverviewQuery = new OverviewQuery(),
    private readonly repo: AiRepository = new AiRepository(),
    private readonly generator: () => TextGenerator | null = getTextGenerator,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, rawBody: unknown): Promise<AiInsightsResponse> {
    const { page, month } = aiInsightsRequestSchema.parse(rawBody ?? {})
    const generator = this.generator()
    if (!generator) throw new AiUnavailableError('A IA ainda não está configurada neste ambiente.')

    const now = this.clock()
    const report = await this.overview.execute(ctx, month) // mês inválido ou futuro: 400 vindo da própria consulta
    if (report.insights.length === 0) return { page, insights: [], cached: false, ...(await this.repo.usage(ctx, now)) }

    const facts = await this.buildFacts(ctx, report)
    const hash = stableHash(facts)

    const cached = await this.repo.cacheGet<AiInsightText[]>(ctx, `insights-${page}`, hash, now)
    if (cached) return { page, insights: cached, cached: true, ...(await this.repo.usage(ctx, now)) }

    const usage = await this.repo.reserve(ctx, now)
    let raw: unknown
    try {
      raw = await generator.generate({ system: AI_SYSTEM_PROMPT, user: buildInsightsPrompt(facts), schema: INSIGHTS_SCHEMA })
    } catch (error) {
      await this.repo.release(ctx, now)
      throw error
    }

    const insights = this.validate(raw, report.insights)
    if (insights.length === 0) {
      // Nada aproveitável (fora do limite de palavras, com marcas proibidas...): a chamada não conta e a tela fica com o texto de sempre.
      await this.repo.release(ctx, now)
      return { page, insights: [], cached: false, ...(await this.repo.usage(ctx, now)) }
    }
    await this.repo.cacheSet(ctx, `insights-${page}`, hash, insights, now)
    return { page, insights, cached: false, ...usage }
  }

  private async buildFacts (ctx: RequestContext, report: OverviewReport) {
    const { restaurantId } = requireTenant(ctx)
    const restaurant = ObjectId.isValid(restaurantId)
      ? await MongoDBConnection.getInstance().getDatabase(ctx.env).collection('restaurants').findOne({ _id: new ObjectId(restaurantId) }, { projection: { name: 1 } })
      : null
    return {
      restaurantName: sanitizeFact(restaurant?.name),
      month: report.referenceMonth,
      revenue: roundMoney(report.cards.revenue.amount),
      netProfit: roundMoney(report.cards.netProfit.amount),
      healthScore: report.health.score,
      healthLabel: sanitizeFact(report.health.label),
      insights: report.insights.map((insight, index) => insightFacts(insight, index)),
    }
  }

  /** Confere cada texto: índice válido e único, só texto simples, título e card dentro do limite de palavras. */
  private validate (raw: unknown, insights: OverviewInsight[]): AiInsightText[] {
    const texts = (raw as { texts?: unknown } | null)?.texts
    if (!Array.isArray(texts)) return []
    const seen = new Set<number>()
    const valid: AiInsightText[] = []
    for (const item of texts as Array<Record<string, unknown> | null>) {
      const index = item?.index
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= insights.length || seen.has(index)) continue
      const title = cleanAiText(item?.title)
      const description = cleanAiText(item?.description)
      if (!title || !description) continue
      const titleWords = countWords(title)
      if (titleWords > AI_INSIGHT_TITLE_MAX_WORDS || titleWords + countWords(description) > AI_INSIGHT_MAX_WORDS) continue
      seen.add(index)
      valid.push({ index, kind: insights[index].kind, title, description })
    }
    return valid.sort((a, b) => a.index - b.index)
  }
}
