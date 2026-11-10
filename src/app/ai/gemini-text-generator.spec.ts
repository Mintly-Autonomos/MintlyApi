import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiUnavailableError } from './ai-errors'
import { GEMINI_DEFAULT_BASE_URL, GEMINI_DEFAULT_MODEL, GeminiTextGenerator } from './gemini-text-generator'
import { ClaudeTextGenerator, createTextGenerator, getTextGenerator, setTextGeneratorForTests } from './text-generator'

const entrada = { system: 'sistema', user: 'usuário', schema: { type: 'object', properties: { a: { type: 'number' } } } }

const ok = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
    ...over,
  }),
})
const falha = (status: number) => ({ ok: false, status, json: async () => ({}) })

describe('GeminiTextGenerator', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  const gerador = (fetchFn: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) =>
    new GeminiTextGenerator({ apiKey: 'chave-secreta', fetchFn: fetchFn as unknown as typeof fetch, retryDelayMs: 0, ...extra })

  it('chama o endereço padrão com o modelo padrão, chave no cabeçalho e JSON pelo esquema', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok())
    const out = await gerador(fetchFn).generate(entrada)

    expect(out).toEqual({ a: 1 })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`${GEMINI_DEFAULT_BASE_URL}/models/${GEMINI_DEFAULT_MODEL}:generateContent`)
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.5-flash-lite')
    expect(url).not.toContain('chave-secreta') // a chave nunca vai na URL (URL aparece em log)
    expect(init.headers['x-goog-api-key']).toBe('chave-secreta')
    const body = JSON.parse(init.body)
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sistema' }] })
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'usuário' }] }])
    expect(body.generationConfig).toEqual({ maxOutputTokens: 2048, responseMimeType: 'application/json', responseJsonSchema: entrada.schema })
  })

  it('aceita endereço, modelo (com ou sem "models/") e nível de pensamento próprios; tira a barra final do endereço', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok())
    await gerador(fetchFn, { baseUrl: 'https://meu-gateway.exemplo/v1beta//', model: 'models/gemini-3.8-flash', thinkingLevel: 'LOW' }).generate({ ...entrada, maxTokens: 4000 })

    expect(fetchFn.mock.calls[0][0]).toBe('https://meu-gateway.exemplo/v1beta/models/gemini-3.8-flash:generateContent')
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).generationConfig).toMatchObject({ maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'LOW' } })
  })

  it('ignora partes de pensamento e junta o texto da resposta', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'raciocínio', thought: true }, { text: '{"a":' }, { text: '2}' }] } }] }))
    expect(await gerador(fetchFn).generate(entrada)).toEqual({ a: 2 })
  })

  it('repete uma vez em 429/5xx e usa a segunda resposta', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(falha(503)).mockResolvedValueOnce(ok())
    expect(await gerador(fetchFn).generate(entrada)).toEqual({ a: 1 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('não repete em erro do cliente (400/403) e vira AiUnavailableError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(falha(403))
    await expect(gerador(fetchFn).generate(entrada)).rejects.toBeInstanceOf(AiUnavailableError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['falha de rede nas duas tentativas', () => vi.fn().mockRejectedValue(new Error('rede caiu'))],
    ['erro do servidor nas duas tentativas', () => vi.fn().mockResolvedValue(falha(500))],
    ['pedido bloqueado', () => vi.fn().mockResolvedValue(ok({ promptFeedback: { blockReason: 'SAFETY' }, candidates: undefined }))],
    ['resposta cortada (MAX_TOKENS)', () => vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }] }))],
    ['recusa por segurança (SAFETY)', () => vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'SAFETY' }] }))],
    ['sem candidatos', () => vi.fn().mockResolvedValue(ok({ candidates: [] }))],
    ['sem texto', () => vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }))],
    ['JSON inválido', () => vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'não é json' }] } }] }))],
  ])('%s vira AiUnavailableError (503)', async (_nome, criar) => {
    await expect(gerador(criar()).generate(entrada)).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('o log de erro não vaza o prompt nem a chave', async () => {
    const erro = vi.spyOn(console, 'error')
    const fetchFn = vi.fn().mockRejectedValue(new Error('falhou com SEGREDO-DO-RESTAURANTE e chave-secreta'))
    await gerador(fetchFn).generate({ ...entrada, user: 'SEGREDO-DO-RESTAURANTE' }).catch(() => null)
    const logado = JSON.stringify(erro.mock.calls)
    expect(logado).not.toContain('SEGREDO-DO-RESTAURANTE')
    expect(logado).not.toContain('chave-secreta')
  })
})

