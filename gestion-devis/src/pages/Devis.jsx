import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import {
  createDevis, updateDevis, setDevisStatus, finalizeDevis, recordPayment, deleteDevis,
  devisTotal, devisPaid, devisBalance, paymentStatus, uid, ARTICLE_FAMILIES
} from '../lib/db';
import { formatFCFA } from '../lib/money';
import { buildReceiptHtml, buildDevisHtml, mailtoDevisFinalized, mailtoPayment } from '../lib/receipt';
import SignaturePad from '../components/SignaturePad';
import DocPreview from '../components/DocPreview';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, Modal, PageTitle,
  TableWrap, inputClass, td, th
} from '../components/ui';

const STATUS_TONE = { en_cours: 'warning', valide: 'success', refuse: 'danger' };
const PAY_TONE = { non_regle: 'danger', acompte: 'warning', regle: 'success' };

// Ouvre le client de messagerie de l'utilisateur, pré-rempli (mailto:).
function openMail(url) {
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Devis() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user, isAdmin } = useAuth();

  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { id? } pour créer/modifier
  const [detailId, setDetailId] = useState(null);

  // Le Responsable voit tous les devis, le commercial uniquement les siens
  // (section 3 « Utilisateurs et rôles »).
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return s.devis
      .filter((d) => isAdmin || d.author === user.email)
      .filter((d) => statusFilter === 'all' || d.status === statusFilter)
      .filter((d) => !q || d.number.toLowerCase().includes(q) || (d.clientName || '').toLowerCase().includes(q))
      .sort((a, b) => b.number.localeCompare(a.number));
  }, [s.devis, isAdmin, user.email, statusFilter, query]);

  const detail = detailId ? s.devis.find((d) => d.id === detailId) : null;

  return (
    <div>
      <PageTitle actions={<Button onClick={() => setEditing({})}>{t('devis.new')}</Button>}>
        {t('devis.title')}
      </PageTitle>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'en_cours', 'valide', 'refuse'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === st ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {st === 'all' ? t('common.all') : t('devisStatus.' + st)}
            </button>
          ))}
          <input
            className={`${inputClass} ml-auto w-full sm:w-56`}
            placeholder={t('devis.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('devis.number')}</th>
              <th className={th}>{t('devis.client')}</th>
              <th className={th}>{t('devis.total')}</th>
              <th className={th}>{t('devis.status')}</th>
              <th className={th}>{t('payments.status')}</th>
              <th className={th}>{t('common.date')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {list.map((d) => (
              <tr key={d.id} className="cursor-pointer hover:bg-stone-50" onClick={() => setDetailId(d.id)}>
                <td className={`${td} font-mono text-xs font-semibold`}>{d.number}</td>
                <td className={`${td} font-medium`}>{d.clientName || '—'}</td>
                <td className={td}>{formatFCFA(devisTotal(d), locale)}</td>
                <td className={td}><Badge tone={STATUS_TONE[d.status]}>{t('devisStatus.' + d.status)}</Badge></td>
                <td className={td}>
                  {d.status === 'valide'
                    ? <Badge tone={PAY_TONE[paymentStatus(s, d)]}>{t('paymentStatus.' + paymentStatus(s, d))}</Badge>
                    : <span className="text-stone-400">—</span>}
                </td>
                <td className={`${td} whitespace-nowrap text-stone-500`}>
                  {new Date(d.createdAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'short' })}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td></tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      {editing && (
        <DevisForm
          existing={editing.id ? s.devis.find((d) => d.id === editing.id) : null}
          onClose={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); setDetailId(id); }}
        />
      )}

      {detail && (
        <DevisDetail
          devis={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => { setDetailId(null); setEditing({ id: detail.id }); }}
        />
      )}
    </div>
  );
}

// --------------------------- Création / modification ------------------------

function DevisForm({ existing, onClose, onSaved }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [clientName, setClientName] = useState(existing?.clientName || '');
  const [clientContact, setClientContact] = useState(existing?.clientContact || '');
  const [note, setNote] = useState(existing?.note || '');
  const [lines, setLines] = useState(
    () => (existing?.lines || []).map((l) => ({ key: uid(), ...l }))
  );
  const [picker, setPicker] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const activeArticles = s.articles.filter((a) => a.isActive);
  // Regroupe le catalogue par famille pour un choix rapide (optgroup). Les
  // familles connues d'abord, puis « Autres » pour les articles sans famille.
  const articlesByFamily = [
    ...ARTICLE_FAMILIES.map((f) => ({ family: f, items: activeArticles.filter((a) => a.family === f) })),
    { family: '', items: activeArticles.filter((a) => !ARTICLE_FAMILIES.includes(a.family)) }
  ].filter((g) => g.items.length > 0);

  const addFromArticle = (articleId) => {
    const a = s.articles.find((x) => x.id === articleId);
    if (!a) return;
    setLines((ls) => [...ls, { key: uid(), articleRef: a.reference, designation: a.designation, unitPrice: a.unitPrice, quantity: 1 }]);
    setPicker('');
  };

  const addFreeLine = () =>
    setLines((ls) => [...ls, { key: uid(), articleRef: '', designation: '', unitPrice: 0, quantity: 1 }]);

  const updateLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key));

  const total = lines.reduce((sum, l) => sum + Math.round(Number(l.unitPrice || 0) * Number(l.quantity || 0)), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        clientName, clientContact, note,
        lines: lines.map((l) => ({
          articleRef: l.articleRef, designation: l.designation,
          unitPrice: Number(l.unitPrice), quantity: Number(l.quantity)
        }))
      };
      if (existing) {
        await updateDevis(existing.id, payload);
        onSaved(existing.id);
      } else {
        const res = await createDevis({ ...payload, author: user.email });
        onSaved(res.id);
      }
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal wide title={existing ? `${t('devis.edit')} ${existing.number}` : t('devis.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('devis.clientName')}>
            <input className={inputClass} value={clientName} onChange={(e) => setClientName(e.target.value)} required />
          </Field>
          <Field label={`${t('devis.clientContact')} (${t('common.optional')})`}>
            <input className={inputClass} value={clientContact} onChange={(e) => setClientContact(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-stone-700">{t('devis.lines')}</span>
            <div className="flex gap-2">
              <select className={`${inputClass} w-auto max-w-[15rem] text-xs`} value={picker} onChange={(e) => addFromArticle(e.target.value)}>
                <option value="">{t('devis.addArticle')}</option>
                {articlesByFamily.map((g) => (
                  <optgroup key={g.family || 'autres'} label={g.family ? t('family.' + g.family) : t('family.autres')}>
                    {g.items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.reference ? `${a.reference} · ` : ''}{a.designation} — {formatFCFA(a.unitPrice, locale)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button type="button" variant="secondary" className="px-2 py-1.5 text-xs" onClick={addFreeLine}>
                {t('devis.freeLine')}
              </Button>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 px-3 py-4 text-center text-sm text-stone-500">
              {t('devis.noLines')}
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-stone-200 p-2">
                  <div className="col-span-12 sm:col-span-5">
                    <span className="mb-1 block text-[11px] text-stone-500">{t('devis.designation')}</span>
                    <input className={inputClass} value={l.designation} onChange={(e) => updateLine(l.key, { designation: e.target.value })} required />
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <span className="mb-1 block text-[11px] text-stone-500">{t('devis.unitPrice')}</span>
                    <input type="number" step="1" min="0" className={inputClass} value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} required />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <span className="mb-1 block text-[11px] text-stone-500">{t('common.quantity')}</span>
                    <input type="number" step="0.01" min="0" className={inputClass} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} required />
                  </div>
                  <div className="col-span-4 sm:col-span-1 text-right text-sm font-medium text-stone-800">
                    {formatFCFA(Math.round(Number(l.unitPrice || 0) * Number(l.quantity || 0)), locale)}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button type="button" onClick={() => removeLine(l.key)} className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label={t('common.delete')}>
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 pt-3">
          <span className="text-sm text-stone-500">{t('devis.total')}</span>
          <span className="text-lg font-bold text-stone-900">{formatFCFA(total, locale)}</span>
        </div>

        <Field label={`${t('common.note')} (${t('common.optional')})`}>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving || lines.length === 0}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------- Détail / actions ---------------------------

function DevisDetail({ devis, onClose, onEdit }) {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user, isAdmin } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState(null); // { html, title } — aperçu imprimable

  const total = devisTotal(devis);
  const paid = devisPaid(s, devis.id);
  const balance = devisBalance(s, devis);
  const payStatus = paymentStatus(s, devis);
  const payments = s.payments.filter((p) => p.devisId === devis.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(t(err.message));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (status) => run(() => setDevisStatus(devis.id, status));
  const remove = () => {
    if (!window.confirm(t('devis.confirmDelete'))) return;
    run(async () => { await deleteDevis(devis.id); onClose(); });
  };
  const exportPdf = () =>
    setDoc({
      title: `${t('devis.title')} ${devis.number}`,
      html: buildDevisHtml({ devis, total, statusLabel: t('devisStatus.' + devis.status), appName: t('app.name'), t, locale })
    });

  return (
    <Modal wide title={devis.number} onClose={onClose}>
      <div className="space-y-5">
        {/* En-tête : client + statuts */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-stone-900">{devis.clientName || '—'}</p>
            {devis.clientContact && <p className="text-sm text-stone-500">{devis.clientContact}</p>}
            {devis.note && <p className="mt-1 text-sm italic text-stone-500">« {devis.note} »</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge tone={STATUS_TONE[devis.status]}>{t('devisStatus.' + devis.status)}</Badge>
            {devis.status === 'valide' && <Badge tone={PAY_TONE[payStatus]}>{t('paymentStatus.' + payStatus)}</Badge>}
          </div>
        </div>

        {/* Export du devis (PDF / image via la boîte d'impression) */}
        <div>
          <Button variant="secondary" onClick={exportPdf}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
            </svg>
            {t('devis.exportPdf')}
          </Button>
        </div>

        {/* Lignes */}
        <Card>
          <TableWrap>
            <thead className="border-b border-stone-200">
              <tr>
                <th className={th}>{t('devis.designation')}</th>
                <th className={`${th} text-right`}>{t('devis.unitPrice')}</th>
                <th className={`${th} text-right`}>{t('common.quantity')}</th>
                <th className={`${th} text-right`}>{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {devis.lines.map((l) => (
                <tr key={l.id}>
                  <td className={td}>
                    {l.articleRef && <span className="mr-1 font-mono text-[11px] text-stone-400">{l.articleRef}</span>}
                    {l.designation}
                  </td>
                  <td className={`${td} text-right`}>{formatFCFA(l.unitPrice, locale)}</td>
                  <td className={`${td} text-right`}>{l.quantity}</td>
                  <td className={`${td} text-right font-medium`}>{formatFCFA(l.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="space-y-1 border-t border-stone-200 px-4 py-3 text-sm">
            <div className="flex justify-between font-semibold text-stone-900"><span>{t('devis.total')}</span><span>{formatFCFA(total, locale)}</span></div>
            {devis.status === 'valide' && (
              <>
                <div className="flex justify-between text-green-700"><span>{t('devis.paid')}</span><span>{formatFCFA(paid, locale)}</span></div>
                <div className={`flex justify-between font-medium ${balance > 0 ? 'text-red-700' : 'text-stone-500'}`}><span>{t('devis.balance')}</span><span>{formatFCFA(balance, locale)}</span></div>
              </>
            )}
          </div>
        </Card>

        <ErrorNote>{error}</ErrorNote>

        {/* Actions selon le statut */}
        {devis.status === 'en_cours' && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => changeStatus('valide')} disabled={busy}>{t('devis.validate')}</Button>
            <Button variant="secondary" onClick={onEdit} disabled={busy}>{t('common.edit')}</Button>
            <Button variant="danger" onClick={() => changeStatus('refuse')} disabled={busy}>{t('devis.refuse')}</Button>
            {isAdmin && <Button variant="danger" onClick={remove} disabled={busy}>{t('common.delete')}</Button>}
          </div>
        )}

        {devis.status === 'refuse' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => changeStatus('en_cours')} disabled={busy}>{t('devis.reopen')}</Button>
            {isAdmin && <Button variant="danger" onClick={remove} disabled={busy}>{t('common.delete')}</Button>}
          </div>
        )}

        {devis.status === 'valide' && (
          <>
            <FinalizeSection devis={devis} total={total} run={run} busy={busy} />
            <PaymentSection
              devis={devis} total={total} paid={paid} balance={balance}
              payments={payments} run={run} busy={busy} author={user.email}
              onShowDoc={setDoc}
            />
          </>
        )}
      </div>
      {doc && <DocPreview html={doc.html} title={doc.title} onClose={() => setDoc(null)} />}
    </Modal>
  );
}

// Finalisation d'un devis validé : livraison + signatures + e-mail admin.
function FinalizeSection({ devis, total, run, busy }) {
  const { t, locale } = useI18n();
  const finalized = !!devis.finalizedAt;
  const [open, setOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(devis.deliveryDate || '');
  const [deliveryAddress, setDeliveryAddress] = useState(devis.deliveryAddress || '');
  const [clientSig, setClientSig] = useState('');
  const [commercialSig, setCommercialSig] = useState('');

  const submit = () =>
    run(async () => {
      await finalizeDevis(devis.id, {
        deliveryDate, deliveryAddress, clientSignature: clientSig, commercialSignature: commercialSig
      });
      setOpen(false);
      openMail(mailtoDevisFinalized({ devis: { ...devis, deliveryDate, deliveryAddress }, total, t, locale }));
    });

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-stone-900">{t('devis.finalizeTitle')}</h3>
      {finalized ? (
        <div className="space-y-2 text-sm">
          <p><span className="text-stone-500">{t('devis.deliveryDate')} :</span>{' '}
            {devis.deliveryDate
              ? new Date(devis.deliveryDate).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'long', year: 'numeric' })
              : '—'}
          </p>
          <p><span className="text-stone-500">{t('devis.deliveryAddress')} :</span> {devis.deliveryAddress || '—'}</p>
          <div className="flex flex-wrap gap-4 pt-1">
            {devis.clientSignature && (
              <figure><figcaption className="text-[11px] text-stone-500">{t('devis.clientSignature')}</figcaption>
                <img src={devis.clientSignature} alt="signature client" className="mt-1 h-20 rounded border border-stone-200" /></figure>
            )}
            {devis.commercialSignature && (
              <figure><figcaption className="text-[11px] text-stone-500">{t('devis.commercialSignature')}</figcaption>
                <img src={devis.commercialSignature} alt="signature commercial" className="mt-1 h-20 rounded border border-stone-200" /></figure>
            )}
          </div>
          <Button variant="secondary" className="mt-1 text-xs" onClick={() => openMail(mailtoDevisFinalized({ devis, total, t, locale }))}>
            {t('devis.resendEmail')}
          </Button>
        </div>
      ) : !open ? (
        <div>
          <p className="mb-3 text-sm text-stone-500">{t('devis.finalizeHelp')}</p>
          <Button onClick={() => setOpen(true)}>{t('devis.finalize')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('devis.deliveryDate')}>
              <input type="date" className={inputClass} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} required />
            </Field>
            <Field label={t('devis.deliveryAddress')}>
              <input className={inputClass} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} required />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SignaturePad label={t('devis.clientSignature')} onChange={setClientSig} />
            <SignaturePad label={t('devis.commercialSignature')} onChange={setCommercialSig} />
          </div>
          <InfoNote>{t('devis.emailNote')}</InfoNote>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={busy || !clientSig || !commercialSig}>
              {busy ? t('common.saving') : t('devis.confirmFinalize')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// Enregistrement d'un paiement (acompte / total) + reçu + e-mail admin.
function PaymentSection({ devis, total, paid, balance, payments, run, busy, author, onShowDoc }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('acompte');
  const [amount, setAmount] = useState('');
  const [clientSig, setClientSig] = useState('');

  const settled = balance <= 0;

  const startPayment = (nextType) => {
    setType(nextType);
    // Un paiement « total » propose d'emblée le solde restant.
    setAmount(nextType === 'total' ? String(balance) : '');
    setClientSig('');
    setOpen(true);
  };

  const submit = () =>
    run(async () => {
      await recordPayment({ devisId: devis.id, type, amount: Number(amount), clientSignature: clientSig, author });
      const payment = { type, amount: Math.round(Number(amount)), clientSignature: clientSig, createdAt: new Date().toISOString() };
      const newPaid = paid + payment.amount;
      const newBalance = total - newPaid;
      setOpen(false);
      openMail(mailtoPayment({ devis, payment, total, paid: newPaid, balance: newBalance, t, locale }));
    });

  const receiptFor = (payment) => {
    const paidUpTo = payments.filter((p) => p.createdAt <= payment.createdAt).reduce((a, p) => a + p.amount, 0);
    onShowDoc({
      title: `${t('receipt.title')} ${devis.number}`,
      html: buildReceiptHtml({
        devis, payment, total, paid: paidUpTo, balance: total - paidUpTo, appName: t('app.name'), t, locale
      })
    });
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">{t('devis.paymentTitle')}</h3>
        {!settled && !open && (
          <div className="flex gap-2">
            <Button className="px-2.5 py-1.5 text-xs" onClick={() => startPayment('acompte')}>{t('devis.addDeposit')}</Button>
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => startPayment('total')}>{t('devis.paySettle')}</Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mb-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('devis.paymentType')}>
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="acompte">{t('paymentType.acompte')}</option>
                <option value="total">{t('paymentType.total')}</option>
              </select>
            </Field>
            <Field label={`${t('devis.amount')} (FCFA)`} help={t('devis.balanceRemaining', { amount: formatFCFA(balance, locale) })}>
              <input type="number" step="1" min="1" max={balance} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
          </div>
          <SignaturePad label={`${t('devis.clientSignature')} (${t('common.optional')})`} onChange={setClientSig} height={130} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={submit} disabled={busy || !(Number(amount) > 0)}>
              {busy ? t('common.saving') : t('devis.recordPayment')}
            </Button>
          </div>
        </div>
      )}

      {settled && !open && (
        <p className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{t('devis.fullySettled')}</p>
      )}

      {payments.length > 0 ? (
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('common.date')}</th>
              <th className={th}>{t('devis.paymentType')}</th>
              <th className={`${th} text-right`}>{t('devis.amount')}</th>
              <th className={`${th} text-right`}>{t('devis.receipt')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {payments.map((p) => (
              <tr key={p.id}>
                <td className={`${td} whitespace-nowrap`}>
                  {new Date(p.createdAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { day: '2-digit', month: 'short', year: '2-digit' })}
                </td>
                <td className={td}><Badge>{t('paymentType.' + p.type)}</Badge></td>
                <td className={`${td} text-right font-medium`}>{formatFCFA(p.amount, locale)}</td>
                <td className={`${td} text-right`}>
                  <button onClick={() => receiptFor(p)} className="text-xs font-medium text-brand-700 hover:underline">
                    {t('devis.printReceipt')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <p className="text-sm text-stone-500">{t('devis.noPayments')}</p>
      )}
    </Card>
  );
}
