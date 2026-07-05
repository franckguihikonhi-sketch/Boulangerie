import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { inPeriod } from '../lib/reports';
import { formatFCFA } from '../lib/money';
import { formatQty } from '../lib/units';
import { Badge, Card, PageTitle, TableWrap, inputClass, td, th } from '../components/ui';

// Historique (section 5.7) : deux vues (productions / mouvements), chaque
// ligne porte son identifiant unique pour repérer immédiatement un doublon,
// et un filtre par période et par produit.
export default function History() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState('productions');
  const [productFilter, setProductFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const productions = useMemo(
    () =>
      [...s.productions]
        .filter((p) => !productFilter || p.productId === productFilter)
        .filter((p) => inPeriod(p.producedAt, from || null, to || null))
        .sort((a, b) => b.producedAt.localeCompare(a.producedAt)),
    [s, productFilter, from, to]
  );

  const movements = useMemo(
    () =>
      [...s.stockMovements]
        .filter((m) => inPeriod(m.createdAt, from || null, to || null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200),
    [s, from, to]
  );

  const reasonTone = { achat: 'success', production: 'brand', ajustement: 'neutral', perte: 'danger' };

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

  return (
    <div>
      <PageTitle>{t('history.title')}</PageTitle>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm font-medium">
          {['productions', 'movements'].map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`rounded-md px-4 py-1.5 ${tab === x ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'}`}
            >
              {t(x === 'productions' ? 'history.productions' : 'history.movements')}
            </button>
          ))}
        </div>
        {tab === 'productions' && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-500">{t('history.filterProduct')}</span>
            <select className={`${inputClass} w-44`} value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">{t('common.all')}</option>
              {s.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-500">{t('common.from')}</span>
          <input type="date" className={`${inputClass} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-500">{t('common.to')}</span>
          <input type="date" className={`${inputClass} w-40`} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <Card>
        {tab === 'productions' ? (
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <th className={th}>{t('common.date')}</th>
                <th className={th}>{t('history.product')}</th>
                <th className={th}>{t('common.quantity')}</th>
                <th className={th}>{t('history.cost')}</th>
                <th className={th}>{t('history.author')}</th>
                <th className={th}>{t('history.id')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {productions.map((p) => {
                const product = s.products.find((x) => x.id === p.productId);
                return (
                  <tr key={p.id} className="hover:bg-stone-50">
                    <td className={td}>{fmtDate(p.producedAt)}</td>
                    <td className={`${td} font-medium`}>{product?.name || '?'}</td>
                    <td className={td}>× {p.quantityProduced}</td>
                    <td className={td}>{formatFCFA(p.totalCost, locale)}</td>
                    <td className={td}>{p.author || '—'}</td>
                    <td className={`${td} font-mono text-[11px] text-stone-400`}>{p.id.slice(0, 8)}</td>
                  </tr>
                );
              })}
              {productions.length === 0 && (
                <tr><td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td></tr>
              )}
            </tbody>
          </TableWrap>
        ) : (
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <th className={th}>{t('common.date')}</th>
                <th className={th}>{t('purchases.ingredient')}</th>
                <th className={th}>{t('history.change')}</th>
                <th className={th}>{t('history.reason')}</th>
                <th className={th}>{t('history.author')}</th>
                <th className={th}>{t('history.id')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {movements.map((m) => {
                const ing = s.ingredients.find((i) => i.id === m.ingredientId);
                return (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className={td}>{fmtDate(m.createdAt)}</td>
                    <td className={`${td} font-medium`}>{ing?.name || '?'}</td>
                    <td className={`${td} font-medium ${m.changeBase >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {m.changeBase >= 0 ? '+' : '−'}
                      {formatQty(Math.abs(m.changeBase), ing?.baseUnit || 'g', locale)}
                    </td>
                    <td className={td}>
                      <Badge tone={reasonTone[m.reason] || 'neutral'}>{t(`reason.${m.reason}`)}</Badge>
                    </td>
                    <td className={td}>{m.author || '—'}</td>
                    <td className={`${td} font-mono text-[11px] text-stone-400`}>{m.id.slice(0, 8)}</td>
                  </tr>
                );
              })}
              {movements.length === 0 && (
                <tr><td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td></tr>
              )}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
