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
  // Auth — fonte única dos códigos (antes definidos inline em cada erro).
  unauthorized: {
    message: 'Credenciais inválidas ou token expirado.',
    apiMessage: 'Invalid credentials or expired token.',
    code: 'AUTH-0001',
  },
  conflict: {
    message: 'Conflito com o estado atual do recurso.',
    apiMessage: 'The request conflicts with the current state of the resource.',
    code: 'AUTH-0002',
  },
  forbidden: {
    message: 'Acesso negado ao recurso.',
    apiMessage: 'You do not have permission to access this resource.',
    code: 'AUTH-0003',
  },
  tooManyRequests: {
    message: 'Muitas requisições. Tente novamente mais tarde.',
    apiMessage: 'Too many requests. Please try again later.',
    code: 'AUTH-0004',
  },
}
