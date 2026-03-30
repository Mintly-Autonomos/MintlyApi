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
}
