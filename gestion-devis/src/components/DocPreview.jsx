import { useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Button } from './ui';

// Aperçu intégré d'un document (devis ou reçu) rendu dans un <iframe srcdoc>.
// Aucune fenêtre popup n'est ouverte : l'aperçu fonctionne partout (y compris
// en démonstration embarquée / avec un bloqueur de pop-up). Le bouton
// « Imprimer » déclenche l'impression du seul document (→ « Enregistrer en
// PDF » ou partage en image selon l'appareil).
export default function DocPreview({ html, title, onClose }) {
  const { t } = useI18n();
  const frameRef = useRef(null);

  const print = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      /* environnement restreint : le document reste visible et capturable */
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/60">
      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 shadow">
        <span className="truncate text-sm font-semibold text-stone-800">{title}</span>
        <div className="flex flex-none gap-2">
          <Button onClick={print} className="px-3 py-1.5 text-xs">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-4a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2h-2M6 14h12v8H6z" />
            </svg>
            {t('doc.print')}
          </Button>
          <Button variant="secondary" onClick={onClose} className="px-3 py-1.5 text-xs">{t('common.close')}</Button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        title={title}
        srcDoc={html}
        className="min-h-0 flex-1 bg-white"
      />
      <p className="bg-white/90 px-3 py-1.5 text-center text-[11px] text-stone-500">{t('doc.hint')}</p>
    </div>
  );
}
