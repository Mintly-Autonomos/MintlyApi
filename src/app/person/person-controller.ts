import { CrudController } from '../../core/crud/crud-controller'
import { Person, personSchema } from 'mintly-lib'
import { PersonRepository } from './person-repository'
import { Resource } from '../../core/types/resource'

export class PersonController extends CrudController<Person, string> {
  constructor () {
    super(new PersonRepository(), personSchema, personSchema.partial(), Resource.Person)
  }
}
