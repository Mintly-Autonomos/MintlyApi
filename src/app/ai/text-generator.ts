import Anthropic from '@anthropic-ai/sdk'
import { AiUnavailableError } from './ai-errors'
import { AI_MODEL } from './ai-prompts'
import { GeminiTextGenerator } from './gemini-text-generator'
import type { GeminiThinkingLevel } from './gemini-text-generator'

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
  constructor (private readonly client: Pick<Anthropic, 'messages'>, private readonly model: string = AI_MODEL) {}

  async generate ({ system, user, schema, maxTokens = 1024 }: GenerateInput): Promise<unknown> {
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: this.model,
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

    console.info(`[ia] ${this.model} tokens: entrada=${response.usage.input_tokens} saída=${response.usage.output_tokens} parada=${response.stop_reason}`)
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

const THINKING_LEVELS: readonly string[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']

/**
 * Escolhe a IA pela variável AI_PROVIDER (`claude` | `gemini`), no mesmo molde do PAYMENT_PROVIDER. Sem a
 * variável vale o Claude (como sempre foi). O endereço de conexão é opcional nos dois (sem ele vale o oficial);
 * a chave é obrigatória no provedor escolhido. Lança Error com o que falta.
 *
 *  claude: ANTHROPIC_API_KEY (obrigatória) · ANTHROPIC_BASE_URL · ANTHROPIC_MODEL (padrão claude-haiku-5-5)
 *  gemini: GEMINI_API_KEY (obrigatória) · GEMINI_BASE_URL · GEMINI_MODEL · GEMINI_THINKING_LEVEL (minimal|low|medium|high)
 */
export function createTextGenerator (env: Record<string, string | undefined> = process.env): TextGenerator {
  const chosen = env.AI_PROVIDER?.trim().toLowerCase() || 'claude'

  if (chosen === 'claude') {
    const apiKey = env.ANTHROPIC_API_KEY?.trim()
    if (!apiKey) throw new Error('AI_PROVIDER=claude exige ANTHROPIC_API_KEY.')
    const baseURL = env.ANTHROPIC_BASE_URL?.trim() || undefined
    return new ClaudeTextGenerator(new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 20_000, maxRetries: 1 }), env.ANTHROPIC_MODEL?.trim() || AI_MODEL)
  }

  if (chosen === 'gemini') {
    const apiKey = env.GEMINI_API_KEY?.trim()
    if (!apiKey) throw new Error('AI_PROVIDER=gemini exige GEMINI_API_KEY.')
    const level = env.GEMINI_THINKING_LEVEL?.trim().toUpperCase()
    if (level && !THINKING_LEVELS.includes(level)) throw new Error(`GEMINI_THINKING_LEVEL inválido: "${level.toLowerCase()}". Use minimal, low, medium ou high.`)
    return new GeminiTextGenerator({
      apiKey,
      model: env.GEMINI_MODEL,
      baseUrl: env.GEMINI_BASE_URL,
      ...(level ? { thinkingLevel: level as GeminiThinkingLevel } : {}),
    })
  }

  throw new Error(`AI_PROVIDER inválido: "${chosen}". Use "claude" ou "gemini".`)
}

/** A IA configurada, ou `null` quando falta configuração (a rota responde 503 sem gastar nada; o motivo vai para o log). */
export function getTextGenerator (): TextGenerator | null {
  if (override !== undefined) return override
  if (cached !== undefined) return cached
  try {
    cached = createTextGenerator()
  } catch (error) {
    // Sem AI_PROVIDER e sem chave é só "IA desligada" (o padrão de sempre): sem barulho. Escolheu e errou: avisa.
    if (process.env.AI_PROVIDER?.trim()) console.error((error as Error).message)
    cached = null
  }
  return cached
}
