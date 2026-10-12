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
