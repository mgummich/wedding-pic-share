export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    /** Opaque cursor for the next page; null when no more items are available */
    nextCursor: string | null
    hasMore: boolean
  }
}
