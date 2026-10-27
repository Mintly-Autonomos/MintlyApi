import { CrudController } from '../../core/crud/crud-controller'
import { Person, personSchema } from 'mintly-lib'
import { PersonRepository } from './person-repository'
import { Resource } from '../../core/types/resource'
import { buildRequestContext, ContextSource } from '../../core/context/build-request-context'
import { ResponseBuilder, ResponseStructure } from '../../core/builders/response-builder/response-builder'
import { GetPersonAvatarUseCase } from './use-cases/get-person-avatar-use-case'

export class PersonController extends CrudController<Person, string> {
  private readonly getAvatarUseCase = new GetPersonAvatarUseCase()

  constructor () {
    super(new PersonRepository(), personSchema, personSchema.partial(), Resource.Person)
  }

  async getAvatarByUsername (username: string, source: ContextSource): Promise<ResponseStructure> {
    const ctx = buildRequestContext(source)
    const result = await this.getAvatarUseCase.execute(username, ctx)
    return new ResponseBuilder().payload(result).build()
  }
}
