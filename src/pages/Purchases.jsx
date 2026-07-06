import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { currentQty, deletePurchase, recordPurchase, uid } from '../lib/db';
import { formatFCFA, roundFCFA } from '../lib/money';
import { formatQty, stockUnitFactor, stockUnitLabel, toBase, unitsForBase } from '../lib/units';
import {
  Button, Card, ErrorNote, Field, InfoNote, PageTitle, TableWrap, inputClass, td, th
} from '../components/ui';

export default function Purchases() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [form, setForm] = useState({ ingredientId: '', qty: '', unit: 'kg', unitCost: '', supplier: '', note: '' });
  // Clé d'idempotence générée côté client, renouvelée après chaque succès :
  // une re-soumission (double clic, réseau) réutilise la même clé et le
  // serveur ne crée rien de nouveau (anomalies n°4 et 5).
  const [idemKey, setIdemKey] = useState(() => uid());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ingredient = s.ingredients.find((i) => i.id === form.ingredientId);

  // Prévisualisation du CMP après achat (formule section 6).
  const cmpPreview = useMemo(() => {
    if (!ingredient || !(Number(form.qty) > 0) || !(Number(form.unitCost) >= 0)) return null;
    let qtyBase;
    try {
      qtyBase = toBase(Number(form.qty), form.unit, ingredient.baseUnit);
    } catch {
      return null;
    }
    const factor = stockUnitFactor(ingredient.baseUnit);
    const before = currentQty(s, ingredient.id) / factor;
    const bought = qtyBase / factor;
    const denominator = before + bought;
    if (denominator <= 0) return null;
    return roundFCFA((before * ingredient.unitCost + bought * Number(form.unitCost)) / denominator);
  }, [s, ingredient, form.qty, form.unit, form.unitCost]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); // bouton désactivé dès le premier clic (section 5.3)
    setError('');
    try {
      const qtyBase = toBase(Number(form.qty), form.unit, ingredient.baseUnit);
      recordPurchase({
        ingredientId: form.ingredientId,
        qtyBase,
        unitCost: Number(form.unitCost),
        supplier: form.supplier,
        note: form.note,
        idempotencyKey: idemKey,
        author: user.email
      });
      setForm({ ingredientId: '', qty: '', unit: 'kg', unitCost: '', supplier: '', note: '' });
      setIdemKey(uid());
    } catch (err) {
      setError(t(err.message) === err.message ? err.message : t(err.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try {
      await deletePurchase(p.id);
    } catch (err) {
      // Message explicite : « Stock déjà consommé en production… » (n°12)
      window.alert(t(err.message) === err.message ? err.message : t(err.message));
    }
  };

  const purchases = [...s.purchases].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));

  return (
    <div>
      <PageTitle>{t('purchases.title')}</PageTitle>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          {/* Libellé fixe issu de fr.json/en.json — jamais « Économisez un
              achat » issu d'une traduction automatique (anomalie n°11). */}
          <h2 className="mb-4 text-sm font-semibold text-stone-900">{t('purchases.record')}</h2>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('purchases.ingredient')}>
              <select
                className={inputClass}
                value={form.ingredientId}
                onChange={(e) => {
                  const ing = s.ingredients.find((i) => i.id === e.target.value);
                  const units = ing ? unitsForBase(ing.baseUnit) : ['kg'];
                  setForm({ ...form, ingredientId: e.target.value, unit: units.includes('kg') ? 'kg' : units[0] });
                }}
                required
              >
                <option value="">—</option>
                {s.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('common.quantity')}>
                <input type="number" step="any" min="0" className={inputClass} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required />
              </Field>
              <Field label={t('common.unit')}>
                <select className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {(ingredient ? unitsForBase(ingredient.baseUnit) : ['kg', 'g', 'L', 'ml', 'unite']).map((u) => (
                    <option key={u} value={u}>{u === 'unite' ? 'unité' : u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('purchases.unitCost', { unit: ingredient ? stockUnitLabel(ingredient.baseUnit) : 'kg' })}>
              <input type="number" step="1" min="0" className={inputClass} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required />
            </Field>
            <Field label={`${t('purchases.supplier')} (${t('common.optional')})`}>
              <input className={inputClass} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            </Field>
            <Field label={`${t('common.note')} (${t('common.optional')})`}>
              <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {cmpPreview !== null && (
              <p className="text-sm text-stone-600">
                {t('purchases.cmpPreview', { cmp: `${formatFCFA(cmpPreview, locale)} / ${stockUnitLabel(ingredient.baseUnit)}` })}
              </p>
            )}
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="w-full" disabled={saving || !form.ingredientId}>
              {saving ? t('common.saving') : t('purchases.record')}
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-3">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
              {t('purchases.history')}
            </h2>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>{t('common.date')}</th>
                  <th className={th}>{t('purchases.ingredient')}</th>
                  <th className={th}>{t('common.quantity')}</th>
                  <th className={th}>{t('ingredients.unitCostShort')}</th>
                  <th className={th}>{t('purchases.totalCost')}</th>
                  <th className={th}>{t('purchases.supplier')}</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {purchases.map((p) => {
                  const ing = s.ingredients.find((i) => i.id === p.ingredientId);
                  if (!ing) return null;
                  return (
                    <tr key={p.id} className="hover:bg-stone-50">
                      <td className={td}>
                        {new Date(p.purchasedAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className={`${td} font-medium`}>{ing.name}</td>
                      <td className={td}>{formatQty(p.qtyBase, ing.baseUnit, locale)}</td>
                      <td className={td}>{formatFCFA(p.unitCost, locale)} / {stockUnitLabel(ing.baseUnit)}</td>
                      <td className={`${td} font-medium`}>{formatFCFA(p.totalCost, locale)}</td>
                      <td className={td}>{p.supplier || '—'}</td>
                      <td className={td}>
                        <button onClick={() => remove(p)} className="text-sm font-medium text-red-600 hover:underline">
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {purchases.length === 0 && (
                  <tr><td className={`${td} text-stone-500`} colSpan="7">{t('common.empty')}</td></tr>
                )}
              </tbody>
            </TableWrap>
          </Card>
          <div className="mt-3">
            <InfoNote>{t('purchases.deleteInfo')}</InfoNote>
          </div>
        </div>
      </div>
    </div>
  );
}
