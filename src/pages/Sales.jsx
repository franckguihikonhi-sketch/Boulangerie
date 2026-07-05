import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import { productStock, recordSale, uid } from '../lib/db';
import { formatFCFA } from '../lib/money';
import {
  Button, Card, ErrorNote, Field, InfoNote, PageTitle, TableWrap, inputClass, td, th
} from '../components/ui';

export default function Sales() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [client, setClient] = useState('');
  const [note, setNote] = useState('');
  const [idemKey, setIdemKey] = useState(() => uid());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Seuls les produits avec un stock fini strictement positif sont proposés
  // (section 5.5).
  const available = useMemo(
    () =>
      s.products
        .filter((p) => p.isActive)
        .map((p) => ({ product: p, stock: productStock(s, p.id) }))
        .filter((x) => x.stock > 0),
    [s]
  );

  const selected = available.find((x) => x.product.id === productId);

  const submit = (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      recordSale({
        productId,
        quantity: Number(qty),
        unitPrice: Number(unitPrice),
        client,
        note,
        idempotencyKey: idemKey,
        author: user.email
      });
      setProductId('');
      setQty('1');
      setUnitPrice('');
      setClient('');
      setNote('');
      setIdemKey(uid());
    } catch (err) {
      setError(t(err.message));
    } finally {
      setSaving(false);
    }
  };

  const sales = [...s.sales].sort((a, b) => b.soldAt.localeCompare(a.soldAt)).slice(0, 30);

  return (
    <div>
      <PageTitle>{t('sales.title')}</PageTitle>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">{t('sales.record')}</h2>
          {available.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('sales.noStock')}
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label={t('sales.product')}>
                <select
                  className={inputClass}
                  value={productId}
                  onChange={(e) => {
                    const x = available.find((a) => a.product.id === e.target.value);
                    setProductId(e.target.value);
                    // Prix unitaire pré-rempli mais modifiable (section 5.5).
                    setUnitPrice(x ? String(x.product.sellingPrice) : '');
                  }}
                  required
                >
                  <option value="">—</option>
                  {available.map(({ product, stock }) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({stock} {t('sales.available')})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('common.quantity')}>
                  <input
                    type="number" step="1" min="1" max={selected?.stock || undefined}
                    className={inputClass} value={qty} onChange={(e) => setQty(e.target.value)} required
                  />
                </Field>
                <Field label={`${t('sales.unitPrice')} (FCFA)`}>
                  <input type="number" step="1" min="0" className={inputClass} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
                </Field>
              </div>
              <Field label={`${t('sales.client')} (${t('common.optional')})`}>
                <input className={inputClass} value={client} onChange={(e) => setClient(e.target.value)} />
              </Field>
              <Field label={`${t('common.note')} (${t('common.optional')})`}>
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {selected && Number(qty) > 0 && Number(unitPrice) >= 0 && (
                <p className="text-sm text-stone-600">
                  {t('common.total')} : <span className="font-semibold">{formatFCFA(Number(qty) * Number(unitPrice), locale)}</span>
                </p>
              )}
              <ErrorNote>{error}</ErrorNote>
              <Button type="submit" className="w-full" disabled={saving || !productId}>
                {saving ? t('common.saving') : t('sales.record')}
              </Button>
            </form>
          )}
          <div className="mt-4">
            <InfoNote>{t('sales.stockNote')}</InfoNote>
          </div>
        </Card>

        <div className="lg:col-span-3">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-3 text-sm font-semibold text-stone-900">
              {t('sales.history')}
            </h2>
            <TableWrap>
              <thead className="border-b border-stone-200">
                <tr>
                  <th className={th}>{t('common.date')}</th>
                  <th className={th}>{t('sales.product')}</th>
                  <th className={th}>{t('common.quantity')}</th>
                  <th className={th}>{t('sales.unitPrice')}</th>
                  <th className={th}>{t('common.total')}</th>
                  <th className={th}>{t('sales.client')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {sales.map((v) => {
                  const product = s.products.find((p) => p.id === v.productId);
                  return (
                    <tr key={v.id} className="hover:bg-stone-50">
                      <td className={td}>
                        {new Date(v.soldAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className={`${td} font-medium`}>{product?.name || '?'}</td>
                      <td className={td}>× {v.quantity}</td>
                      <td className={td}>{formatFCFA(v.unitPrice, locale)}</td>
                      <td className={`${td} font-medium`}>{formatFCFA(v.total, locale)}</td>
                      <td className={td}>{v.client || '—'}</td>
                    </tr>
                  );
                })}
                {sales.length === 0 && (
                  <tr><td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td></tr>
                )}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      </div>
    </div>
  );
}
