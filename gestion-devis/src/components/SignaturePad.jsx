import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

// Zone de signature au doigt / à la souris (section « Finalisation » et
// « Paiement » du cahier des charges). Le tracé est capturé sur un <canvas>
// puis exporté en image PNG (data URL) via onChange, ce qui permet de le
// stocker en base et de le joindre au reçu / à l'e-mail administrateur.
//
// Conçu mobile-first : les événements « pointer » couvrent tactile + souris,
// et `touch-action: none` empêche le défilement de la page pendant le tracé.
export default function SignaturePad({ label, onChange, height = 160 }) {
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Adapte la résolution interne à la largeur réelle (netteté sur écrans HiDPI)
  // sans perdre le tracé existant.
  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const snapshot = hasInk.current ? canvas.toDataURL() : null;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1c1917';
      if (snapshot) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = snapshot;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [height]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setEmpty(true);
    onChange?.('');
  };

  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-stone-700">{label}</span>
          {!empty && (
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-stone-500 hover:text-red-600"
            >
              {t('devis.clearSignature')}
            </button>
          )}
        </div>
      )}
      <div className="relative overflow-hidden rounded-lg border border-stone-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none' }}
          className="block w-full cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-stone-400">
            {t('devis.signHere')}
          </span>
        )}
      </div>
    </div>
  );
}
