/** Seleciona o DB de auth respeitando o env do RequestContext (B5). */
export const authDbName = (env = 'default'): string =>
  env !== 'default'
    ? env
    : (process.env.MONGODB_AUTH_DB ?? process.env.MONGODB_DB ?? 'mintly')
