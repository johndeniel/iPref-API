export class PaginatedResponseDto<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;

  constructor(content: T[], totalElements: number, totalPages: number, page: number, size: number) {
    this.content = content;
    this.totalElements = totalElements;
    this.totalPages = totalPages;
    this.page = page;
    this.size = size;
  }
}
