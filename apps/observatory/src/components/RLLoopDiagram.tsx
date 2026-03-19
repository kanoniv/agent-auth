import React from 'react';
import { Zap, Eye, Brain, RotateCw, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RLLoopDiagramProps {
  trend: 'improving' | 'declining' | 'stable';
}

export const RLLoopDiagram: React.FC<RLLoopDiagramProps> = ({ trend }) => {
  const trendColor = trend === 'improving' ? 'text-emerald-400' : trend === 'declining' ? 'text-red-400' : 'text-zinc-400';
  const trendLabel = trend === 'improving' ? 'Learning' : trend === 'declining' ? 'Degrading' : 'Stable';

  const steps = [
    { icon: Zap, label: 'Act', color: 'text-[#C5A572]' },
    { icon: Eye, label: 'Outcome', color: 'text-zinc-400' },
    { icon: Brain, label: 'Memorize', color: 'text-purple-400' },
    { icon: RotateCw, label: trendLabel, color: trendColor },
  ];

  return (
    <div className="flex items-center justify-between px-2 py-2">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ArrowRight className="w-3 h-3 text-zinc-700 shrink-0" />}
          <div className="flex flex-col items-center gap-0.5">
            <step.icon className={cn('w-3.5 h-3.5', step.color)} />
            <span className={cn('text-[8px] font-medium', step.color)}>{step.label}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};
