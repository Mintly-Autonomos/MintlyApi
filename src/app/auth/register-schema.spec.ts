import { describe, it, expect } from 'vitest'
import { SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { registerSchema, throwFieldError } from './register-schema'

const VALID: Record<string, unknown> = {
  name: 'João Silva',
  email: 'joao@restaurante.com',
  password: 'Senha123',
  confirmPassword: 'Senha123',
  restaurantName: 'Restaurante do João',
  acceptedTerms: true,
  acceptedPrivacy: true,
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
        expect(result.data.name).toBe('João Silva')
        expect(result.data.email).toBe('joao@restaurante.com')
        expect(result.data.acceptedTerms).toBe(true)
        expect(result.data.acceptedPrivacy).toBe(true)
      }
    })
  })

  // ── name ──────────────────────────────────────────────────────────────────

  describe('name', () => {
    it('rejeita name ausente', () => {
      const { name, ...rest } = VALID
      expect(fieldErrors(rest).name).toBeDefined()
    })

    it('rejeita name com 1 caractere', () => {
      expect(fieldErrors({ ...VALID, name: 'J' }).name).toBeDefined()
    })

    it('aceita name com 2 caracteres', () => {
      expect(fieldErrors({ ...VALID, name: 'Jo' }).name).toBeUndefined()
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

  // ── password ──────────────────────────────────────────────────────────────

  describe('password', () => {
    it('rejeita password ausente', () => {
      const { password, ...rest } = VALID
      expect(fieldErrors(rest).password).toBeDefined()
    })

    it('rejeita password com menos de 8 caracteres', () => {
      expect(fieldErrors({ ...VALID, password: 'Ab1' }).password).toBeDefined()
    })

    it('rejeita password sem letra maiúscula', () => {
      expect(fieldErrors({ ...VALID, password: 'senha123' }).password).toBeDefined()
    })

    it('rejeita password sem letra minúscula', () => {
      expect(fieldErrors({ ...VALID, password: 'SENHA123' }).password).toBeDefined()
    })

    it('rejeita password sem número', () => {
      expect(fieldErrors({ ...VALID, password: 'SenhaForte' }).password).toBeDefined()
    })

    it('aceita password com exatamente 8 chars, maiúscula, minúscula e número', () => {
      expect(fieldErrors({ ...VALID, password: 'Abcdef1!' }).password).toBeUndefined()
    })
  })

  // ── confirmPassword ───────────────────────────────────────────────────────

  describe('confirmPassword', () => {
    it('rejeita confirmPassword ausente', () => {
      const { confirmPassword, ...rest } = VALID
      expect(fieldErrors(rest).confirmPassword).toBeDefined()
    })
  })

  // ── restaurantName ────────────────────────────────────────────────────────

  describe('restaurantName', () => {
    it('rejeita restaurantName ausente', () => {
      const { restaurantName, ...rest } = VALID
      expect(fieldErrors(rest).restaurantName).toBeDefined()
    })

    it('rejeita restaurantName com 1 caractere', () => {
      expect(fieldErrors({ ...VALID, restaurantName: 'R' }).restaurantName).toBeDefined()
    })

    it('aceita restaurantName com 2 caracteres', () => {
      expect(fieldErrors({ ...VALID, restaurantName: 'RG' }).restaurantName).toBeUndefined()
    })
  })

  // ── aceites ───────────────────────────────────────────────────────────────

  describe('acceptedTerms / acceptedPrivacy', () => {
    it('rejeita acceptedTerms ausente', () => {
      const { acceptedTerms, ...rest } = VALID
      expect(fieldErrors(rest).acceptedTerms).toBeDefined()
    })

    it('rejeita acceptedPrivacy ausente', () => {
      const { acceptedPrivacy, ...rest } = VALID
      expect(fieldErrors(rest).acceptedPrivacy).toBeDefined()
    })

    it('aceita acceptedTerms = false (validação de negócio fica no use case)', () => {
      // o schema só verifica o tipo; a regra "deve ser true" é do use case
      expect(fieldErrors({ ...VALID, acceptedTerms: false }).acceptedTerms).toBeUndefined()
    })
  })
})

// ─── throwFieldError ─────────────────────────────────────────────────────────

describe('throwFieldError', () => {
  it('lança SapphireValidationError', () => {
    expect(() => throwFieldError('confirmPassword', 'As senhas não conferem.')).toThrow(SapphireValidationError)
  })

  it('inclui o campo correto no path do erro', () => {
    try {
      throwFieldError('confirmPassword', 'As senhas não conferem.')
    } catch (e) {
      expect(e).toBeInstanceOf(SapphireValidationError)
      const err = e as SapphireValidationError
      expect(err.issues[0].path).toEqual(['confirmPassword'])
    }
  })

  it('inclui a mensagem correta', () => {
    try {
      throwFieldError('acceptedTerms', 'Deve aceitar os termos.')
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
