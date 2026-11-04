import { AI_MAX_PRICE_INCREASE_PERCENT, AI_PRICE_REASON_MAX_WORDS, aiPriceSuggestionRequestSchema } from 'mintly-lib'
import type { AiPriceSuggestion, MenuItem } from 'mintly-lib'
import { RequestContext } from '../../core/context/request-context'
import { NotFoundError } from '../../core/errors/core/not-found-error'
import { ValidationError } from '../../core/errors/core/validation-error'
import { Resource } from '../../core/types/resource'
import { MenuItemRepository } from '../menu-item/menu-item-repository'
import { daysSince } from '../menu-item/menu-item-rules'
import { AiUnavailableError } from './ai-errors'
import { AI_SYSTEM_PROMPT, PRICE_SCHEMA, buildPricePrompt } from './ai-prompts'
import { AiRepository } from './ai-repository'
import { cleanAiText, countWords, roundMoney, sanitizeFact, stableHash, trimToWords } from './ai-text-rules'
import { TextGenerator, getTextGenerator } from './text-generator'

type PriceResult = Omit<AiPriceSuggestion, 'limitPerDay' | 'usedToday' | 'remainingToday' | 'cached'>

const round4 = (value: number) => Math.round(value * 10_000) / 10_000

/** Margem do prato em 0 a 1 (`(preço − custo) / preço`); `null` sem preço. */
const margin = (dish: MenuItem): number | null => (dish.price > 0 ? round4((dish.price - (dish.cost ?? 0)) / dish.price) : null)

/** Texto de apoio quando a IA não entrega uma justificativa utilizável: a sugestão em si continua valendo. */
function fallbackReason (name: string, days: number): string {
  const months = Math.floor(days / 30)
  const tempo = months >= 1 ? `há ${months} ${months === 1 ? 'mês' : 'meses'}` : `há ${days} dias`
  return `O preço de ${name} não muda ${tempo}. Um ajuste pequeno ajuda a acompanhar o aumento dos custos sem pesar muito no bolso de quem já pede o prato.`
}

/**
 * POST /ai/price-suggestion — sugere o aumento ideal do preço de um prato. Sem `menuItemId`, escolhe o prato
 * ativo há mais tempo sem mudar de preço. O cliente não manda preço nem dados: tudo vem do banco, pelo token. O
 * valor sugerido é SEMPRE conferido aqui: nunca abaixo do atual e nunca acima de `AI_MAX_PRICE_INCREASE_PERCENT`%.
 */
export class AiPriceSuggestionUseCase {
  constructor (
    private readonly menu: MenuItemRepository = new MenuItemRepository(),
    private readonly repo: AiRepository = new AiRepository(),
    private readonly generator: () => TextGenerator | null = getTextGenerator,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute (ctx: RequestContext, rawBody: unknown): Promise<AiPriceSuggestion> {
    const { menuItemId } = aiPriceSuggestionRequestSchema.parse(rawBody ?? {})
    const generator = this.generator()
    if (!generator) throw new AiUnavailableError('A IA ainda não está configurada neste ambiente.')

    const now = this.clock()
    const dishes = await this.menu.findActive(ctx) // já vem do mais antigo (preço sem mudar) para o mais novo
    if (dishes.length === 0) throw new ValidationError('Cadastre pelo menos um prato no cardápio para receber uma sugestão de preço.')
    const dish = menuItemId ? dishes.find((d) => String((d as { _id?: unknown })._id) === menuItemId) : dishes[0]
    if (!dish) throw new NotFoundError(Resource.MenuItem, menuItemId ?? '')
    if (!(dish.price > 0)) throw new ValidationError('Informe o preço atual do prato para receber uma sugestão.')

    const id = String((dish as { _id?: unknown })._id)
    const days = daysSince(dish.priceUpdatedAt, now)
    const facts = this.buildFacts(dish, dishes, days, now)
    const hash = stableHash(facts)

    const cached = await this.repo.cacheGet<PriceResult>(ctx, 'price-suggestion', hash, now)
    if (cached) return { ...cached, cached: true, ...(await this.repo.usage(ctx, now)) }

    const usage = await this.repo.reserve(ctx, now)
    let raw: unknown
    try {
      raw = await generator.generate({ system: AI_SYSTEM_PROMPT, user: buildPricePrompt(facts), schema: PRICE_SCHEMA })
    } catch (error) {
      await this.repo.release(ctx, now)
      throw error
    }

    const result = this.validate(raw, dish, id, days)
    await this.repo.cacheSet(ctx, 'price-suggestion', hash, result, now)
    return { ...result, cached: false, ...usage }
  }

  private buildFacts (dish: MenuItem, dishes: MenuItem[], days: number, now: Date) {
    const margins = dishes.map(margin).filter((m): m is number => m != null)
    const sameCategory = dishes.filter((d) => d !== dish && (d.category ?? '') === (dish.category ?? '') && d.price > 0)
    return {
      dish: {
        name: sanitizeFact(dish.name),
        category: sanitizeFact(dish.category ?? ''),
        price: dish.price,
        cost: dish.cost ?? 0,
        marginPct: margin(dish),
        soldPerMonth: dish.soldPerMonth ?? 0,
        daysSincePriceChange: days,
        daysSinceReview: daysSince(dish.priceReviewedAt, now),
      },
      menu: {
        activeDishes: dishes.length,
        averageMarginPct: margins.length > 0 ? round4(margins.reduce((a, b) => a + b, 0) / margins.length) : null,
        sameCategory: sameCategory.length > 0
          ? { dishes: sameCategory.length, averagePrice: roundMoney(sameCategory.reduce((a, d) => a + d.price, 0) / sameCategory.length) }
          : null,
      },
    }
  }

  /** O que a IA propôs, conferido: preço entre o atual e o teto; justificativa só texto, sem `%`/`R$` e dentro do limite. */
  private validate (raw: unknown, dish: MenuItem, id: string, days: number): PriceResult {
    const proposed = Number((raw as { suggestedPrice?: unknown } | null)?.suggestedPrice)
    const ceiling = roundMoney(dish.price * (1 + AI_MAX_PRICE_INCREASE_PERCENT / 100))
    const suggestedPrice = roundMoney(Math.min(Math.max(Number.isFinite(proposed) ? proposed : dish.price, dish.price), ceiling))
    const increasePercent = Math.round((suggestedPrice / dish.price - 1) * 1000) / 10

    const text = cleanAiText((raw as { reason?: unknown } | null)?.reason)
    // A tela mostra o preço e o percentual: a justificativa não pode citar números diferentes dos que foram aplicados.
    const usable = text != null && !/%|R\$/.test(text)
    const reason = usable ? trimToWords(text, AI_PRICE_REASON_MAX_WORDS) : fallbackReason(sanitizeFact(dish.name), days)
    return {
      menuItemId: id,
      name: dish.name,
      currentPrice: dish.price,
      suggestedPrice,
      increasePercent,
      reason: countWords(reason) > 0 ? reason : fallbackReason(sanitizeFact(dish.name), days),
    }
  }
}
