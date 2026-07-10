import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { devisBalance, devisPaid, devisTotal, paymentStatus } from '../lib/db';
import { formatFCFA } from '../lib/money';
import {
  Badge, Card, InfoNote, PageTitle, StatCard, TableWrap, inputClass, td, th
} from '../components/ui';

const STATUS_TONE = { non_regle: 'danger', acompte: 'warning', regle: 'success' };

// Suivi des règlements : pour chaque devis validé, montant total, déjà encaissé
// et solde restant, avec le statut non réglé / acompte / réglé (section
// « Suivi des paiements » du cahier des charges).
export default function Payments() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user, isAdmin } = useAuth();
  const [statusFilter, setStatusFilter] = useState('all');

  // Le règlement ne concerne que les devis validés. Le Responsable (admin) voit
  // tous les devis, le commercial uniquement les siens.
  const rows = useMemo(() => {
    return s.devis
      .filter((d) => d.status === 'valide')
      .filter((d) => isAdmin || d.author === user.email)
      .map((d) => ({
        devis: d, total: devisTotal(d), paid: devisPaid(s, d.id),
        balance: devisBalance(s, d), status: paymentStatus(s, d)
      }))
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .sort((a, b) => b.balance - a.balance);
  }, [s, isAdmin, user.email, statusFilter]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          billed: acc.billed + r.total, collected: acc.collected + r.paid, due: acc.due + r.balance
        }),
        { billed: 0, collected: 0, due: 0 }
      ),
    [rows]
  );

  return (
    <div>
      <PageTitle>{t('payments.title')}</PageTitle>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('payments.billed')} value={formatFCFA(totals.billed, locale)} tip={t('payments.billedTip')} tone="brand" />
        <StatCard label={t('payments.collected')} value={formatFCFA(totals.collected, locale)} tip={t('payments.collectedTip')} tone="good" />
        <StatCard label={t('payments.due')} value={formatFCFA(totals.due, locale)} tip={t('payments.dueTip')} tone={totals.due > 0 ? 'bad' : 'good'} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">{t('payments.byDevis')}</h2>
          <select className={`${inputClass} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            <option value="non_regle">{t('paymentStatus.non_regle')}</option>
            <option value="acompte">{t('paymentStatus.acompte')}</option>
            <option value="regle">{t('paymentStatus.regle')}</option>
          </select>
        </div>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('devis.number')}</th>
              <th className={th}>{t('devis.client')}</th>
              <th className={th}>{t('devis.total')}</th>
              <th className={th}>{t('devis.paid')}</th>
              <th className={th}>{t('devis.balance')}</th>
              <th className={th}>{t('payments.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ devis, total, paid, balance, status }) => (
              <tr key={devis.id} className="hover:bg-stone-50">
                <td className={`${td} font-mono text-xs font-semibold`}>{devis.number}</td>
                <td className={`${td} font-medium`}>{devis.clientName || '—'}</td>
                <td className={td}>{formatFCFA(total, locale)}</td>
                <td className={`${td} text-green-700`}>{formatFCFA(paid, locale)}</td>
                <td className={`${td} font-medium ${balance > 0 ? 'text-red-700' : 'text-stone-500'}`}>
                  {formatFCFA(balance, locale)}
                </td>
                <td className={td}>
                  <Badge tone={STATUS_TONE[status]}>{t('paymentStatus.' + status)}</Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="6">{t('payments.empty')}</td></tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <div className="mt-4">
        <InfoNote>{t('payments.note')}</InfoNote>
      </div>
    </div>
  );
}
