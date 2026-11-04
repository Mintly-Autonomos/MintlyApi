/**
 * Limite de tentativas de senha e tempo de bloqueio. Vale para o login e para toda confirmação de senha
 * (trocar e-mail ou senha, pedir exclusão): um token roubado não pode servir para adivinhar a senha.
 */
export const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5)
export const BLOCK_DURATION_MINUTES = Number(process.env.BLOCK_DURATION_MINUTES ?? 15)
