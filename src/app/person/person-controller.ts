import { CrudController } from '../../core/crud/crud-controller'
import { Person, personValidator } from './person-model'
import { PersonRepository } from './person-repository'

export class PersonController extends CrudController<Person, string> {
  constructor () {
    super(new PersonRepository(), personValidator)
  }
}
