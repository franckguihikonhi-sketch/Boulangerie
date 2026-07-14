import { useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { saveSettings, resetDemoData } from '../lib/db';
import { DEFAULT_PARAMS } from '../lib/payroll';
import { Button, Card, PageTitle, Field, inputClass, InfoNote } from '../components/ui';

export default function Parametres() {
  const { settings } = useStore();
  const { t } = useI18n();
  const [form, setForm] = useState({
    raisonSociale: settings.raisonSociale,
    employeurCnps: settings.employeurCnps,
    adresse: settings.adresse,
    tauxAT: (settings.tauxAccidentTravail * 100).toString(),
    transportExonere: settings.transportExonere
  });
  const [saved, setSaved] = useState(false);

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  const save = (e) => {
    e.preventDefault();
    saveSettings({
      raisonSociale: form.raisonSociale.trim(),
      employeurCnps: form.employeurCnps.trim(),
      adresse: form.adresse.trim(),
      tauxAccidentTravail: Math.max(0, Number(form.tauxAT) || 0) / 100,
      transportExonere: Math.max(0, Number(form.transportExonere) || 0)
    });
    setSaved(true);
  };

  const reset = () => {
    if (window.confirm(t('settings.resetConfirm'))) resetDemoData();
  };

  const legalRates = [
    ['Retraite CNPS (salarié)', '6,3 %'],
    ['CMU (salarié)', '1 000 FCFA / mois'],
    ['Prestations familiales (patronal)', '5 %'],
    ['Retraite CNPS (patronal)', '7,7 %'],
    ['Taxe d’apprentissage', '0,4 %'],
    ['FPC', '1,2 %'],
    ['Impôt sur salaires locaux', '1,2 %'],
    ['Plafond CNPS', DEFAULT_PARAMS.plafondCnps.toLocaleString('fr-FR') + ' FCFA']
  ];

  return (
    <div>
      <PageTitle>{t('settings.title')}</PageTitle>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <form onSubmit={save} className="space-y-4">
            <h2 className="text-sm font-semibold text-stone-800">{t('settings.employer')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('settings.raisonSociale')}>
                <input className={inputClass} value={form.raisonSociale} onChange={(e) => set('raisonSociale', e.target.value)} />
              </Field>
              <Field label={t('settings.employeurCnps')}>
                <input className={inputClass} value={form.employeurCnps} onChange={(e) => set('employeurCnps', e.target.value)} />
              </Field>
              <Field label={t('settings.adresse')}>
                <input className={inputClass} value={form.adresse} onChange={(e) => set('adresse', e.target.value)} />
              </Field>
            </div>

            <h2 className="border-t border-stone-100 pt-4 text-sm font-semibold text-stone-800">{t('settings.payParams')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('settings.tauxAT')} help={t('settings.tauxATHelp')}>
                <input className={inputClass} type="number" step="0.1" min="0" value={form.tauxAT} onChange={(e) => set('tauxAT', e.target.value)} />
              </Field>
              <Field label={t('settings.transportExonere')} help={t('settings.transportExonereHelp')}>
                <input className={inputClass} type="number" min="0" value={form.transportExonere} onChange={(e) => set('transportExonere', e.target.value)} />
              </Field>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit">{t('settings.save')}</Button>
              {saved && <span className="text-sm text-green-700">{t('settings.saved')}</span>}
            </div>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">{t('settings.legal')}</h2>
          <ul className="space-y-1.5 text-xs">
            {legalRates.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3 border-b border-stone-50 py-1">
                <span className="text-stone-600">{k}</span>
                <span className="font-medium text-stone-800">{v}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-stone-100 pt-3">
            <Button variant="danger" onClick={reset}>{t('settings.reset')}</Button>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <InfoNote>
          Barème ITS mensuel : 0 % jusqu’à 75 000 · 16 % de 75 001 à 240 000 · 21 % de 240 001 à 800 000 ·
          24 % de 800 001 à 2 400 000 · 28 % de 2 400 001 à 8 000 000 · 32 % au-delà.
          RICF : 11 000 FCFA par demi-part au-delà de la première.
        </InfoNote>
      </div>
    </div>
  );
}
