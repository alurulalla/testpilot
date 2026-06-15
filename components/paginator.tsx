'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Compact pager. `page` is 0-indexed. Renders nothing when everything fits on
 * one page. Theme-neutral (zinc scale) so it works on both the dashboard and
 * the dark session page.
 */
export function Paginator({
  page, pageSize, total, onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const btn =
    'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-zinc-700 ' +
    'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition disabled:opacity-40 ' +
    'disabled:hover:bg-transparent disabled:hover:text-zinc-300';

  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-[11px] text-zinc-400 tabular-nums">{from}–{to} of {total}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} className={btn}>
          <ChevronLeft className="h-3 w-3" /> Prev
        </button>
        <span className="text-[11px] text-zinc-400 tabular-nums px-1">{page + 1} / {totalPages}</span>
        <button type="button" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)} className={btn}>
          Next <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
