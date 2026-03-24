import React from 'react';
import { cn, scoreColor, scoreFill } from '@/lib/utils';

interface ReputationBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export const ReputationBadge: React.FC<ReputationBadgeProps> = ({ score, size = 'sm' }) => {
  const radius = size === 'lg' ? 28 : size === 'md' ? 22 : 16;
  const stroke = size === 'lg' ? 3 : 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const dim = (radius + stroke) * 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={dim} height={dim} className="-rotate-90">
        <circle
          cx={radius + stroke} cy={radius + stroke} r={radius}
          fill="none" stroke="currentColor" strokeWidth={stroke}
          className="text-[#F7F6F3]"
        />
        <circle
          cx={radius + stroke} cy={radius + stroke} r={radius}
          fill="none"
          stroke={scoreFill(score)}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn(
        'absolute font-bold',
        size === 'lg' ? 'text-lg' : size === 'md' ? 'text-sm' : 'text-[10px]',
        scoreColor(score),
      )}>
        {Math.round(score)}
      </span>
    </div>
  );
};
