import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password-hash'

describe('password-hash', () => {
  it('hashPassword gera formato salt:hash e verifyPassword casa a senha certa', () => {
    const stored = hashPassword('Senha123')
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(verifyPassword('Senha123', stored)).toBe(true)
  })

  it('verifyPassword rejeita senha errada', () => {
    const stored = hashPassword('Senha123')
    expect(verifyPassword('Errada1', stored)).toBe(false)
  })

  it('hashes do mesmo texto diferem (salt aleatório)', () => {
    expect(hashPassword('Senha123')).not.toBe(hashPassword('Senha123'))
  })

  it('verifyPassword devolve false (sem RangeError) p/ hash sem separador', () => {
    expect(verifyPassword('Senha123', 'semseparador')).toBe(false)
  })

  it('verifyPassword devolve false (sem RangeError) p/ hash de tamanho errado/corrompido', () => {
    // hash com tamanho diferente de 64 bytes → timingSafeEqual lançaria RangeError.
    expect(verifyPassword('Senha123', 'abcd:deadbeef')).toBe(false)
  })

  it('verifyPassword devolve false p/ stored vazio/nulo', () => {
    expect(verifyPassword('Senha123', '')).toBe(false)
    expect(verifyPassword('Senha123', undefined as any)).toBe(false)
  })
})
