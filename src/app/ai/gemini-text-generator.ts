import { AiUnavailableError } from './ai-errors'
import type { GenerateInput, TextGenerator } from './text-generator'

/** Endereço padrão da API do Gemini (Google AI Studio). Sobrescreva com GEMINI_BASE_URL (proxy, gateway). */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
/** Modelo padrão: o mais barato e rápido da linha estável. Sobrescreva com GEMINI_MODEL. */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'

export type GeminiThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface GeminiOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  /** Só para modelos Gemini 3 ou mais novos (em modelos antigos a API recusa). Sem isto vale o padrão do modelo. */
  thinkingLevel?: GeminiThinkingLevel
  timeoutMs?: number
  /** Troca o `fetch` (testes). */
  fetchFn?: typeof fetch
  /** Espera entre a tentativa e a repetição, em ms (testes usam 0). */
  retryDelayMs?: number
}

interface GeminiResponse {
  candidates?: Array<{ finishReason?: string, content?: { parts?: Array<{ text?: string, thought?: boolean }> } }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number, candidatesTokenCount?: number, thoughtsTokenCount?: number }
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

/**
 * Cliente do Gemini (generateContent), sem SDK. Resposta curta em JSON pelo esquema (`responseJsonSchema`).
 * Os modelos Gemini 3 pensam por padrão e o pensamento conta no `maxOutputTokens`, então o limite tem folga
 * (mínimo de 2048). A chave vai no cabeçalho `x-goog-api-key`, nunca na URL (URL aparece em log).
 */
export class GeminiTextGenerator implements TextGenerator {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly thinkingLevel?: GeminiThinkingLevel
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch
  private readonly retryDelayMs: number

  constructor (options: GeminiOptions) {
    this.apiKey = options.apiKey
    this.model = (options.model?.trim() || GEMINI_DEFAULT_MODEL).replace(/^models\//, '')
    this.baseUrl = (options.baseUrl?.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.thinkingLevel = options.thinkingLevel
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetchFn = options.fetchFn ?? fetch
    this.retryDelayMs = options.retryDelayMs ?? 400
  }

  async generate ({ system, user, schema, maxTokens = 1024 }: GenerateInput): Promise<unknown> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: Math.max(maxTokens, 2048),
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        ...(this.thinkingLevel ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } } : {}),
      },
    }

    const data = await this.post(body)

    if (data.promptFeedback?.blockReason) throw this.unavailable(`bloqueado (${data.promptFeedback.blockReason})`)
    const candidate = data.candidates?.[0]
    const usage = data.usageMetadata
    console.info(`[ia] ${this.model} tokens: entrada=${usage?.promptTokenCount ?? '?'} saída=${usage?.candidatesTokenCount ?? '?'} pensamento=${usage?.thoughtsTokenCount ?? 0} parada=${candidate?.finishReason ?? '?'}`)
    // Bloqueio, recusa ou resposta cortada: sem texto confiável, o front mantém o texto de sempre.
    if (!candidate || candidate.finishReason !== 'STOP') throw this.unavailable(`parada ${candidate?.finishReason ?? 'sem resposta'}`)

    const text = (candidate.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
    if (!text) throw this.unavailable('sem texto')
    try {
      return JSON.parse(text)
    } catch {
      throw this.unavailable('JSON inválido')
    }
  }

  /** Uma tentativa extra para limite de uso (429), erro do servidor e falha de rede. */
  private async post (body: unknown): Promise<GeminiResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`
    let lastStatus = 'sem status'
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && this.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs))
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (res.ok) return await res.json() as GeminiResponse
        lastStatus = String(res.status)
        if (!RETRY_STATUS.has(res.status)) break
      } catch (error) {
        lastStatus = (error as Error).name
      }
    }
    throw this.unavailable(`chamada falhou (${lastStatus})`)
  }

  /** Só o motivo vai para o log: nunca o conteúdo do prompt (dados do restaurante) nem a chave. */
  private unavailable (reason: string): AiUnavailableError {
    console.error(`Falha ao chamar o Gemini: ${reason}`)
    return new AiUnavailableError()
  }
}
