import { describe, it, expect } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { registerSchema, throwFieldError } from './register-schema'

const VALID: Record<string, unknown> = {
  nome: 'João Silva',
  email: 'joao@restaurante.com',
  senha: 'Senha123',
  confirmarSenha: 'Senha123',
  nomeRestaurante: 'Restaurante do João',
  aceitouTermos: true,
  aceitouPrivacidade: true,
}

function fieldErrors (input: Record<string, unknown>): Record<string, string[]> {
  const result = registerSchema.safeParse(input)
  if (result.success) return {}
  return result.error.flatten().fieldErrors
}

// ─── Schema ───────────────────────────────────────────────────────────────────

describe('registerSchema', () => {
  describe('entrada válida', () => {
    it('aceita todos os campos corretos', () => {
      expect(registerSchema.safeParse(VALID).success).toBe(true)
    })

    it('retorna os valores parseados corretamente', () => {
      const result = registerSchema.safeParse(VALID)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.nome).toBe('João Silva')
        expect(result.data.email).toBe('joao@restaurante.com')
        expect(result.data.aceitouTermos).toBe(true)
        expect(result.data.aceitouPrivacidade).toBe(true)
      }
    })
  })

  // ── nome ──────────────────────────────────────────────────────────────────

  describe('nome', () => {
    it('rejeita nome ausente', () => {
      const { nome, ...rest } = VALID
      expect(fieldErrors(rest).nome).toBeDefined()
    })

    it('rejeita nome com 1 caractere', () => {
      expect(fieldErrors({ ...VALID, nome: 'J' }).nome).toBeDefined()
    })

    it('aceita nome com 2 caracteres', () => {
      expect(fieldErrors({ ...VALID, nome: 'Jo' }).nome).toBeUndefined()
    })
  })

  // ── email ─────────────────────────────────────────────────────────────────

  describe('email', () => {
    it('rejeita e-mail ausente', () => {
      const { email, ...rest } = VALID
      expect(fieldErrors(rest).email).toBeDefined()
    })

    it('rejeita e-mail sem @', () => {
      expect(fieldErrors({ ...VALID, email: 'invalido' }).email).toBeDefined()
    })

    it('rejeita e-mail sem domínio', () => {
      expect(fieldErrors({ ...VALID, email: 'joao@' }).email).toBeDefined()
    })

    it('rejeita e-mail sem TLD', () => {
      expect(fieldErrors({ ...VALID, email: 'joao@restaurante' }).email).toBeDefined()
    })

    it('aceita e-mail válido com subdomínio', () => {
      expect(fieldErrors({ ...VALID, email: 'joao@sub.restaurante.com' }).email).toBeUndefined()
    })
  })

  // ── senha ─────────────────────────────────────────────────────────────────

  describe('senha', () => {
    it('rejeita senha ausente', () => {
      const { senha, ...rest } = VALID
      expect(fieldErrors(rest).senha).toBeDefined()
    })

    it('rejeita senha com menos de 8 caracteres', () => {
      expect(fieldErrors({ ...VALID, senha: 'Ab1' }).senha).toBeDefined()
    })

    it('rejeita senha sem letra maiúscula', () => {
      expect(fieldErrors({ ...VALID, senha: 'senha123' }).senha).toBeDefined()
    })

    it('rejeita senha sem letra minúscula', () => {
      expect(fieldErrors({ ...VALID, senha: 'SENHA123' }).senha).toBeDefined()
    })

    it('rejeita senha sem número', () => {
      expect(fieldErrors({ ...VALID, senha: 'SenhaForte' }).senha).toBeDefined()
    })

    it('aceita senha com exatamente 8 chars, maiúscula, minúscula e número', () => {
      expect(fieldErrors({ ...VALID, senha: 'Abcdef1!' }).senha).toBeUndefined()
    })
  })

  // ── confirmarSenha ────────────────────────────────────────────────────────

  describe('confirmarSenha', () => {
    it('rejeita confirmarSenha ausente', () => {
      const { confirmarSenha, ...rest } = VALID
      expect(fieldErrors(rest).confirmarSenha).toBeDefined()
    })
  })

  // ── nomeRestaurante ───────────────────────────────────────────────────────

  describe('nomeRestaurante', () => {
    it('rejeita nomeRestaurante ausente', () => {
      const { nomeRestaurante, ...rest } = VALID
      expect(fieldErrors(rest).nomeRestaurante).toBeDefined()
    })

    it('rejeita nomeRestaurante com 1 caractere', () => {
      expect(fieldErrors({ ...VALID, nomeRestaurante: 'R' }).nomeRestaurante).toBeDefined()
    })

    it('aceita nomeRestaurante com 2 caracteres', () => {
      expect(fieldErrors({ ...VALID, nomeRestaurante: 'RG' }).nomeRestaurante).toBeUndefined()
    })
  })

  // ── aceites ───────────────────────────────────────────────────────────────

  describe('aceitouTermos / aceitouPrivacidade', () => {
    it('rejeita aceitouTermos ausente', () => {
      const { aceitouTermos, ...rest } = VALID
      expect(fieldErrors(rest).aceitouTermos).toBeDefined()
    })

    it('rejeita aceitouPrivacidade ausente', () => {
      const { aceitouPrivacidade, ...rest } = VALID
      expect(fieldErrors(rest).aceitouPrivacidade).toBeDefined()
    })

    it('aceita aceitouTermos = false (validação de negócio fica no use case)', () => {
      // o schema só verifica o tipo; a regra "deve ser true" é do use case
      expect(fieldErrors({ ...VALID, aceitouTermos: false }).aceitouTermos).toBeUndefined()
    })
  })
})

// ─── throwFieldError ─────────────────────────────────────────────────────────

describe('throwFieldError', () => {
  it('lança SapphireValidationError', () => {
    expect(() => throwFieldError('confirmarSenha', 'As senhas não conferem.')).toThrow(SapphireValidationError)
  })

  it('inclui o campo correto no path do erro', () => {
    try {
      throwFieldError('confirmarSenha', 'As senhas não conferem.')
    } catch (e) {
      expect(e).toBeInstanceOf(SapphireValidationError)
      const err = e as SapphireValidationError
      expect(err.issues[0].path).toEqual(['confirmarSenha'])
    }
  })

  it('inclui a mensagem correta', () => {
    try {
      throwFieldError('aceitouTermos', 'Deve aceitar os termos.')
    } catch (e) {
      const err = e as SapphireValidationError
      expect(err.issues[0].message).toBe('Deve aceitar os termos.')
    }
  })

  it('flatten() expõe o erro no campo correto', () => {
    try {
      throwFieldError('email', 'E-mail inválido.')
    } catch (e) {
      const err = e as SapphireValidationError
      expect(err.flatten().fieldErrors.email).toContain('E-mail inválido.')
    }
  })
})
