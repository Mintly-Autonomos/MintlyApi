import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { Person } from 'mintly-lib'

export class PersonRepository extends MongodbCrudRepository<Person, string> {
  constructor () {
    super('people')
  }
}
