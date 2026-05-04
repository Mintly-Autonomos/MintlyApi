import { mkdir, writeFile } from 'node:fs/promises'
import SwaggerParser from '@apidevtools/swagger-parser'
import { buildServer } from '../src/infrastructure/server/build-server'

async function main () {
  const server = await buildServer()

  try {
    await server.ready()

    const swaggerDocument = server.swagger()
    await SwaggerParser.validate(swaggerDocument as never)

    if (swaggerDocument.openapi == null) {
      throw new Error('Swagger validation failed: OpenAPI version is missing')
    }

    if (swaggerDocument.paths?.['/health'] == null) {
      throw new Error('Swagger validation failed: /health route is missing from the spec')
    }

    const peoplePath = Object.keys(swaggerDocument.paths ?? {}).find((path) => path.startsWith('/people'))

    if (peoplePath == null) {
      throw new Error('Swagger validation failed: /people route is missing from the spec')
    }

    await mkdir('artifacts', { recursive: true })
    await writeFile('artifacts/swagger.json', JSON.stringify(swaggerDocument, null, 2))

    console.log('Swagger document validated and exported to artifacts/swagger.json')
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error('Swagger validation failed:', error)
  process.exit(1)
})
