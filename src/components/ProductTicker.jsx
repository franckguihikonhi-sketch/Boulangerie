import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { productStock } from '../lib/db';

// Seuil d'alerte du stock de produits finis : la pastille passe au rouge dès
// qu'il reste STRICTEMENT MOINS que ce nombre d'unités. Modifiable ici.
const SEUIL_ALERTE = 10;

// Bandeau défilant façon « ticker » : la liste de tous les produits actifs
// défile en continu. Écriture en noir ; une pastille indique l'état du stock
// du produit fini — verte quand le stock est suffisant, rouge quand il reste
// moins de SEUIL_ALERTE unités. Animation 100 % CSS (aucun timer, aucune requête).
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
    half.map((p, i) => {
      const alert = productStock(s, p.id) < SEUIL_ALERTE; // moins de X unités = alerte
      return (
        <span key={`${prefix}-${i}-${p.id}`} className="mx-5 inline-flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 flex-none rounded-full ${alert ? 'bg-red-500' : 'bg-green-500'}`}
          />
          <span className="font-semibold text-stone-900">{p.name}</span>
          <span className="text-stone-600">{formatFCFA(p.sellingPrice, locale)}</span>
        </span>
      );
    });

  return (
    <div className="product-ticker mb-4 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 py-2 text-sm text-stone-900">
      <div className="product-ticker__track" aria-hidden="true">
        {renderHalf('a')}
        {renderHalf('b')}
      </div>
    </div>
  );
}