describe('createTextGenerator (AI_PROVIDER)', () => {
  it('sem AI_PROVIDER vale o Claude, como sempre foi', () => {
    expect(createTextGenerator({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBeInstanceOf(ClaudeTextGenerator)
    expect(createTextGenerator({ AI_PROVIDER: ' Claude ', ANTHROPIC_API_KEY: 'sk-ant-x' })).toBeInstanceOf(ClaudeTextGenerator)
  })

  it('claude sem chave → erro dizendo o que falta; endereço e modelo são opcionais', () => {
    expect(() => createTextGenerator({})).toThrow('AI_PROVIDER=claude exige ANTHROPIC_API_KEY.')
    expect(() => createTextGenerator({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: '  ' })).toThrow('ANTHROPIC_API_KEY')
    expect(createTextGenerator({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://proxy.exemplo', ANTHROPIC_MODEL: 'claude-opus-5-5' })).toBeInstanceOf(ClaudeTextGenerator)
  })

  it('o modelo do Claude vem de ANTHROPIC_MODEL (padrão claude-haiku-5-5)', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await new ClaudeTextGenerator({ messages: { create } } as never, 'claude-sonnet-5-5').generate(entrada)
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5-5')
    vi.restoreAllMocks()
  })

  it('gemini exige GEMINI_API_KEY; com ela funciona só com a chave (endereço e modelo opcionais)', () => {
    expect(() => createTextGenerator({ AI_PROVIDER: 'gemini' })).toThrow('AI_PROVIDER=gemini exige GEMINI_API_KEY.')
    expect(() => createTextGenerator({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk-ant-x' })).toThrow('GEMINI_API_KEY')
    expect(createTextGenerator({ AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'g-key' })).toBeInstanceOf(GeminiTextGenerator)
    expect(createTextGenerator({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g-key', GEMINI_BASE_URL: 'https://gw.exemplo', GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'minimal' })).toBeInstanceOf(GeminiTextGenerator)
  })

  it('nível de pensamento inválido e provedor desconhecido → erro claro', () => {
    expect(() => createTextGenerator({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'extremo' })).toThrow('GEMINI_THINKING_LEVEL inválido')
    expect(() => createTextGenerator({ AI_PROVIDER: 'gpt' })).toThrow('AI_PROVIDER inválido: "gpt". Use "claude" ou "gemini".')
  })
})

describe('getTextGenerator com AI_PROVIDER', () => {
  const guardado = { p: process.env.AI_PROVIDER, g: process.env.GEMINI_API_KEY, a: process.env.ANTHROPIC_API_KEY }
  const restaurar = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  afterEach(() => {
    restaurar('AI_PROVIDER', guardado.p); restaurar('GEMINI_API_KEY', guardado.g); restaurar('ANTHROPIC_API_KEY', guardado.a)
    setTextGeneratorForTests(undefined)
    vi.restoreAllMocks()
  })

  it('AI_PROVIDER=gemini com a chave cria o Gemini; sem a chave a IA fica desligada (503) e o motivo vai para o log', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.AI_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = 'g-key'
    setTextGeneratorForTests(undefined)
    expect(getTextGenerator()).toBeInstanceOf(GeminiTextGenerator)

    delete process.env.GEMINI_API_KEY
    setTextGeneratorForTests(undefined)
    expect(getTextGenerator()).toBeNull()
    expect(erro).toHaveBeenCalledWith('AI_PROVIDER=gemini exige GEMINI_API_KEY.')
  })

  it('sem AI_PROVIDER e sem chave a IA fica desligada em silêncio (o padrão de sempre)', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    delete process.env.AI_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    setTextGeneratorForTests(undefined)
    expect(getTextGenerator()).toBeNull()
    expect(erro).not.toHaveBeenCalled()
  })
})
