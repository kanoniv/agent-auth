import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number;
  color?: string;
  icon?: LucideIcon;
  suffix?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, color = 'text-[#1A1814]', icon: Icon, suffix }) => {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const start = ref.current;
    const diff = value - start;
    if (diff === 0) return;
    const duration = 600;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setDisplay(current);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        ref.current = value;
      }
    };
    requestAnimationFrame(tick);
  }, [value]);

  return (
    <div className="rounded-lg bg-white border border-[#E8E5DE] px-5 py-4 shadow-[0_1px_2px_rgba(26,24,20,0.04)]">
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-[#9C978E]" strokeWidth={1.5} />}
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#9C978E]">{label}</span>
      </div>
      <div className={cn('text-2xl font-bold font-data tabular-nums', color)}>
        {display.toLocaleString()}{suffix || ''}
      </div>
    </div>
  );
};
