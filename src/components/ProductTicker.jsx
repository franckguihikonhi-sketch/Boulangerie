import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';

// Bandeau défilant façon « ticker » : la liste de tous les produits actifs
// défile en continu, en rouge. Animation 100 % CSS (aucun timer, aucune
// requête) : sans impact sur les performances de l'application.
export default function ProductTicker() {
  const s = useStore();
  const { locale } = useI18n();

  const products = s.products.filter((p) => p.isActive !== false);
  if (products.length === 0) return null;

  // On répète la liste pour qu'une « moitié » de la piste soit toujours plus
  // large que l'écran, puis on la duplique : le glissement de -50 % boucle
  // alors sans coupure visible.
  const times = Math.max(1, Math.ceil(14 / products.length));
  const half = Array.from({ length: times }).flatMap(() => products);

  const renderHalf = (prefix) =>
    half.map((p, i) => (
      <span key={`${prefix}-${i}-${p.id}`} className="mx-5 inline-flex items-center gap-2">
        <span aria-hidden="true">🔴</span>
        <span className="font-semibold">{p.name}</span>
        <span className="text-red-400">{formatFCFA(p.sellingPrice, locale)}</span>
      </span>
    ));

  return (
    <div className="product-ticker mb-4 overflow-hidden rounded-lg border border-red-200 bg-red-50 py-2 text-sm text-red-600">
      <div className="product-ticker__track" aria-hidden="true">
        {renderHalf('a')}
        {renderHalf('b')}
      </div>
    </div>
  );
}
