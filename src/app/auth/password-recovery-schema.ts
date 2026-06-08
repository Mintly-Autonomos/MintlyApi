import { Sapphire, SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { PASSWORD_MIN_LENGTH, PASSWORD_REGEX, PASSWORD_REGEX_MESSAGE } from '../../shared/password-policy'

const s = new Sapphire()

export const requestRecoverySchema = s.object({
  email: s.string()
    .email({ message: 'Informe um e-mail válido.' })
    .message({ required: 'O e-mail é obrigatório.' }),
})

export const resetPasswordSchema = s.object({
  token: s.string()
    .message({ required: 'Token é obrigatório.' }),
  newPassword: s.string()
    .min(PASSWORD_MIN_LENGTH, { message: `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.` })
    .regex(PASSWORD_REGEX, { message: PASSWORD_REGEX_MESSAGE })
    .message({ required: 'A nova senha é obrigatória.' }),
  confirmNewPassword: s.string()
    .message({ required: 'A confirmação da nova senha é obrigatória.' }),
})

export type RequestRecoveryInput = typeof requestRecoverySchema['_output']
export type ResetPasswordInput = typeof resetPasswordSchema['_output']

export function throwFieldError (field: string, message: string): never {
  throw new SapphireValidationError([{ path: [field], code: 'custom' as any, message }])
}
