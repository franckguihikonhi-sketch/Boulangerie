import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { productionPreview, recordProduction, uid } from '../lib/db';
import { formatFCFA } from '../lib/money';
import { formatQty } from '../lib/units';
import {
  Button, Card, ErrorNote, Field, InfoNote, PageTitle, TableWrap, inputClass, td, th
} from '../components/ui';

export default function Production() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user, isAdmin } = useAuth();

  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [idemKey, setIdemKey] = useState(() => uid());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  // Aperçu avant validation : consommation par ingrédient, coût prévisionnel
  // (CMP courant), revenu et bénéfice prévus (section 5.4). Le même moteur
  // de calcul sert à figer le coût — aperçu et Historique sont identiques.
  const preview = useMemo(
    () => productionPreview(s, productId, Number(qty)),
    [s, productId, qty]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); // bouton désactivé dès le premier clic (anomalie n°4)
    setError('');
    setDone(null);
    const snapshot = { product: preview.product.name, qty: Number(qty), cost: preview.totalCost };
    try {
      await recordProduction({
        productId,
        quantity: Number(qty),
        note,
        idempotencyKey: idemKey,
        author: user.email
      });
      setDone(snapshot);
      setProductId('');
      setQty('');
      setNote('');
      setIdemKey(uid());
    } catch (err) {
      if (err.shortages) {
        setError(
          err.shortages
            .map((x) => t('production.missing', { name: x.name, qty: formatQty(x.missing, x.baseUnit, locale) }))
            .join(' ')
        );
      } else {
        setError(t(err.message) === err.message ? err.message : t(err.message));
      }
    } finally {
      setSaving(false);
    }
  };

  const recentProductions = [...s.productions]
    .sort((a, b) => b.producedAt.localeCompare(a.producedAt))
    .slice(0, 8);

  return (
    <div>
      <PageTitle>{t('production.title')}</PageTitle>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">{t('production.record')}</h2>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('production.product')}>
              <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">—</option>
                {s.products.filter((p) => p.isActive).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label={t('production.quantity')}>
              <input type="number" step="1" min="1" className={inputClass} value={qty} onChange={(e) => setQty(e.target.value)} required />
            </Field>
            <Field label={`${t('common.note')} (${t('common.optional')})`}>
              <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            {done && (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                ✓ {done.product} × {done.qty} — {formatFCFA(done.cost, locale)}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={saving || !preview || preview.lines.length === 0 || preview.shortages.length > 0}
            >
              {saving ? t('common.saving') : t('production.record')}
            </Button>
          </form>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-stone-900">{t('production.preview')}</h2>
            {!preview ? (
              <p className="text-sm text-stone-500">—</p>
            ) : preview.lines.length === 0 ? (
              <p className="text-sm text-amber-700">{t('production.noRecipe')}</p>
            ) : (
              <>
                <TableWrap>
                  <thead className="border-b border-stone-200">
                    <tr>
                      <th className={th}>{t('production.previewIngredient')}</th>
                      <th className={th}>{t('production.previewNeeded')}</th>
                      <th className={th}>{t('production.previewAvailable')}</th>
                      {isAdmin && <th className={th}>{t('production.previewCost')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {preview.lines.map((l) => {
                      const short = l.needed > l.available;
                      return (
                        <tr key={l.ingredient.id} className={short ? 'bg-red-50' : ''}>
                          <td className={`${td} font-medium`}>{l.ingredient.name}</td>
                          {/* Consommation affichée dans l'unité de base de
                              l'ingrédient : 0,5 g reste visible, jamais
                              masqué par un arrondi en kg (anomalie n°8). */}
                          <td className={`${td} ${short ? 'font-semibold text-red-700' : ''}`}>
                            {formatQty(l.needed, l.ingredient.baseUnit, locale)}
                          </td>
                          <td className={td}>{formatQty(l.available, l.ingredient.baseUnit, locale)}</td>
                          {isAdmin && <td className={td}>{formatFCFA(l.cost, locale)}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>

                {preview.shortages.map((x) => (
                  <p key={x.ingredient.id} className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {t('production.missing', {
                      name: x.ingredient.name,
                      qty: formatQty(x.missing, x.ingredient.baseUnit, locale)
                    })}
                  </p>
                ))}

                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 text-center">
                  {isAdmin && (
                    <div>
                      <p className="text-xs text-stone-500">{t('production.totalCost')}</p>
                      <p className="text-base font-bold text-stone-900">{formatFCFA(preview.totalCost, locale)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-stone-500">{t('production.expectedRevenue')}</p>
                    <p className="text-base font-bold text-stone-900">{formatFCFA(preview.revenue, locale)}</p>
                  </div>
                  {isAdmin && (
                    <div>
                      <p className="text-xs text-stone-500">{t('production.expectedProfit')}</p>
                      <p className={`text-base font-bold ${preview.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {formatFCFA(preview.profit, locale)}
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <InfoNote>{t('production.frozenNote')}</InfoNote>
                </div>
              </>
            )}
          </Card>

          <Card>
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
              {t('history.productions')}
            </h2>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>{t('common.date')}</th>
                  <th className={th}>{t('history.product')}</th>
                  <th className={th}>{t('common.quantity')}</th>
                  {isAdmin && <th className={th}>{t('history.cost')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {recentProductions.map((p) => {
                  const product = s.products.find((x) => x.id === p.productId);
                  return (
                    <tr key={p.id}>
                      <td className={td}>
                        {new Date(p.producedAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className={`${td} font-medium`}>{product?.name || '?'}</td>
                      <td className={td}>× {p.quantityProduced}</td>
                      {isAdmin && <td className={td}>{formatFCFA(p.totalCost, locale)}</td>}
                    </tr>
                  );
                })}
                {recentProductions.length === 0 && (
                  <tr><td className={`${td} text-stone-500`} colSpan={isAdmin ? 4 : 3}>{t('common.empty')}</td></tr>
                )}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      </div>
    </div>
  );
}
