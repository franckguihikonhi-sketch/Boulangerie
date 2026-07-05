import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { consumptionByIngredient, dayKey, financialSummary, perProductReport } from '../lib/reports';
import { formatFCFA } from '../lib/money';
import { formatQty } from '../lib/units';
import { Card, InfoNote, PageTitle, StatCard, TableWrap, inputClass, td, th } from '../components/ui';

// Rapports (section 5.10) : trois notions strictement séparées —
// Chiffre d'affaires, Dépenses (trésorerie) et COGS. Seul le COGS est opposé
// au CA pour la marge ; jamais de pourcentage extrême (anomalie n°6).
export default function Reports() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(() => dayKey(new Date(Date.now() - 6 * 86400000).toISOString()));
  const [to, setTo] = useState(() => dayKey(new Date().toISOString()));

  const fin = useMemo(() => financialSummary(s, from || null, to || null), [s, from, to]);
  const perProduct = useMemo(() => perProductReport(s, from || null, to || null), [s, from, to]);
  const consumption = useMemo(() => consumptionByIngredient(s, from || null, to || null), [s, from, to]);

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-500">{t('common.from')}</span>
              <input type="date" className={`${inputClass} w-40`} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-500">{t('common.to')}</span>
              <input type="date" className={`${inputClass} w-40`} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        }
      >
        {t('reports.title')}
      </PageTitle>

      <h2 className="mb-3 text-sm font-semibold text-stone-900">{t('reports.financial')}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('reports.revenue')} value={formatFCFA(fin.revenue, locale)} tone="brand" />
        <StatCard label={t('reports.expenses')} tip={t('reports.expensesTip')} value={formatFCFA(fin.expenses, locale)} />
        <StatCard label={t('reports.cogs')} tip={t('reports.cogsTip')} value={formatFCFA(fin.cogs, locale)} />
        <StatCard
          label={t('reports.margin')}
          tip={t('reports.marginTip')}
          value={fin.marginPct === null ? t('common.na') : `${fin.marginPct.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')} %`}
          tone={fin.marginPct === null ? 'default' : fin.marginPct >= 0 ? 'good' : 'bad'}
          sub={`${t('dashboard.grossMargin')} : ${formatFCFA(fin.grossMargin, locale)}`}
        />
      </div>

      <Card className="mt-5">
        <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
          {t('reports.byProduct')}
        </h2>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('history.product')}</th>
              <th className={th}>{t('reports.unitsSold')}</th>
              <th className={th}>{t('reports.unitsProduced')}</th>
              <th className={th}>{t('reports.revenue')}</th>
              <th className={th}>{t('reports.cogs')}</th>
              <th className={th}>{t('reports.profit')}</th>
              <th className={th}>{t('reports.margin')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {perProduct.map((r) => (
              <tr key={r.product.id} className="hover:bg-stone-50">
                <td className={`${td} font-medium`}>{r.product.name}</td>
                <td className={td}>{r.unitsSold}</td>
                <td className={td}>{r.unitsProduced}</td>
                <td className={td}>{formatFCFA(r.revenue, locale)}</td>
                <td className={td}>{formatFCFA(r.cogs, locale)}</td>
                <td className={`${td} font-medium ${r.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatFCFA(r.profit, locale)}
                </td>
                <td className={td}>
                  {r.marginPct === null
                    ? t('common.na')
                    : `${r.marginPct.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')} %`}
                </td>
              </tr>
            ))}
            {perProduct.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="7">{t('common.empty')}</td></tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <Card className="mt-5">
        <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
          {t('reports.consumption')}
        </h2>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('purchases.ingredient')}</th>
              <th className={th}>{t('reports.consumed')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {consumption.map((r) => (
              <tr key={r.ingredient.id} className="hover:bg-stone-50">
                <td className={`${td} font-medium`}>{r.ingredient.name}</td>
                <td className={td}>{formatQty(r.consumedBase, r.ingredient.baseUnit, locale)}</td>
              </tr>
            ))}
            {consumption.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="2">{t('common.empty')}</td></tr>
            )}
          </tbody>
        </TableWrap>
        <p className="border-t border-stone-100 px-4 py-2.5 text-xs text-stone-500">
          {t('reports.consumptionNote')}
        </p>
      </Card>
    </div>
  );
}
