import { useState } from 'react';

// Petit graphique à barres SVG : UNE mesure, UN axe. Deux mesures d'échelles
// différentes (CA en FCFA / unités produites) = deux graphiques empilés sur
// le même référentiel de dates — jamais un double axe (anomalie n°14).
//
// Couleurs issues de la palette validée (dataviz) ; barres fines à sommet
// arrondi ancrées à la ligne de base, grille discrète, libellés sélectifs
// (pic + dernier point) et info-bulle au survol.
export default function BarChart({ data, color = '#2a78d6', formatValue, height = 180 }) {
  const [hover, setHover] = useState(null);

  const width = 640;
  const pad = { top: 24, right: 8, bottom: 24, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const maxIdx = data.findIndex((d) => d.value === Math.max(...data.map((x) => x.value)));

  const slot = innerW / data.length;
  const barW = Math.min(36, slot * 0.55);

  const gridLines = [0.25, 0.5, 0.75, 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((g) => (
          <line
            key={g}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * (1 - g)}
            y2={pad.top + innerH * (1 - g)}
            stroke="#e1e0d9"
            strokeWidth="1"
          />
        ))}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + innerH}
          y2={pad.top + innerH}
          stroke="#c3c2b7"
          strokeWidth="1"
        />
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * innerH);
          const x = pad.left + slot * i + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          const isHover = hover === i;
          const showLabel = i === maxIdx || i === data.length - 1 || isHover;
          return (
            <g key={d.label}>
              {/* zone de survol plus large que la barre */}
              <rect
                x={pad.left + slot * i}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 2)}
                rx="4"
                ry="4"
                fill={color}
                opacity={hover === null || isHover ? 1 : 0.45}
                style={{ pointerEvents: 'none' }}
              />
              {/* masque le bas arrondi : la barre reste ancrée à la base */}
              <rect
                x={x}
                y={pad.top + innerH - Math.min(4, Math.max(h, 2))}
                width={barW}
                height={Math.min(4, Math.max(h, 2))}
                fill={color}
                opacity={hover === null || isHover ? 1 : 0.45}
                style={{ pointerEvents: 'none' }}
              />
              {showLabel && d.value > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#52514e"
                  style={{ pointerEvents: 'none' }}
                >
                  {formatValue ? formatValue(d.value) : d.value}
                </text>
              )}
              <text
                x={pad.left + slot * i + slot / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#898781"
                style={{ pointerEvents: 'none' }}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -top-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <span className="font-semibold text-stone-800">
            {formatValue ? formatValue(data[hover].value) : data[hover].value}
          </span>
          <span className="ml-1.5 text-stone-500">{data[hover].label}</span>
        </div>
      )}
    </div>
  );
}
