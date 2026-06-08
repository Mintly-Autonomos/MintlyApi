import { Sapphire, SapphireValidationError } from '@ascendance-hub/sapphire-core'
import { PASSWORD_MIN_LENGTH, PASSWORD_REGEX, PASSWORD_REGEX_MESSAGE } from '../../shared/password-policy'

const s = new Sapphire()

export const registerSchema = s.object({
  name: s.string()
    .min(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
    .message({ required: 'O nome é obrigatório.' }),

  email: s.string()
    .email({ message: 'Informe um e-mail válido.' })
    .message({ required: 'O e-mail é obrigatório.' }),

  password: s.string()
    .min(PASSWORD_MIN_LENGTH, { message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` })
    .regex(PASSWORD_REGEX, { message: PASSWORD_REGEX_MESSAGE })
    .message({ required: 'A senha é obrigatória.' }),

  confirmPassword: s.string()
    .message({ required: 'A confirmação de senha é obrigatória.' }),

  restaurantName: s.string()
    .min(2, { message: 'O nome do restaurante deve ter pelo menos 2 caracteres.' })
    .message({ required: 'O nome do restaurante é obrigatório.' }),

  acceptedTerms: s.boolean()
    .message({ required: 'É necessário aceitar os termos de uso.' }),

  acceptedPrivacy: s.boolean()
    .message({ required: 'É necessário aceitar a política de privacidade.' }),
})

export type RegisterInput = typeof registerSchema['_output']

export function throwFieldError (field: string, message: string): never {
  throw new SapphireValidationError([{ path: [field], code: 'custom' as any, message }])
}
