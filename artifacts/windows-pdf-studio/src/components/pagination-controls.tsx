import { ChevronLeft, ChevronRight } from 'lucide-react';
import './pagination-controls.css';

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
};

export function PaginationControls({
  page,
  pageSize,
  total,
  itemLabel,
  onPageChange,
}: PaginationControlsProps) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  const testIdPrefix = itemLabel.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <nav className="list-pagination" aria-label={`${itemLabel} pagination`}>
      <span className="list-pagination-summary">
        Showing {firstItem}–{lastItem} of {total} {itemLabel}
      </span>
      <div className="list-pagination-actions">
        <button
          type="button"
          className="list-pagination-button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label={`Previous ${itemLabel} page`}
          data-testid={`button-${testIdPrefix}-previous-page`}
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <span className="list-pagination-current" aria-live="polite">Page {page} of {pageCount}</span>
        <button
          type="button"
          className="list-pagination-button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          aria-label={`Next ${itemLabel} page`}
          data-testid={`button-${testIdPrefix}-next-page`}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}
