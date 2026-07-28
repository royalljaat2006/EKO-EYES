interface Props {
  /** 0-based current page. */
  page: number;
  pageCount: number;
  visibleCount: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
}

/** Shared prev/next control — same markup/CSS every paginated panel uses, so paging behaves identically everywhere. Renders nothing when there's only one page. */
export default function Pager({ page, pageCount, visibleCount, totalCount, onPrev, onNext }: Props) {
  if (pageCount <= 1) return null;
  return (
    <div className="pager">
      <button type="button" className="pager__button" onClick={onPrev} disabled={page === 0}>
        ‹ Prev
      </button>
      <span className="pager__label">
        Page {page + 1} of {pageCount} &middot; showing {visibleCount} of {totalCount}
      </span>
      <button type="button" className="pager__button" onClick={onNext} disabled={page >= pageCount - 1}>
        Next ›
      </button>
    </div>
  );
}
