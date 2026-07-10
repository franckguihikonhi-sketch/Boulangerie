import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { devisTotal, devisPaid, paymentStatus } from '../lib/db';
import { formatFCFA } from '../lib/money';
import { Badge, Button, Card, PageTitle, StatCard, TableWrap, td, th } from '../components/ui';

const STATUS_TONE = { en_cours: 'warning', valide: 'success', refuse: 'danger' };
const PAY_TONE = { non_regle: 'danger', acompte: 'warning', regle: 'success' };

// Vue d'ensemble : compteurs par statut, indicateurs financiers (facturé,
// encaissé, solde) et derniers devis. Le commercial ne voit que ses devis, le
// Responsable tous.
export default function Dashboard() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const devis = useMemo(
    () => s.devis.filter((d) => isAdmin || d.author === user.email),
    [s.devis, isAdmin, user.email]
  );

  const stats = useMemo(() => {
    let inProgress = 0, validated = 0, refused = 0, billed = 0, collected = 0;
    for (const d of devis) {
      if (d.status === 'en_cours') inProgress++;
      else if (d.status === 'refuse') refused++;
      else if (d.status === 'valide') {
        validated++;
        billed += devisTotal(d);
        collected += devisPaid(s, d.id);
      }
    }
    return { inProgress, validated, refused, billed, collected, due: billed - collected };
  }, [devis, s]);

  const recent = useMemo(
    () => [...devis].sort((a, b) => b.number.localeCompare(a.number)).slice(0, 6),
    [devis]
  );

  return (
    <div>
      <PageTitle actions={<Button onClick={() => navigate('/devis')}>{t('dashboard.newDevis')}</Button>}>
        {t('dashboard.title')}
      </PageTitle>
      <p className="-mt-3 mb-5 text-sm text-stone-500">{t('dashboard.hello', { name: user.name })} — {t('dashboard.subtitle')}</p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('devisStatus.en_cours')} value={stats.inProgress} tone="brand" />
        <StatCard label={t('devisStatus.valide')} value={stats.validated} tone="good" />
        <StatCard label={t('devisStatus.refuse')} value={stats.refused} tone="bad" />
        <StatCard label={t('dashboard.totalDevis')} value={devis.length} tip={t('dashboard.totalDevisTip')} />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('dashboard.billed')} value={formatFCFA(stats.billed, locale)} tip={t('dashboard.billedTip')} tone="brand" />
        <StatCard label={t('dashboard.collected')} value={formatFCFA(stats.collected, locale)} tip={t('dashboard.collectedTip')} tone="good" />
        <StatCard label={t('dashboard.due')} value={formatFCFA(stats.due, locale)} tip={t('dashboard.dueTip')} tone={stats.due > 0 ? 'bad' : 'good'} />
      </div>

      <Card>
        <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">{t('dashboard.recent')}</h2>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('devis.number')}</th>
              <th className={th}>{t('devis.client')}</th>
              <th className={th}>{t('devis.total')}</th>
              <th className={th}>{t('devis.status')}</th>
              <th className={th}>{t('payments.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {recent.map((d) => (
              <tr key={d.id} className="cursor-pointer hover:bg-stone-50" onClick={() => navigate('/devis')}>
                <td className={`${td} font-mono text-xs font-semibold`}>{d.number}</td>
                <td className={`${td} font-medium`}>{d.clientName || '—'}</td>
                <td className={td}>{formatFCFA(devisTotal(d), locale)}</td>
                <td className={td}><Badge tone={STATUS_TONE[d.status]}>{t('devisStatus.' + d.status)}</Badge></td>
                <td className={td}>
                  {d.status === 'valide'
                    ? <Badge tone={PAY_TONE[paymentStatus(s, d)]}>{t('paymentStatus.' + paymentStatus(s, d))}</Badge>
                    : <span className="text-stone-400">—</span>}
                </td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="5">{t('dashboard.emptyRecent')}</td></tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
