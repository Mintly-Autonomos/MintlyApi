import type { Document, Filter } from 'mongodb'

export type MongoPipelineQuery = {
  kind: 'mongo:pipeline'
  pipeline: Document[]
}

export type MongoFilterQuery = {
  kind: 'mongo:filter'
  filter: Filter<Document>
}

export type SqlSelectQuery = {
  kind: 'sql:select'
  sql: string
  params?: unknown[]
}

export type Query = MongoPipelineQuery | MongoFilterQuery | SqlSelectQuery

export type QueryKind = Query['kind']
