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

export const StatCard: React.FC<StatCardProps> = ({ label, value, color = 'text-[#E8E8ED]', icon: Icon, suffix }) => {
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
      // ease-out cubic
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
    <div className="rounded-xl bg-[#12121a] border border-white/[.07] px-5 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-zinc-500" />}
        <span className="text-xs text-[#8B8B96]">{label}</span>
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', color)}>
        {display.toLocaleString()}{suffix || ''}
      </div>
    </div>
  );
};
