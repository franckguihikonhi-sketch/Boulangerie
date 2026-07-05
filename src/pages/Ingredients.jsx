import { useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../lib/auth';
import {
  addIngredient, updateIngredient, deleteIngredient, currentQty,
  INGREDIENT_TYPES
} from '../lib/db';
import { formatFCFA } from '../lib/money';
import { BASE_UNITS, formatQty, stockUnitLabel } from '../lib/units';
import {
  Badge, Button, Card, ErrorNote, Field, InfoNote, Modal, PageTitle,
  TableWrap, inputClass, td, th
} from '../components/ui';

export default function Ingredients() {
  const s = useStore();
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const [modal, setModal] = useState(null); // null | 'new' | ingredient
  const [error, setError] = useState('');
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');

  const open = (ing) => {
    setError('');
    if (ing) {
      setForm({
        name: ing.name,
        type: ing.type,
        baseUnit: ing.baseUnit,
        minThreshold: ing.minThreshold,
        unitCost: ing.unitCost,
        initialQty: ''
      });
      setModal(ing);
    } else {
      setForm({ name: '', type: 'matiere_premiere', baseUnit: 'g', minThreshold: 0, unitCost: 0, initialQty: '' });
      setModal('new');
    }
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      if (modal === 'new') {
        addIngredient({
          name: form.name,
          type: form.type,
          baseUnit: form.baseUnit,
          minThreshold: Number(form.minThreshold) || 0,
          unitCost: Number(form.unitCost) || 0,
          initialQty: Number(form.initialQty) || 0,
          author: user.email
        });
      } else {
        updateIngredient(modal.id, {
          name: form.name,
          minThreshold: Number(form.minThreshold) || 0,
          unitCost: Number(form.unitCost) || 0
        });
      }
      setModal(null);
    } catch (err) {
      setError(t(err.message));
    }
  };

  const remove = (ing) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try {
      deleteIngredient(ing.id);
    } catch (err) {
      window.alert(t(err.message));
    }
  };

  const rows = s.ingredients
    .filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    .map((i) => ({ ingredient: i, qty: currentQty(s, i.id) }));

  return (
    <div>
      <PageTitle actions={<Button onClick={() => open(null)}>+ {t('ingredients.add')}</Button>}>
        {t('ingredients.title')}
      </PageTitle>

      <div className="mb-3 max-w-xs">
        <input
          className={inputClass}
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <TableWrap>
          <thead className="border-b border-stone-200">
            <tr>
              <th className={th}>{t('ingredients.name')}</th>
              <th className={th}>{t('ingredients.type')}</th>
              <th className={th}>{t('ingredients.stock')}</th>
              <th className={th}>{t('ingredients.threshold')}</th>
              <th className={th}>{t('ingredients.unitCostShort')}</th>
              <th className={th}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ ingredient: i, qty }) => (
              <tr key={i.id} className="hover:bg-stone-50">
                <td className={`${td} font-medium`}>
                  {i.name}
                  {/* Alerte visible sur la liste Ingrédients elle-même (5.1) */}
                  {qty <= i.minThreshold && (
                    <span className="ml-2 inline-block align-middle">
                      <Badge tone={qty <= 0 ? 'danger' : 'warning'}>{t('ingredients.lowBadge')}</Badge>
                    </span>
                  )}
                </td>
                <td className={td}>
                  <Badge tone={i.type === 'matiere_premiere' ? 'brand' : 'neutral'}>
                    {t(`ingredientType.${i.type}`)}
                  </Badge>
                </td>
                <td className={td}>{formatQty(qty, i.baseUnit, locale)}</td>
                <td className={td}>{formatQty(i.minThreshold, i.baseUnit, locale)}</td>
                <td className={td}>
                  {formatFCFA(i.unitCost, locale)} / {stockUnitLabel(i.baseUnit)}
                </td>
                <td className={td}>
                  <div className="flex gap-2">
                    <button onClick={() => open(i)} className="text-sm font-medium text-brand-700 hover:underline">
                      {t('common.edit')}
                    </button>
                    <button onClick={() => remove(i)} className="text-sm font-medium text-red-600 hover:underline">
                      {t('common.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={`${td} text-stone-500`} colSpan="6">{t('common.empty')}</td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      <div className="mt-3">
        <InfoNote>{t('ingredients.cmpNote')}</InfoNote>
      </div>

      {modal && (
        <Modal title={modal === 'new' ? t('ingredients.add') : t('ingredients.edit')} onClose={() => setModal(null)}>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('ingredients.name')}>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            {modal === 'new' && (
              <>
                <Field label={t('ingredients.type')}>
                  <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {INGREDIENT_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`ingredientType.${type}`)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('ingredients.baseUnit')} help={t('ingredients.baseUnitHelp')}>
                  <select className={inputClass} value={form.baseUnit} onChange={(e) => setForm({ ...form, baseUnit: e.target.value })}>
                    {BASE_UNITS.map((u) => (
                      <option key={u} value={u}>{u === 'unite' ? 'unité' : u}</option>
                    ))}
                  </select>
                </Field>
                <Field label={`${t('ingredients.initialQty')} (${form.baseUnit === 'unite' ? 'unité' : form.baseUnit})`}>
                  <input type="number" step="any" min="0" className={inputClass} value={form.initialQty} onChange={(e) => setForm({ ...form, initialQty: e.target.value })} />
                </Field>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${t('ingredients.threshold')} (${form.baseUnit === 'unite' ? 'unité' : form.baseUnit})`}>
                <input type="number" step="any" min="0" className={inputClass} value={form.minThreshold} onChange={(e) => setForm({ ...form, minThreshold: e.target.value })} required />
              </Field>
              <Field label={t('ingredients.unitCost', { unit: stockUnitLabel(form.baseUnit) })}>
                <input type="number" step="1" min="0" className={inputClass} value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required />
              </Field>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>{t('common.cancel')}</Button>
              <Button type="submit">{t('common.save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
