import type {
  PaginationDto as MintlyPaginationDto,
  PaginationResponseDto,
} from 'mintly-lib'

export type PaginationDto = Partial<MintlyPaginationDto> & {
  isMultipleResponse?: boolean
}

export type { PaginationResponseDto }
