import { scryptSync, timingSafeEqual, randomBytes } from 'crypto'

// Fonte única do hashing de senha (antes duplicado em register/recovery/auth).
const KEY_LEN = 64
const SALT_BYTES = 16

/** Gera o hash scrypt no formato `salt:hash` (salt aleatório de 16 bytes). */
export function hashPassword (password: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex')
  return `${salt}:${hash}`
}

/**
 * Compara `password` com um hash `salt:hash` em tempo constante. Retorna `false`
 * (em vez de lançar `RangeError`) quando o hash está malformado/corrompido ou
 * tem tamanho inesperado — `timingSafeEqual` lança se os buffers diferem em
 * tamanho, o que viraria um 500 no login por um dado ruim no banco.
 */
export function verifyPassword (password: string, stored: string): boolean {
  const [salt, hash] = (stored ?? '').split(':')
  if (!salt || !hash) return false
  const storedBuf = Buffer.from(hash, 'hex')
  const incoming = scryptSync(password, salt, KEY_LEN)
  if (storedBuf.length !== incoming.length) return false
  return timingSafeEqual(storedBuf, incoming)
}
