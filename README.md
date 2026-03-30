# TypeScript Base Project

Um projeto base estruturado em TypeScript com Node.js, Fastify e MongoDB, projetado para facilitar a criação rápida de APIs RESTful com arquitetura limpa e suporte multi-tenant. A arquitetura é extensível e permite a integração com qualquer banco de dados.

## 📋 Índice

- [Características](#-características)
- [Tecnologias](#-tecnologias)
- [Arquitetura](#-arquitetura)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Aurora - Biblioteca de Validação](#-aurora---biblioteca-de-validação)
- [CRUD Genérico](#-crud-genérico)
- [Multi-tenant](#-multi-tenant)
- [Tratamento de Erros](#-tratamento-de-erros)
- [Scripts Disponíveis](#-scripts-disponíveis)
- [Exemplos](#-exemplos)
- [Recursos Avançados](#-recursos-avançados)
- [Dicas de Uso](#-dicas-de-uso)
- [Contribuindo](#-contribuindo)
- [Licença](#-licença)

## ✨ Características

- 🚀 **Arquitetura Limpa**: Separação clara entre camadas (controladores, casos de uso, repositórios)
- 🔄 **CRUD Genérico**: Classes base reutilizáveis para operações CRUD
- ✅ **Validação de Dados**: Biblioteca Aurora própria para validação e inferência de tipos
- 🏢 **Multi-tenant**: Suporte a múltiplos ambientes/tenants via headers HTTP
- 🗃️ **Extensível para Múltiplos Bancos**: Interface CrudRepository permite integrar qualquer banco de dados
- 💾 **MongoDB**: Implementação de referência incluindo paginação e filtros
- 🛡️ **Tratamento de Erros**: Sistema de erros customizados com códigos e status HTTP
- ⚡ **Fastify**: Framework web rápido e eficiente
- 📦 **TypeScript**: Tipagem estática completa
- 🔧 **ESLint**: Padronização de código configurada
- 🔥 **Hot Reload**: Desenvolvimento com recarga automática

## 🛠️ Tecnologias

- **Runtime**: Node.js
- **Linguagem**: TypeScript
- **Framework Web**: Fastify
- **Banco de Dados**: MongoDB (exemplo de implementação, extensível para outros bancos)
- **Validação**: Aurora (biblioteca própria)
- **Linting**: ESLint
- **Dev Tools**: tsx, dotenv

## 🏗️ Arquitetura

O projeto segue uma arquitetura em camadas inspirada em Clean Architecture e DDD:

```
┌─────────────────────────────────────────┐
│         Controllers (Fastify)           │  ← Interface HTTP
├─────────────────────────────────────────┤
│           Use Cases (Regras de Negócio) │  ← Lógica de Aplicação
├─────────────────────────────────────────┤
│           Repositories                  │  ← Acesso aos Dados
├─────────────────────────────────────────┤
│           MongoDB                       │  ← Persistência
└─────────────────────────────────────────┘
```

### Camadas

- **Controllers**: Recebem requisições HTTP, validam dados e delegam para os Use Cases
- **Use Cases**: Contêm a lógica de negócio e orquestram operações
- **Repositories**: Abstraem o acesso ao banco de dados
- **Entities**: Representam os modelos de domínio
- **ORM/Schemas**: Definem a estrutura e validação dos dados usando Aurora

## 📥 Instalação

```bash
# Clone o repositório
git clone <url-do-repositorio>

# Entre no diretório
cd typescript-base-project

# Instale as dependências
npm install
```

## ⚙️ Configuração

1. Crie um arquivo `.env` na raiz do projeto:

```env
# MongoDB (pode usar a conection string +srv)
MONGODB_URI=mongodb://localhost:27017/seu-banco

# API
API_URL=http://localhost:3000
PORT=3000
```

2. Certifique-se de que o MongoDB está rodando (caso esteja rodando o mongodb localmente):

```bash
# Se estiver usando Docker
docker run -d -p 27017:27017 --name mongodb mongo
```

## 🚀 Uso

### Desenvolvimento

```bash
# Inicia o servidor com hot reload
npm run start:w
```

### Produção

```bash
# Build do projeto
npm run build

# Inicia o servidor
npm start
```

### Outros comandos

```bash
# Executar linter
npm run lint

# Corrigir problemas de linting
npm run lint:fix

# Executar testes
npm test
```

## 📁 Estrutura do Projeto

```
src/
├── app/                          # Módulos de aplicação
│   ├── person/                   # Exemplo: módulo Person
│   │   ├── person-controller.ts  # Controller HTTP
│   │   ├── person-entity.ts      # Tipo da entidade
│   │   ├── person-orm.ts         # Schema/validação Aurora
│   │   ├── person-repository.ts  # Repositório específico
│   │   └── person-routes.ts      # Rotas Fastify
│   └── auth/                     # Módulo de autenticação
│       ├── auth-controller.ts
│       └── use-cases/
│           └── auth-use-case.ts
│
├── core/                         # Núcleo reutilizável
│   ├── aurora/                   # Biblioteca de validação
│   │   ├── core/                 # Tipos primitivos
│   │   │   ├── string.ts
│   │   │   ├── number.ts
│   │   │   ├── boolean.ts
│   │   │   ├── date.ts
│   │   │   ├── array.ts
│   │   │   ├── object.ts
│   │   │   └── type.ts
│   │   ├── lib/
│   │   │   ├── aurora.ts         # Classe principal
│   │   │   └── validation-error.ts
│   │   └── types/
│   │       ├── infer-type.ts     # Inferência de tipos
│   │       └── orm.ts            # Tipos de ORM
│   │
│   ├── crud/                     # Classes CRUD genéricas
│   │   ├── crud-controller.ts    # Controller base
│   │   ├── crud-use-case.ts      # Use case base
│   │   ├── crud-repository-interface.ts
│   │   └── mongodb-crud-repository.ts
│   │
│   ├── errors/                   # Sistema de erros
│   │   └── core/
│   │       ├── base-error.ts     # Erro base
│   │       ├── error-glossary.ts # Glossário de erros
│   │       └── not-found-error.ts
│   │
│   ├── builders/                 # Builders auxiliares
│   │   ├── filter-builder/
│   │   │   └── mongo-filter-builder.ts
│   │   └── response-builder/
│   │       └── response-builder.ts
│   │
│   ├── types/                    # Tipos compartilhados
│   │   ├── entity.ts
│   │   ├── pagination.ts
│   │   └── resource.ts
│   │
│   └── utils/                    # Utilitários
│       └── get-env.ts            # Helper multi-tenant
│
└── infrastructure/               # Infraestrutura
    ├── db/
    │   └── mongodb/
    │       ├── index.ts
    │       └── mongodb-connection.ts
    └── server/
        └── server.ts             # Configuração do Fastify
```

## 🌟 Aurora - Biblioteca de Validação

Aurora é uma biblioteca própria para validação de objetos e inferência de tipos TypeScript.

### Características

- ✅ Validação em tempo de execução
- 🎯 Inferência automática de tipos TypeScript
- 🔗 API fluente e encadeável
- 📦 Suporte a objetos aninhados
- 📋 Suporte a arrays
- 🔀 Suporte a union types
- 🎨 Marcação de campos opcionais

### Exemplo de Uso

```typescript
import { Aurora } from './core/aurora/lib/aurora'
import { ORM } from './core/aurora/types'

const aurora = new Aurora(ORM.MONGO)

// Definir schema
const userOrm = aurora.object({
  name: aurora.string(),
  email: aurora.string(),
  age: aurora.number().optional(),
  isActive: aurora.boolean(),
  createdAt: aurora.date(),
  address: aurora.object({
    street: aurora.string(),
    city: aurora.string(),
    zipCode: aurora.string().optional(),
  }),
  tags: aurora.array([aurora.string()]).optional(),
})

// Inferir tipo TypeScript
type User = ReturnType<typeof userOrm.getType>

// Validar dados
try {
  const result = userOrm.validate(userData)
  console.log('Dados válidos:', result.value)
} catch (error) {
  if (error instanceof AuroraValidationError) {
    console.error('Erros:', error.details)
  }
}
```

### Tipos Suportados

- `string()`: Strings
- `number()`: Números
- `boolean()`: Booleanos
- `date()`: Datas
- `array([...])`: Arrays tipados
- `object({...})`: Objetos aninhados
- `type().union([...])`: Union types
- `.optional()`: Tornar campo opcional

## 🔄 CRUD Genérico

O projeto fornece classes base para operações CRUD que podem ser estendidas.

### Extensibilidade para Múltiplos Bancos de Dados

A arquitetura utiliza a interface `CrudRepository` que permite integrar qualquer banco de dados. O projeto já inclui uma implementação para MongoDB (`MongodbCrudRepository`), mas você pode facilmente criar implementações para PostgreSQL, MySQL, Redis, ou qualquer outro banco.

#### Interface CrudRepository

```typescript
export interface CrudRepository<T, ID> {
  insert(item: T, env: string): Promise<T>
  findById(id: ID, env: string): Promise<T | null>
  find(filter: Partial<T> & PaginationDto, env: string): Promise<T>
  findAll(filter: Partial<T> & PaginationDto, env: string): Promise<Array<T>>
  update(id: ID, item: Partial<T>, env: string): Promise<T>
  delete(id: ID, env: string): Promise<void>
  query<Q>(query: Object | Array<any> | string, env: string): Promise<Q>
}
```

#### Exemplo: Criando um Repository para PostgreSQL

```typescript
// postgresql-crud-repository.ts
import { Pool } from 'pg'
import { CrudRepository } from './crud-repository-interface'
import { PaginationDto } from '../types/pagination'

export class PostgresqlCrudRepository<T, ID> implements CrudRepository<T, ID> {
  constructor(
    private readonly tableName: string,
    private readonly pool: Pool
  ) {}

  async insert(item: T, env: string): Promise<T> {
    // Implementação específica do PostgreSQL
    const columns = Object.keys(item as any)
    const values = Object.values(item as any)
    const query = `INSERT INTO ${this.tableName} (${columns.join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`
    const result = await this.pool.query(query, values)
    return result.rows[0]
  }

  async findById(id: ID, env: string): Promise<T | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = $1`
    const result = await this.pool.query(query, [id])
    return result.rows[0] || null
  }

  // ... implementar outros métodos
}
```

#### Usando o Repository PostgreSQL

```typescript
// person-repository.ts
import { PostgresqlCrudRepository } from '../../core/crud/postgresql-crud-repository'
import { Person } from './person-entity'

export class PersonRepository extends PostgresqlCrudRepository<Person, number> {
  constructor() {
    super('persons', postgresPool) // Nome da tabela e pool de conexão
  }
}
```

**Vantagens dessa abordagem:**
- ✅ Troque de banco de dados sem alterar controllers ou use cases
- ✅ Use múltiplos bancos de dados no mesmo projeto
- ✅ Cada recurso pode usar um banco diferente
- ✅ Testes facilitados com repositories mockados

### Criando um Novo Recurso

#### 1. Defina o ORM/Schema

```typescript
// person-orm.ts
import { Aurora } from '../../core/aurora/lib/aurora'
import { ORM } from '../../core/aurora/types'

const aurora = new Aurora(ORM.MONGO)

export const personOrm = aurora.object({
  name: aurora.string(),
  age: aurora.number(),
  email: aurora.string().optional(),
})
```

#### 2. Defina a Entidade

```typescript
// person-entity.ts
import { Entity } from '../../core/types/entity'
import { personOrm } from './person-orm'

export type Person = ReturnType<typeof personOrm.getType> & Entity
```

#### 3. Crie o Repositório

```typescript
// person-repository.ts
import { MongodbCrudRepository } from '../../core/crud/mongodb-crud-repository'
import { Person } from './person-entity'

export class PersonRepository extends MongodbCrudRepository<Person, string> {
  constructor() {
    super('persons') // Nome da collection
  }
}
```

#### 4. Crie o Controller

```typescript
// person-controller.ts
import { CrudController } from '../../core/crud/crud-controller'
import { Person } from './person-entity'
import { personOrm } from './person-orm'
import { PersonRepository } from './person-repository'

export class PersonController extends CrudController<Person, string> {
  constructor() {
    super(new PersonRepository(), personOrm)
  }
}
```

#### 5. Defina as Rotas

```typescript
// person-routes.ts
import { FastifyInstance } from 'fastify'
import { PersonController } from './person-controller'

export async function personRoutes(fastify: FastifyInstance) {
  const controller = new PersonController()

  fastify.post('/', (request: any) => {
    return controller.insert(request.body, request.headers)
  })

  fastify.get('/', (request: any) => {
    return controller.findAll(request.query || {}, request.headers)
  })

  fastify.get('/:id', (request: any) => {
    return controller.findById(request.params.id, request.headers)
  })

  fastify.delete('/:id', (request: any) => {
    return controller.delete(request.params.id, request.headers)
  })
}
```

#### 6. Registre as Rotas no Servidor

```typescript
// server.ts
import { personRoutes } from '../../app/person/person-routes'

// ...
await server.register(personRoutes, { prefix: '/persons' })
```

## 🏢 Multi-tenant

O projeto suporta múltiplos ambientes/tenants através do header `env`.

### Como Funciona

- Cada requisição pode especificar um ambiente via header `env`
- O sistema conecta ao banco de dados correspondente
- Se não especificado, usa o ambiente `default`

### Exemplo de Requisição

```bash
# Ambiente de produção
curl -X GET http://localhost:3000/persons \
  -H "env: production"

# Ambiente de desenvolvimento (ou default)
curl -X GET http://localhost:3000/persons \
  -H "env: development"
```

### Configuração

O helper `GetEnv` extrai o ambiente dos headers:

```typescript
import { GetEnv } from '../utils/get-env'

const env = GetEnv.getEnv(headers) // 'production', 'development', 'default', etc.
```

## 🛡️ Tratamento de Erros

### Erros Personalizados

O sistema possui erros customizados que herdam de `BaseError`:

```typescript
export class NotFoundError extends BaseError {
  constructor(resource: string, id: any) {
    super(
      `${resource} with id ${id} not found`,
      `Resource not found`,
      'NOT_FOUND',
      404
    )
  }
}
```

### Resposta de Erro

```json
{
  "code": "NOT_FOUND",
  "message": "Resource not found"
}
```

### Erros de Validação

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": {
    "name": "Name is required",
    "age": "Age must be a number"
  }
}
```

### Tratamento Global

O servidor possui um handler global de erros configurado em [server.ts](src/infrastructure/server/server.ts):

```typescript
server.setErrorHandler((error, request, reply) => {
  if (error instanceof BaseError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.apiMessage,
    })
  }

  if (error instanceof AuroraValidationError) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: error.details,
    })
  }

  // Erro genérico 500
  return reply.status(500).send({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  })
})
```

## 📜 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm start` | Inicia o servidor em modo normal |
| `npm run start:w` | Inicia o servidor com hot reload (watch mode) |
| `npm run build` | Compila o TypeScript para JavaScript |
| `npm run lint` | Executa o linter para verificar o código |
| `npm run lint:fix` | Corrige automaticamente problemas de linting |
| `npm test` | Executa os testes com Vitest |

## 📚 Exemplos

### Criar um Person

```bash
POST http://localhost:3000/persons
Content-Type: application/json
env: development

{
  "name": "João Silva",
  "age": 30
}
```

### Listar Persons com Paginação

```bash
GET http://localhost:3000/persons?page=1&size=10&orderBy=name&orderDirection=asc
env: development
```

### Buscar Person por ID

```bash
GET http://localhost:3000/persons/507f1f77bcf86cd799439011
env: development
```

### Deletar Person

```bash
DELETE http://localhost:3000/persons/507f1f77bcf86cd799439011
env: development
```

## 🔧 Recursos Avançados

### FilterBuilder

O `FilterBuilder` ajuda a construir filtros complexos do MongoDB:

```typescript
const filter = new FilterBuilder()
  .defaultValues('active', 'status')
  .regex('joão', 'name')
  .betweenDates('2024-01-01', '2024-12-31', 'createdAt')
  .build()
```

### ResponseBuilder

O `ResponseBuilder` padroniza as respostas da API:

```typescript
return new ResponseBuilder()
  .payload(data)
  .build()
```

### Paginação

A interface `PaginationDto` fornece parâmetros de paginação:

- `page`: Número da página (padrão: 1)
- `size`: Tamanho da página (padrão: 10)
- `orderBy`: Campo para ordenação
- `orderDirection`: Direção ('asc' ou 'desc')
- `createdAtDirection`: Ordenação por data de criação

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## � Dicas de Uso

### Múltiplos Bancos de Dados no Mesmo Projeto

Você pode ter diferentes recursos usando diferentes bancos de dados:

```typescript
// UserRepository usa MongoDB
export class UserRepository extends MongodbCrudRepository<User, string> {
  constructor() {
    super('users')
  }
}

// ProductRepository usa PostgreSQL
export class ProductRepository extends PostgresqlCrudRepository<Product, number> {
  constructor() {
    super('products', postgresPool)
  }
}

// CacheRepository usa Redis
export class CacheRepository extends RedisCrudRepository<Cache, string> {
  constructor() {
    super(redisClient)
  }
}
```

### Bancos de Dados Suportados

| Banco de Dados | Status | Implementação |
|----------------|--------|---------------|
| MongoDB | ✅ Incluído | `MongodbCrudRepository` |
| PostgreSQL | 📝 Exemplo acima | Implemente `CrudRepository` |
| MySQL | 📝 Não incluído | Implemente `CrudRepository` |
| Redis | 📝 Não incluído | Implemente `CrudRepository` |
| SQLite | 📝 Não incluído | Implemente `CrudRepository` |
| DynamoDB | 📝 Não incluído | Implemente `CrudRepository` |

## �📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

Desenvolvido com ❤️ por Alexandre Damas Murata
