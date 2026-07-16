import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { periodeEffective, libelleMois } from '../lib/payroll';
import { bulletinData } from '../lib/bulletin';
import { Button, Card, PageTitle, StatCard, Badge } from '../components/ui';

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Dashboard() {
  const { settings, employees } = useStore();
  const { t, locale } = useI18n();
  const ym = currentYm();

  const totals = useMemo(() => {
    let net = 0;
    let brut = 0;
    let cout = 0;
    let actifs = 0;
    for (const e of employees) {
      // Un salarié sous contrôle est exclu de la masse salariale tant que
      // le contrôle n'est pas levé (même logique que les états de paie).
      if (e.sousControle) continue;
      const bd = bulletinData(e, ym, settings);
      if (!bd) continue;
      actifs += 1;
      net += bd.calc.netAPayer;
      brut += bd.calc.brutTotal;
      cout += bd.calc.coutTotalEmployeur;
    }
    return { net, brut, cout, actifs };
  }, [employees, settings, ym]);

  const sousControle = useMemo(() => employees.filter((e) => e.sousControle), [employees]);

  return (
    <div>
      <PageTitle
        actions={
          <div className="flex gap-2">
            <Link to="/salaries"><Button variant="secondary">{t('dashboard.goEmployees')}</Button></Link>
            <Link to="/bulletins"><Button>{t('dashboard.goBulletins')}</Button></Link>
          </div>
        }
      >
        {t('dashboard.title')}
      </PageTitle>

      <p className="mb-4 text-sm text-stone-500">
        {t('dashboard.currentMonth')} : <strong className="text-stone-700">{libelleMois(ym, locale)}</strong>
        {' · '}<Badge tone="brand">{totals.actifs} {t('dashboard.employees').toLowerCase()}</Badge>
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('dashboard.employees')} value={employees.length} tip={t('dashboard.employeesTip')} tone="brand" />
        <StatCard label={t('dashboard.masseNet')} value={formatFCFA(totals.net, locale)} tip={t('dashboard.masseNetTip')} tone="good" />
        <StatCard label={t('dashboard.masseBrut')} value={formatFCFA(totals.brut, locale)} tip={t('dashboard.masseBrutTip')} />
        <StatCard label={t('dashboard.coutEmployeur')} value={formatFCFA(totals.cout, locale)} tip={t('dashboard.coutEmployeurTip')} tone="bad" />
      </div>

      {sousControle.length > 0 && (
        <Card className="mt-6 border-red-200 bg-red-50/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <Badge tone="danger">{sousControle.length}</Badge>
              {t('dashboard.sousControle')}
            </h2>
            <Link to="/salaries" className="text-xs font-medium text-red-700 hover:underline">
              {t('dashboard.sousControleManage')}
            </Link>
          </div>
          <ul className="divide-y divide-red-100">
            {sousControle.map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <p className="font-medium text-stone-800">{e.nom}</p>
                {(e.controleMotif || e.controleDepuis) && (
                  <p className="text-xs text-red-700">
                    {e.controleMotif}
                    {e.controleDepuis && <span className="text-red-500"> · {t('employees.controleDepuis')} {e.controleDepuis}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-stone-700">{t('dashboard.recent')}</h2>
        {employees.length === 0 ? (
          <div className="py-6 text-center text-sm text-stone-500">
            <p>{t('dashboard.noEmployees')}</p>
            <Link to="/salaries" className="mt-3 inline-block"><Button>{t('employees.add')}</Button></Link>
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {employees.slice(0, 6).map((e) => {
              const p = periodeEffective(e, ym) || e.periodes[e.periodes.length - 1];
              return (
                <li key={e.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-stone-800">
                      {e.nom}
                      {e.sousControle && <Badge tone="danger">{t('employees.sousControle')}</Badge>}
                    </p>
                    <p className="text-xs text-stone-500">{e.emploi || '—'} · {e.cnps || '—'}</p>
                  </div>
                  <Badge tone={p?.kind === 'cdi' ? 'success' : 'warning'}>
                    {p ? t('contract.' + p.kind) : '—'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
