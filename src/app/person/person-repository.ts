import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { Person } from './person-model'

export class PersonRepository extends MongodbCrudRepository<Person, string> {
  constructor () {
    super('people')
  }
}
