/**
 * Referência externa que mandamos ao provedor. Nos pagamentos únicos é só o id do pagamento (o ambiente
 * vai na URL do webhook). Na renovação automática as cobranças seguintes chegam num webhook configurado
 * no painel do provedor, sem o ambiente: por isso a referência da assinatura leva o ambiente junto
 * ("staging|665f..."), e o aviso é resolvido pelo que o PRÓPRIO provedor devolve ao reconsultarmos.
 */
export function encodeReference (env: string, paymentId: string): string {
  return `${env}|${paymentId}`
}

export function decodeReference (reference: string | undefined): { env?: string, id: string } {
  const value = reference ?? ''
  const at = value.indexOf('|')
  if (at < 0) return { id: value }
  return { env: value.slice(0, at) || undefined, id: value.slice(at + 1) }
}
