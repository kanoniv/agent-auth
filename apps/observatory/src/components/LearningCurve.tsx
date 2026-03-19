import React from 'react';
import type { TrendPoint } from '@/lib/types';

interface LearningCurveProps {
  points: TrendPoint[];
  width?: number;
  height?: number;
}

export const LearningCurve: React.FC<LearningCurveProps> = ({ points, width = 300, height = 100 }) => {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-20 text-[10px] text-zinc-600">
        No outcome data yet
      </div>
    );
  }

  const pad = { top: 8, right: 8, bottom: 20, left: 28 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const values = points.map(p => p.avg_reward ?? 0.5);
  const minV = 0;
  const maxV = 1;

  const x = (i: number) => pad.left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.top + h - ((v - minV) / (maxV - minV)) * h;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(values.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const formatTime = (t: string) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <svg width={width} height={height} className="w-full" viewBox={`0 0 ${width} ${height}`}>
      {[0, 0.25, 0.5, 0.75, 1].map(v => (
        <g key={v}>
          <line x1={pad.left} y1={y(v)} x2={width - pad.right} y2={y(v)}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <text x={pad.left - 4} y={y(v) + 3} textAnchor="end"
            className="fill-zinc-600" style={{ fontSize: '8px' }}>{v.toFixed(1)}</text>
        </g>
      ))}

      <path d={areaPath} fill="url(#rewardGrad)" />
      <defs>
        <linearGradient id="rewardGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C5A572" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#C5A572" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={linePath} fill="none" stroke="#C5A572" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.5"
          fill="#0a0a0f" stroke="#C5A572" strokeWidth="1.5" />
      ))}

      {points.map((p, i) => {
        const barW = Math.max(2, w / points.length - 2);
        const bx = x(i) - barW / 2;
        const ratio = p.total > 0 ? p.successes / p.total : 0.5;
        return (
          <g key={`bar-${i}`}>
            <rect x={bx} y={height - 12} width={barW * ratio} height={4} rx="1" fill="#34d399" opacity="0.6" />
            <rect x={bx + barW * ratio} y={height - 12} width={barW * (1 - ratio)} height={4} rx="1" fill="#f87171" opacity="0.4" />
          </g>
        );
      })}

      {points.length > 0 && (
        <>
          <text x={x(0)} y={height - 1} textAnchor="start" className="fill-zinc-600" style={{ fontSize: '8px' }}>
            {formatTime(points[0].time)}
          </text>
          {points.length > 2 && (
            <text x={x(points.length - 1)} y={height - 1} textAnchor="end" className="fill-zinc-600" style={{ fontSize: '8px' }}>
              {formatTime(points[points.length - 1].time)}
            </text>
          )}
        </>
      )}
    </svg>
  );
};
