export class FilterBuilder {
  protected filter: any = {}

  defaultValues (value: string | number | boolean | null, matchField: string): this {
    this.filter[matchField] = value

    return this
  }

  array (values: string[], matchField: string): this {
    this.filter[matchField] = { $in: values }

    return this
  }

  regex (value: string, matchField: string, options: string | null = 'i'): this {
    this.filter[matchField] = {
      $regex: value,
      $options: options,
    }

    return this
  }

  betweenDates (initialDate: string, finalDate: string, matchField: string): this {
    const startDate = new Date(initialDate)
    const endDate = new Date(finalDate)

    this.filter[matchField] = {

      $gte: startDate,
      $lte: endDate,
    }

    return this
  }

  exists (value: boolean, matchField: string, notEquals: any = null): this {
    this.filter[matchField] = {
      $exists: value,
      $ne: notEquals,
    }

    return this
  }

  month (date: string | Date, matchField: string): this {
    const filterDate = new Date(date)
    const year = filterDate.getUTCFullYear()
    const month = filterDate.getUTCMonth()

    const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
    const finalDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))

    return this.betweenDates(startDate.toISOString(), finalDate.toISOString(), matchField)
  }

  day (date: string | Date, matchField: string): this {
    const filterDate = new Date(date)
    const year = filterDate.getUTCFullYear()
    const month = filterDate.getUTCMonth()
    const day = filterDate.getUTCDate()

    const startDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
    const finalDate = new Date(Date.UTC(year, month, day, 23, 59, 59, 999))

    return this.betweenDates(startDate.toISOString(), finalDate.toISOString(), matchField)
  }

  notEqual (value: string | number | boolean | null, matchField: string): this {
    this.filter[matchField] = {
      $ne: value,
    }

    return this
  }

  #cleanFilters () {
    this.filter = {}
  }

  build (): any {
    const filter = this.filter
    this.#cleanFilters()

    return filter
  }
}
