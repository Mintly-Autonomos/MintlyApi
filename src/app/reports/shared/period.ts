import { ValidationError } from '../../../core/errors/core/validation-error'

/**
 * Dias dos relatórios (design 1.3): "hoje" só significa algo com fuso definido.
 * Em UTC, um lançamento das 22h de 31 de julho cairia em agosto. O fuso é fixo
 * em America/Sao_Paulo (N11 registra o fuso por restaurante como pendência).
 *
 * Um "dia" aqui é a string `AAAA-MM-DD`. Aritmética de dias é feita sobre a
 * string (via UTC, que não tem horário de verão), nunca sobre o instante.
 */
export const REPORT_TIME_ZONE = 'America/Sao_Paulo'

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TIME_ZONE,
  timeZoneName: 'longOffset',
})

const DAY_MS = 24 * 60 * 60 * 1000

function parts (day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}

/** Instante → dia local (`en-CA` formata como AAAA-MM-DD). */
export function toLocalDay (instant: Date): string {
  return dayFormat.format(instant)
}

export function addDaysToDay (day: string, n: number): string {
  const [y, m, d] = parts(day)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function diffDays (from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/**
 * Nome de fuso no formato `longOffset` do Intl → minutos (ex.: "GMT-03:00" →
 * -180). "GMT" puro (UTC) ou nome ausente → 0.
 */
export function parseGmtOffset (name: string | undefined): number {
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '')
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** Deslocamento do fuso naquele dia, em minutos. */
function offsetMinutes (day: string): number {
  const [y, m, d] = parts(day)
  const name = offsetFormat.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)))
    .find((p) => p.type === 'timeZoneName')?.value
  return parseGmtOffset(name)
}

/** Primeiro instante do dia local — limite inferior de filtro no Mongo. */
export function startOfLocalDay (day: string): Date {
  const [y, m, d] = parts(day)
  return new Date(Date.UTC(y, m - 1, d) - offsetMinutes(day) * 60 * 1000)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HALF_DAY_MS = 12 * 60 * 60 * 1000

/**
 * Data de negócio (o dia de um lançamento: `date`, `dueDate`) como ela deve ser gravada: o MEIO-DIA em São
 * Paulo daquele dia. É o mesmo jeito que os relatórios leem o mês (`startOfLocalMonth`): com meio-dia não há
 * como o dia escorregar para o mês ou o dia vizinho.
 *
 * - `AAAA-MM-DD` (o que um seletor de data manda) ou meia-noite UTC exata (o mesmo texto depois do
 *   `new Date`/`coerce`) = aquele dia. Sem isto, o dia 1º gravado como 00:00 UTC é 21h do dia anterior em
 *   São Paulo e caía no mês anterior.
 * - Qualquer outro instante = o dia local dele.
 * - Inválido volta como está (a validação de quem chama recusa).
 */
export function toBusinessDate (value: string | Date): Date {
  let day: string
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    day = value
  } else {
    const instant = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(instant.getTime())) return instant
    const utcMidnight = instant.getUTCHours() === 0 && instant.getUTCMinutes() === 0 &&
      instant.getUTCSeconds() === 0 && instant.getUTCMilliseconds() === 0
    day = utcMidnight ? instant.toISOString().slice(0, 10) : toLocalDay(instant)
  }
  return new Date(startOfLocalDay(day).getTime() + HALF_DAY_MS)
}

/** Mês civil local (`AAAA-MM`) de um instante — o mês da competência. */
export function toLocalMonth (instant: Date): string {
  return toLocalDay(instant).slice(0, 7)
}

export function addMonths (month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export function diffMonths (from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty * 12 + tm) - (fy * 12 + fm)
}

/** Primeiro instante do mês local — limite de filtro no Mongo. */
export function startOfLocalMonth (month: string): Date {
  return startOfLocalDay(`${month}-01`)
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `?month=AAAA-MM` dos relatórios e do /restaurants/me: padrão o mês corrente; futuro não existe. */
export function parseReferenceMonth (value: string | undefined, now: Date): string {
  const current = toLocalMonth(now)
  if (value == null) return current
  if (!MONTH.test(value)) throw new ValidationError('month inválido: use AAAA-MM.')
  if (value > current) throw new ValidationError('month não pode estar no futuro.')
  return value
}

/**
 * Ajuste A1: dia de corte da comparação "mesmo período". Só existe quando `month`
 * é o mês de hoje em SP (o dia de hoje, inclusive); mês fechado → null.
 */
export function comparisonUntilDay (month: string, now: Date): number | null {
  const day = toLocalDay(now)
  return day.slice(0, 7) === month ? Number(day.slice(8, 10)) : null
}
