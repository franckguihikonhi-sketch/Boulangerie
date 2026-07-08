import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { financialSummary, last7DaysSeries, isTestName, dayKey } from '../lib/reports';
import { currentQty } from '../lib/db';
import { formatFCFA } from '../lib/money';
import { formatQty } from '../lib/units';
import BarChart from '../components/BarChart';
import ProductTicker from '../components/ProductTicker';
import { Badge, Card, InfoNote, PageTitle, StatCard } from '../components/ui';

const PERIODS = { today: 0, week: 6, month: 29 };

export default function Dashboard() {
  const s = useStore();
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState('week');

  const from = useMemo(() => {
    const d = new Date(Date.now() - PERIODS[period] * 86400000);
    return dayKey(d.toISOString());
  }, [period]);

  const fin = useMemo(() => financialSummary(s, from, null), [s, from]);
  const series = useMemo(() => last7DaysSeries(s), [s]);

  const topProducts = useMemo(() => {
    const byProduct = new Map();
    for (const p of s.productions) {
      const product = s.products.find((x) => x.id === p.productId);
      if (!product || isTestName(product.name)) continue;
      byProduct.set(product.id, {
        product,
        units: (byProduct.get(product.id)?.units || 0) + p.quantityProduced
      });
    }
    return [...byProduct.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  }, [s]);

  const lowStock = useMemo(
    () =>
      s.ingredients
        .map((i) => ({ ingredient: i, qty: currentQty(s, i.id) }))
        .filter((x) => x.qty <= x.ingredient.minThreshold),
    [s]
  );

  const dayLabel = (k) =>
    new Date(`${k}T12:00:00Z`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      day: 'numeric'
    });

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs font-medium">
            {Object.keys(PERIODS).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 ${period === p ? 'bg-brand-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
              >
                {t(p === 'today' ? 'common.today' : p === 'week' ? 'common.thisWeek' : 'common.thisMonth')}
              </button>
            ))}
          </div>
        }
      >
        {t('dashboard.title')}
      </PageTitle>

      {/* Bandeau défilant de tous les produits (rouge, continu). */}
      <ProductTicker />

      {/* Indicateurs financiers : chaque carte porte sa formule en info-bulle
          (anomalie n°15 : deux vérités financières, désormais expliquées). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('dashboard.revenue')} tip={t('dashboard.revenueTip')} value={formatFCFA(fin.revenue, locale)} tone="brand" />
        <StatCard label={t('dashboard.expenses')} tip={t('dashboard.expensesTip')} value={formatFCFA(fin.expenses, locale)} />
        <StatCard label={t('dashboard.cogs')} tip={t('dashboard.cogsTip')} value={formatFCFA(fin.cogs, locale)} />
        <StatCard
          label={t('dashboard.cashProfit')}
          tip={t('dashboard.cashProfitTip')}
          value={formatFCFA(fin.cashProfit, locale)}
          tone={fin.cashProfit >= 0 ? 'good' : 'bad'}
          sub="CA − Dépenses"
        />
        <StatCard
          label={t('dashboard.grossMargin')}
          tip={t('dashboard.grossMarginTip')}
          value={formatFCFA(fin.grossMargin, locale)}
          tone={fin.grossMargin >= 0 ? 'good' : 'bad'}
          sub={fin.marginPct === null ? `CA − COGS · ${t('common.na')}` : `CA − COGS · ${fin.marginPct} %`}
        />
      </div>

      <div className="mt-3">
        <InfoNote>{t('dashboard.methodNote')}</InfoNote>
      </div>

      {/* Deux mesures d'échelles différentes = deux graphiques sur le même
          référentiel de dates, fuseau unique Afrique/Abidjan (anomalie n°14). */}
      <Card className="mt-5 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-stone-900">{t('dashboard.chart7days')}</h2>
        <p className="mb-4 text-xs text-stone-500">{t('dashboard.chartNote')}</p>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('dashboard.revenue')} (FCFA)
            </p>
            <BarChart
              data={series.map((d) => ({ label: dayLabel(d.day), value: d.revenue }))}
              color="#2a78d6"
              formatValue={(v) => v.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('dashboard.unitsProduced')}
            </p>
            <BarChart
              data={series.map((d) => ({ label: dayLabel(d.day), value: d.units }))}
              color="#1baf7a"
              formatValue={(v) => v.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US')}
            />
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">{t('dashboard.topProducts')}</h2>
          {topProducts.length === 0 ? (
            <p className="text-sm text-stone-500">{t('common.empty')}</p>
          ) : (
            <ul className="space-y-2.5">
              {topProducts.map(({ product, units }, i) => {
                const max = topProducts[0].units;
                return (
                  <li key={product.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-stone-800">
                        {i + 1}. {product.name}
                      </span>
                      <span className="text-stone-500">{units.toLocaleString()} u.</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(units / max) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">{t('dashboard.lowStock')}</h2>
          {lowStock.length === 0 ? (
            <p className="text-sm text-stone-500">{t('dashboard.lowStockEmpty')}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {lowStock.map(({ ingredient, qty }) => (
                <li key={ingredient.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-stone-800">{ingredient.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-stone-500">
                      {formatQty(qty, ingredient.baseUnit, locale)} /{' '}
                      {formatQty(ingredient.minThreshold, ingredient.baseUnit, locale)}
                    </span>
                    <Badge tone={qty <= 0 ? 'danger' : 'warning'}>{t('ingredients.lowBadge')}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
