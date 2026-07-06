import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import {
  CATEGORIES, deleteProduct, productStock, recipeFor, saveProduct, saveRecipe
} from '../lib/db';
import { formatFCFA, roundFCFA } from '../lib/money';
import { UNIT_DEFS, formatQty, stockUnitFactor, toBase, unitsForBase } from '../lib/units';
import {
  Badge, Button, Card, ErrorNote, Field, Modal, PageTitle, inputClass
} from '../components/ui';

// Garde-fou recette (anomalie n°9) : au-delà de ce seuil PAR UNITÉ produite,
// la quantité est probablement une erreur d'unité (1 kg de glaçage pour une
// baguette au lieu de 1 g).
const SUSPICIOUS_BASE_QTY = 1000; // 1 kg / 1 L par unité de produit fini

function materialCost(s, productId) {
  let total = 0;
  for (const r of recipeFor(s, productId)) {
    const ing = s.ingredients.find((i) => i.id === r.ingredientId);
    if (!ing) continue;
    total += (r.qtyBase / stockUnitFactor(ing.baseUnit)) * ing.unitCost;
  }
  return roundFCFA(total);
}

function RecipeEditor({ s, product, onClose }) {
  const { t, locale } = useI18n();
  const [lines, setLines] = useState(() =>
    recipeFor(s, product.id).map((r) => {
      const ing = s.ingredients.find((i) => i.id === r.ingredientId);
      return { ingredientId: r.ingredientId, qty: String(r.qtyBase), unit: ing?.baseUnit || 'g' };
    })
  );
  const [error, setError] = useState('');

  const setLine = (idx, patch) => {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const parsed = useMemo(() => {
    return lines.map((l) => {
      const ing = s.ingredients.find((i) => i.id === l.ingredientId);
      if (!ing) return { ...l, ingredient: null, qtyBase: 0 };
      let qtyBase = 0;
      try {
        qtyBase = toBase(Number(l.qty) || 0, l.unit, ing.baseUnit);
      } catch {
        qtyBase = 0;
      }
      return { ...l, ingredient: ing, qtyBase };
    });
  }, [lines, s]);

  const warnings = parsed.filter(
    (l) => l.ingredient && l.ingredient.type === 'matiere_premiere' && l.qtyBase > SUSPICIOUS_BASE_QTY
  );

  const estimate = roundFCFA(
    parsed.reduce((sum, l) => {
      if (!l.ingredient) return sum;
      return sum + (l.qtyBase / stockUnitFactor(l.ingredient.baseUnit)) * l.ingredient.unitCost;
    }, 0)
  );

  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveRecipe(
        product.id,
        parsed.filter((l) => l.ingredient).map((l) => ({ ingredientId: l.ingredientId, qtyBase: l.qtyBase }))
      );
      onClose();
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('products.recipeFor', { name: product.name })} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          {parsed.map((line, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2">
              <select
                className={`${inputClass} flex-1 min-w-[10rem]`}
                value={line.ingredientId}
                onChange={(e) => {
                  const ing = s.ingredients.find((i) => i.id === e.target.value);
                  setLine(idx, { ingredientId: e.target.value, unit: ing?.baseUnit || 'g' });
                }}
                required
              >
                <option value="">—</option>
                {s.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                min="0"
                className={`${inputClass} w-24`}
                value={line.qty}
                onChange={(e) => setLine(idx, { qty: e.target.value })}
                required
              />
              <select
                className={`${inputClass} w-24`}
                value={line.unit}
                onChange={(e) => setLine(idx, { unit: e.target.value })}
              >
                {(line.ingredient ? unitsForBase(line.ingredient.baseUnit) : Object.keys(UNIT_DEFS)).map((u) => (
                  <option key={u} value={u}>{u === 'unite' ? 'unité' : u}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                aria-label={t('common.delete')}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={() => setLines([...lines, { ingredientId: '', qty: '', unit: 'g' }])}>
          + {t('products.addLine')}
        </Button>

        {warnings.map((w) => (
          <p key={w.ingredientId} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('products.recipeWarning', {
              name: w.ingredient.name,
              qty: formatQty(w.qtyBase, w.ingredient.baseUnit, locale)
            })}
          </p>
        ))}

        <p className="text-sm text-stone-600">
          {t('products.unitCostEstimate')} : <span className="font-semibold">{formatFCFA(estimate, locale)}</span>
        </p>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Products() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [modal, setModal] = useState(null); // null | 'new' | product
  const [recipeModal, setRecipeModal] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');

  const open = (p) => {
    setError('');
    setForm(p ? { name: p.name, category: p.category, sellingPrice: p.sellingPrice } : { name: '', category: 'pain', sellingPrice: '' });
    setModal(p || 'new');
  };

  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveProduct({
        id: modal === 'new' ? undefined : modal.id,
        name: form.name,
        category: form.category,
        sellingPrice: Number(form.sellingPrice) || 0
      });
      setModal(null);
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try {
      await deleteProduct(p.id);
    } catch (err) {
      window.alert(t(err.message));
    }
  };

  return (
    <div>
      <PageTitle actions={<Button onClick={() => open(null)}>+ {t('products.add')}</Button>}>
        {t('products.title')}
      </PageTitle>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {s.products.map((p) => {
          const recipe = recipeFor(s, p.id);
          const cost = materialCost(s, p.id);
          const stock = productStock(s, p.id);
          return (
            <Card key={p.id} className="flex flex-col p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-stone-900">{p.name}</h3>
                  {/* Catégorie : libellé issu d'une liste fermée, traduit via
                      fichiers statiques — jamais automatiquement (n°10). */}
                  <Badge tone="brand">{t(`category.${p.category}`)}</Badge>
                </div>
                <p className="text-right">
                  <span className="block text-lg font-bold text-stone-900">{formatFCFA(p.sellingPrice, locale)}</span>
                  <span className="text-xs text-stone-500">{t('products.price')}</span>
                </p>
              </div>

              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                <span>
                  {t('products.recipe')} :{' '}
                  {recipe.length === 0 ? (
                    <span className="text-amber-700">{t('products.noRecipe')}</span>
                  ) : (
                    t('products.recipeLines', { count: recipe.length })
                  )}
                </span>
                <span>
                  {t('products.unitCostEstimate')} : <strong>{formatFCFA(cost, locale)}</strong>
                </span>
                <span>
                  {t('products.stock')} : <strong>{stock}</strong>
                </span>
              </div>

              {recipe.length > 0 && (
                <ul className="mb-3 space-y-0.5 text-xs text-stone-500">
                  {recipe.map((r) => {
                    const ing = s.ingredients.find((i) => i.id === r.ingredientId);
                    if (!ing) return null;
                    return (
                      <li key={r.id}>
                        • {ing.name} — {formatQty(r.qtyBase, ing.baseUnit, locale)}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-auto flex gap-2 border-t border-stone-100 pt-3">
                <Button variant="secondary" className="flex-1" onClick={() => setRecipeModal(p)}>
                  {t('products.editRecipe')}
                </Button>
                <Button variant="secondary" onClick={() => open(p)}>{t('common.edit')}</Button>
                <Button variant="danger" onClick={() => remove(p)}>{t('common.delete')}</Button>
              </div>
            </Card>
          );
        })}
      </div>

      {modal && (
        <Modal title={modal === 'new' ? t('products.add') : t('products.edit')} onClose={() => setModal(null)}>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('products.name')}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t('products.category')}>
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`category.${c}`)}</option>
                ))}
              </select>
            </Field>
            <Field label={`${t('products.price')} (FCFA)`}>
              <input type="number" step="1" min="0" className={inputClass} value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} required />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {recipeModal && <RecipeEditor s={s} product={recipeModal} onClose={() => setRecipeModal(null)} />}
    </div>
  );
}
