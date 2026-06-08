import { Sapphire, SapphireValidationError } from '@ascendance-hub/sapphire-core'

const s = new Sapphire()

/**
 * Valida os campos individuais do cadastro.
 * Validação cross-field (confirmarSenha, aceites) é feita no use case.
 */
export const registerSchema = s.object({
  nome: s.string()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .message({ required: 'O nome é obrigatório.' }),

  email: s.string()
    .email({ message: 'Informe um e-mail válido.' })
    .message({ required: 'O e-mail é obrigatório.' }),

  senha: s.string()
    .min(8, { message: 'A senha deve ter pelo menos 8 caracteres.' })
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/,
      { message: 'A senha deve conter ao menos uma letra maiúscula, uma minúscula e um número.' },
    )
    .message({ required: 'A senha é obrigatória.' }),

  confirmarSenha: s.string()
    .message({ required: 'A confirmação de senha é obrigatória.' }),

  nomeRestaurante: s.string()
    .min(2, { message: 'O nome do restaurante deve ter pelo menos 2 caracteres.' })
    .message({ required: 'O nome do restaurante é obrigatório.' }),

  aceitouTermos: s.boolean()
    .message({ required: 'É necessário aceitar os termos de uso.' }),

  aceitouPrivacidade: s.boolean()
    .message({ required: 'É necessário aceitar a política de privacidade.' }),
})

export type RegisterInput = typeof registerSchema['_output']

/**
 * Lança SapphireValidationError com erro no campo especificado.
 * Mantém o mesmo contrato de erro do handler global.
 */
export function throwFieldError (field: string, message: string): never {
  throw new SapphireValidationError([{ path: [field], code: 'custom' as any, message }])
}
