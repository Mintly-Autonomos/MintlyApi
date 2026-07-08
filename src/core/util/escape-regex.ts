/**
 * Escapa metacaracteres de regex para busca literal segura — evita ReDoS e
 * injeção de padrão quando o valor vem do cliente (ex.: busca por nome).
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
