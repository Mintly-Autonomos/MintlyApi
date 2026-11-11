import { createHash } from 'crypto'

/** Palavras de um texto (separadas por espaço). */
export function countWords (text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Marcas que não devem aparecer num texto de card: HTML, markdown, links. */
const FORBIDDEN_MARKS = /[<>`*#[\]{}|\\]|https?:|www\./i
const EMOJI = /\p{Extended_Pictographic}/u

/**
 * Deixa o texto só com símbolos básicos do teclado, mesmo que a IA escorregue: "42 por cento" vira "42%", travessões
 * viram hífen e aspas curvas, reticências em um caractere e espaços especiais viram os comuns.
 */
export function simplifySymbols (text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:por\s?cento|porcento)\b/gi, '$1%')
    .replace(/\s*[\u2012-\u2015\u2212]\s*/g, ' - ')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2007\u202F\u200B]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Texto da IA pronto para a tela: só texto simples, em uma linha. Devolve `null` quando não serve (não é texto,
 * vazio, com HTML/markdown/link/emoji) e o chamador cai no texto pronto. A tela mostra como texto puro (nunca
 * como HTML), então isto é um cinto a mais, não a única defesa.
 */
export function cleanAiText (raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = simplifySymbols(raw.replace(/\s+/g, ' ').trim())
  if (text === '' || FORBIDDEN_MARKS.test(text) || EMOJI.test(text)) return null
  return text
}

/**
 * Dado do negócio (nome de prato, de categoria, de despesa) que vai para o prompt: vem de gente, então perde
 * quebras de linha, caracteres de controle e `<`/`>` (para não fechar o bloco de dados) e tem tamanho máximo.
 */
export function sanitizeFact (value: unknown, max = 80): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Dia no fuso de São Paulo, `AAAA-MM-DD`: a virada do limite diário acontece à meia-noite do restaurante. */
export function dayKey (now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function sortKeys (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]))
  }
  return value
}

/** Hash estável (independe da ordem das chaves) dos dados que a IA leu: mesmos dados, mesma chave de cache. */
export function stableHash (value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex').slice(0, 32)
}

/** Reais com 2 casas, sem ponto flutuante sobrando. */
export function roundMoney (value: number): number {
  return Math.round(value * 100) / 100
}

/** Corta no limite de palavras e, se der, no último ponto final inteiro. Vazio se nada sobrar. */
export function trimToWords (text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= max) return words.join(' ')
  const cut = words.slice(0, max).join(' ')
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'))
  return lastStop > 0 ? cut.slice(0, lastStop + 1) : cut
}
