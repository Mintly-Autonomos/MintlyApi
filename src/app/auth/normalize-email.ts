/**
 * Normaliza e-mail (trim + lowercase) para casar cadastro e login. O índice
 * único de `email` é case-sensitive, então sem normalizar `A@x.com` e `a@x.com`
 * viram contas distintas e o login falha se o casing diferir do cadastro.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
