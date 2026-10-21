import { markShape, type CheckMark as Mark } from '../style';

/** Renders a checkbox mark in a 1×1 box, scaled about the centre by `size`. */
export function CheckMark({ mark, size = 0.8, stroke = 0.12, color = 'currentColor' }: { mark: Mark; size?: number; stroke?: number; color?: string }) {
  const sh = markShape(mark);
  const o = (1 - size) / 2;
  return (
    <svg className="mark" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g transform={`translate(${o} ${o}) scale(${size})`}>
        {sh.kind === 'lines' &&
          sh.pts.map((pts, i) => (
            <polyline
              key={i}
              points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        {sh.kind === 'circle' && <circle cx={sh.cx} cy={sh.cy} r={sh.r} fill={color} />}
        {sh.kind === 'rect' && <rect x={sh.x} y={sh.y} width={sh.w} height={sh.h} fill={color} />}
        {sh.kind === 'path' && (
          // Bold adds an outline so the filled stroke reads heavier.
          <path d={sh.d} fill={color} stroke={stroke > 0.14 ? color : 'none'} strokeWidth={0.05} strokeLinejoin="round" />
        )}
      </g>
    </svg>
  );
}
