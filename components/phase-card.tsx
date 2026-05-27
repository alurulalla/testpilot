import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type PhaseState = 'pending' | 'running' | 'done' | 'failed';

interface PhaseCardProps {
  step: number;
  title: string;
  description: string;
  state: PhaseState;
  children?: React.ReactNode;
}

export function PhaseCard({ step, title, description, state, children }: PhaseCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border p-5 transition-all',
        state === 'running' && 'border-violet-500/50 bg-violet-500/5',
        state === 'done' && 'border-emerald-500/30 bg-emerald-500/5',
        state === 'failed' && 'border-red-500/30 bg-red-500/5',
        state === 'pending' && 'border-zinc-800 bg-zinc-900/50 opacity-60'
      )}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-mono text-zinc-500">0{step}</span>
        {state === 'running' && <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />}
        {state === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
        {state === 'failed' && <XCircle className="h-4 w-4 text-red-400" />}
        {state === 'pending' && <Circle className="h-4 w-4 text-zinc-600" />}
        <h3 className="font-medium text-sm text-zinc-100">{title}</h3>
      </div>
      <p className="text-xs text-zinc-500 ml-12 mb-3">{description}</p>
      {children && <div className="ml-12">{children}</div>}
    </div>
  );
}
