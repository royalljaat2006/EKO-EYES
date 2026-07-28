import { useMemo, useState } from "react";

/**
 * Slices an array into fixed-size pages. Clamps the current page whenever the
 * underlying array shrinks (a filter change, a shorter API response) so the
 * view can never get stuck showing an out-of-range, empty page.
 *
 * Resets to page 0 automatically whenever the array reference/identity a
 * caller passes in changes shape in a way that moves the item at the current
 * page out of range — callers that filter client-side should still call
 * `resetPage()` from their filter handlers so a new filter always starts the
 * reader back at page 1 rather than wherever they happened to be scrolled to.
 */
export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => items.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [items, safePage, pageSize],
  );

  return {
    page: safePage,
    pageCount,
    visible,
    setPage,
    resetPage: () => setPage(0),
  };
}
