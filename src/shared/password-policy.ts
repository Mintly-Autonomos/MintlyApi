// B1: política de senha centralizada — mover para MintlyLib quando disponível
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/
export const PASSWORD_REGEX_MESSAGE = 'A senha deve conter ao menos uma letra maiúscula, uma minúscula e um número.'
