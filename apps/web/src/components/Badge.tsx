const styles: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-600 border border-dashed border-slate-400',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  ARCHIVED: 'bg-slate-100 text-slate-500',
  MANUAL: 'bg-slate-100 text-slate-600 border border-dashed border-slate-400',
  CONFIRMED: 'bg-green-100 text-green-700',
  IDENTIFYING: 'bg-blue-100 text-blue-700',
  NO_MATCH: 'bg-red-100 text-red-700',
  CONFLICTING: 'bg-amber-100 text-amber-800 border border-amber-300',
  ADMIN: 'bg-violet-100 text-violet-700',
  ANALYST: 'bg-blue-100 text-blue-700',
  VIEWER: 'bg-slate-100 text-slate-600',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
        styles[value] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {label ?? value.replace(/_/g, ' ')}
    </span>
  );
}
