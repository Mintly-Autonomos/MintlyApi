import { ValidationError } from '../../core/errors/core/validation-error'
import type { Person } from 'mintly-lib'

export type { Person }

export const personValidator = {
  validate (input: Partial<Person>) {
    if (input.name != null && input.name.toString().trim().length === 0) {
      throw new ValidationError('Person name cannot be empty')
    }

    if (input.age != null && typeof input.age !== 'number') {
      throw new ValidationError('Person age must be a number')
    }

    if (input.name == null && input.age == null) {
      throw new ValidationError('Person payload must include at least one known field')
    }
  },
}
