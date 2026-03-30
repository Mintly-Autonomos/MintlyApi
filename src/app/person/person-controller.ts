import { CrudController } from '../../core/crud/crud-controller'
import { Person, personOrm } from 'mintly-lib'
import { PersonRepository } from './person-repository'

export class PersonController extends CrudController<Person, string> {
  constructor () {
    super(new PersonRepository(), personOrm)
  }
}
