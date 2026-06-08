import { Sapphire, SapphireValidationError } from '@ascendance-hub/sapphire-core'

const s = new Sapphire()

export const requestRecoverySchema = s.object({
  email: s.string()
    .email({ message: 'Informe um e-mail válido.' })
    .message({ required: 'O e-mail é obrigatório.' }),
})

export const resetPasswordSchema = s.object({
  token: s.string()
    .message({ required: 'Token é obrigatório.' }),
  novaSenha: s.string()
    .min(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/,
      { message: 'A senha deve conter ao menos uma letra maiúscula, uma minúscula e um número.' },
    )
    .message({ required: 'A nova senha é obrigatória.' }),
  confirmarNovaSenha: s.string()
    .message({ required: 'A confirmação da nova senha é obrigatória.' }),
})

export type RequestRecoveryInput = typeof requestRecoverySchema['_output']
export type ResetPasswordInput = typeof resetPasswordSchema['_output']

export function throwFieldError (field: string, message: string): never {
  throw new SapphireValidationError([{ path: [field], code: 'custom' as any, message }])
}
