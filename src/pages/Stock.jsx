import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { adjustStock, currentQty, lastPurchaseAt, productStock, stockValue } from '../lib/db';
import { formatFCFA, roundFCFA } from '../lib/money';
import { formatQty, stockUnitLabel, toBase, unitsForBase } from '../lib/units';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, Modal, PageTitle,
  StatCard, TableWrap, inputClass, td, th
} from '../components/ui';

export default function Stock() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [tab, setTab] = useState('raw');
  const [adjust, setAdjust] = useState(null);
  const [adjForm, setAdjForm] = useState({ qty: '', unit: 'g', reason: 'ajustement', note: '' });
  const [error, setError] = useState('');

  // Lignes du tableau : la SEULE source des cartes de synthèse ci-dessous.
  // Jamais de champ agrégé mis en cache séparément (anomalie n°2).
  const rawRows = useMemo(
    () =>
      s.ingredients.map((i) => ({
        ingredient: i,
        qty: currentQty(s, i.id),
        value: stockValue(s, i),
        lastPurchase: lastPurchaseAt(s, i.id)
      })),
    [s]
  );

  const totalValue = roundFCFA(rawRows.reduce((sum, r) => sum + r.value, 0));
  const alertCount = rawRows.filter((r) => r.qty <= r.ingredient.minThreshold).length;

  const finishedRows = useMemo(
    () =>
      s.products.map((p) => {
        const stock = productStock(s, p.id);
        return { product: p, stock, potential: roundFCFA(stock * p.sellingPrice) };
      }),
    [s]
  );

  const submitAdjust = (e) => {
    e.preventDefault();
    setError('');
    try {
      const changeBase = toBase(Number(adjForm.qty), adjForm.unit, adjust.baseUnit);
      adjustStock({
        ingredientId: adjust.id,
        changeBase,
        reason: adjForm.reason,
        note: adjForm.note,
        author: user.email
      });
      setAdjust(null);
    } catch (err) {
      setError(t(err.message) === err.message ? err.message : t(err.message));
    }
  };

  return (
    <div>
      <PageTitle>{t('stock.title')}</PageTitle>

      <div className="mb-4 flex gap-1 rounded-lg bg-stone-100 p-1 text-sm font-medium sm:w-fit">
        {['raw', 'finished'].map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`flex-1 rounded-md px-4 py-1.5 sm:flex-none ${tab === x ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'}`}
          >
            {t(x === 'raw' ? 'stock.rawTab' : 'stock.finishedTab')}
          </button>
        ))}
      </div>

      {tab === 'raw' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={t('stock.totalValue')} tip={t('stock.totalValueTip')} value={formatFCFA(totalValue, locale)} tone="brand" />
            <StatCard label={t('stock.refCount')} value={rawRows.length} />
            <StatCard label={t('stock.alertCount')} value={alertCount} tone={alertCount > 0 ? 'bad' : 'good'} />
          </div>
          <div className="my-3">
            <InfoNote>{t('stock.consistencyNote')}</InfoNote>
          </div>
          <Card>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>{t('ingredients.name')}</th>
                  <th className={th}>{t('ingredients.stock')}</th>
                  <th className={th}>{t('ingredients.threshold')}</th>
                  <th className={th}>{t('ingredients.unitCostShort')}</th>
                  <th className={th}>{t('stock.value')}</th>
                  <th className={th}>{t('stock.lastPurchase')}</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rawRows.map(({ ingredient: i, qty, value, lastPurchase }) => (
                  <tr key={i.id} className="hover:bg-stone-50">
                    <td className={`${td} font-medium`}>
                      {i.name}
                      {qty <= i.minThreshold && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge tone={qty <= 0 ? 'danger' : 'warning'}>{t('ingredients.lowBadge')}</Badge>
                        </span>
                      )}
                    </td>
                    <td className={td}>{formatQty(qty, i.baseUnit, locale)}</td>
                    <td className={td}>{formatQty(i.minThreshold, i.baseUnit, locale)}</td>
                    <td className={td}>{formatFCFA(i.unitCost, locale)} / {stockUnitLabel(i.baseUnit)}</td>
                    <td className={`${td} font-medium`}>{formatFCFA(value, locale)}</td>
                    <td className={td}>
                      {lastPurchase
                        ? new Date(lastPurchase).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'short' })
                        : '—'}
                    </td>
                    <td className={td}>
                      <button
                        onClick={() => {
                          setError('');
                          setAdjForm({ qty: '', unit: i.baseUnit, reason: 'ajustement', note: '' });
                          setAdjust(i);
                        }}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {t('stock.adjust')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </>
      ) : (
        <Card>
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <th className={th}>{t('products.name')}</th>
                <th className={th}>{t('stock.finishedUnits')}</th>
                <th className={th}>{t('products.price')}</th>
                <th className={th}>{t('stock.potentialRevenue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {finishedRows.map(({ product, stock, potential }) => (
                <tr key={product.id} className="hover:bg-stone-50">
                  <td className={`${td} font-medium`}>
                    {product.name}
                    {stock <= 0 && (
                      <span className="ml-2 inline-block align-middle">
                        <Badge tone="danger">{t('stock.outOfStock')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className={td}>{stock}</td>
                  <td className={td}>{formatFCFA(product.sellingPrice, locale)}</td>
                  <td className={`${td} font-medium`}>{formatFCFA(potential, locale)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {adjust && (
        <Modal title={t('stock.adjustTitle', { name: adjust.name })} onClose={() => setAdjust(null)}>
          <form onSubmit={submitAdjust} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('stock.adjustQty')}>
                <input type="number" step="any" className={inputClass} value={adjForm.qty} onChange={(e) => setAdjForm({ ...adjForm, qty: e.target.value })} required />
              </Field>
              <Field label={t('common.unit')}>
                <select className={inputClass} value={adjForm.unit} onChange={(e) => setAdjForm({ ...adjForm, unit: e.target.value })}>
                  {unitsForBase(adjust.baseUnit).map((u) => (
                    <option key={u} value={u}>{u === 'unite' ? 'unité' : u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t('stock.adjustReason')}>
              <select className={inputClass} value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}>
                <option value="ajustement">{t('reason.ajustement')}</option>
                <option value="perte">{t('reason.perte')}</option>
              </select>
            </Field>
            <Field label={`${t('common.note')} (${t('common.optional')})`}>
              <input className={inputClass} value={adjForm.note} onChange={(e) => setAdjForm({ ...adjForm, note: e.target.value })} />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdjust(null)}>{t('common.cancel')}</Button>
              <Button type="submit">{t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
