import Anthropic from '@anthropic-ai/sdk'
import { AiUnavailableError } from './ai-errors'
import { AI_MODEL } from './ai-prompts'

export interface GenerateInput {
  system: string
  user: string
  /** JSON Schema da resposta (saída estruturada). */
  schema: Record<string, unknown>
  maxTokens?: number
}

/** Quem escreve o texto. Existe para os testes trocarem a IA de verdade por uma falsa. */
export interface TextGenerator {
  /** Devolve o JSON da resposta. Qualquer falha vira `AiUnavailableError` (503). */
  generate (input: GenerateInput): Promise<unknown>
}

/**
 * Cliente do Claude Haiku. Resposta curta (poucas dezenas de palavras), então sem streaming. O Haiku 5.5 pensa por
 * padrão: `effort: 'low'` e folga no `max_tokens` (o pensamento conta nele) evitam respostas cortadas.
 */
export class ClaudeTextGenerator implements TextGenerator {
  constructor (private readonly client: Pick<Anthropic, 'messages'>) {}

  async generate ({ system, user, schema, maxTokens = 1024 }: GenerateInput): Promise<unknown> {
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      })
    } catch (error) {
      // Só o tipo do erro vai para o log: nunca o conteúdo do prompt (dados do restaurante).
      console.error('Falha ao chamar o Claude:', error instanceof Anthropic.APIError ? `${error.status ?? 'sem status'} ${error.name}` : (error as Error).name)
      throw new AiUnavailableError()
    }

    console.info(`[ia] ${AI_MODEL} tokens: entrada=${response.usage.input_tokens} saída=${response.usage.output_tokens} parada=${response.stop_reason}`)
    // Recusa ou resposta cortada: sem texto confiável, o front mantém o texto de sempre.
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new AiUnavailableError()

    const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) throw new AiUnavailableError()
    try {
      return JSON.parse(block.text)
    } catch {
      throw new AiUnavailableError()
    }
  }
}

let override: TextGenerator | null | undefined
let cached: TextGenerator | null | undefined

/** Só para testes: troca a IA (ou, com `null`, simula "sem chave configurada"); `undefined` volta ao normal. */
export function setTextGeneratorForTests (generator: TextGenerator | null | undefined): void {
  override = generator
  cached = undefined
}

/** A IA configurada, ou `null` quando falta `ANTHROPIC_API_KEY` (a rota responde 503 sem gastar nada). */
export function getTextGenerator (): TextGenerator | null {
  if (override !== undefined) return override
  if (cached !== undefined) return cached
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  cached = apiKey ? new ClaudeTextGenerator(new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })) : null
  return cached
}
