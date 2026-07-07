type ErrorEntry = Record<string, {
  message: string
  apiMessage: string
  code: string
}>

export const errorGlossary: ErrorEntry = {
  notFound: {
    message: 'Recurso não encontrado.',
    apiMessage: 'The requested resource could not be found.',
    code: 'APP-0001',
  },
  unsupportedQueryKind: {
    message: 'Query kind não suportada pelo backend.',
    apiMessage: 'The provided query kind is not supported by this backend.',
    code: 'APP-0002',
  },
  missingEnv: {
    message: 'Header "env" ausente. Informe o ambiente/tenant da requisição.',
    apiMessage: 'The "env" header is required to resolve the tenant database.',
    code: 'APP-0003',
  },
}
