import { useRef, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { saveSettings, saveVersement, resetDemoData, isDemoMode, isLocalMode } from '../lib/db';
import { saveEmployee } from '../lib/cloture';
import { DEFAULT_PARAMS } from '../lib/payroll';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote } from '../components/ui';

const BACKUP_VERSION = 1;

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Carte « Sauvegarde des données » : export/import JSON complet (paramètres
// + salariés + versements CNPS/CMU), pour migrer vers un nouvel environnement
// ou se prémunir d'une perte de données. L'import RECRÉE toujours les
// salariés (jamais de fusion par id, qui échouerait sur une base différente
// de celle d'origine) : à utiliser sur une base vierge, pas pour fusionner
// avec des données déjà en place.
function BackupCard({ settings, employees, versements, t }) {
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // { ok, errors }
  const [confirming, setConfirming] = useState(null); // parsed backup en attente de confirmation

  const exportBackup = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`paieci-sauvegarde-${stamp}.json`, {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      employees,
      versements
    });
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileSelected = async (evt) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.employees)) throw new Error('format');
      setConfirming(data);
    } catch {
      setResult({ ok: 0, errors: [t('settings.backupInvalidFile')] });
    }
  };

  const runImport = async () => {
    const data = confirming;
    setConfirming(null);
    setImporting(true);
    const errors = [];
    let ok = 0;
    try {
      if (data.settings) {
        try {
          await saveSettings(data.settings);
        } catch (err) {
          errors.push(`${t('settings.title')} : ${t(err.message) || err.message}`);
        }
      }
      for (const emp of data.employees || []) {
        try {
          await saveEmployee({ ...emp, id: undefined }); // toujours une création (voir commentaire)
          ok += 1;
        } catch (err) {
          errors.push(`${emp.nom || '—'} : ${t(err.message) || err.message}`);
        }
      }
      for (const [ym, v] of Object.entries(data.versements || {})) {
        try {
          await saveVersement(ym, v);
        } catch {
          /* accessoire : n'empêche pas le reste de la restauration */
        }
      }
    } finally {
      setImporting(false);
      setResult({ ok, errors });
    }
  };

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-stone-800">{t('settings.backupTitle')}</h2>
      <p className="mb-3 text-xs text-stone-500">{t('settings.backupHelp')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={exportBackup}>{t('settings.backupExport')}</Button>
        <Button variant="secondary" onClick={pickFile} disabled={importing}>
          {importing ? t('settings.backupImporting') : t('settings.backupImport')}
        </Button>
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFileSelected} />
      </div>
      {result && (
        <p className="mt-2 text-xs text-stone-600">
          {t('settings.backupResult', { ok: result.ok, errors: result.errors.length })}
          {result.errors.length > 0 && (
            <span className="mt-1 block text-red-700">{result.errors.slice(0, 5).join(' · ')}</span>
          )}
        </p>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold text-stone-800">{t('settings.backupConfirmTitle')}</h3>
            <p className="mb-4 text-sm text-stone-600">
              {t('settings.backupConfirmBody', { n: (confirming.employees || []).length })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={runImport}>{t('settings.backupConfirmAction')}</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Parametres() {
  const { settings, employees, versements } = useStore();
  const { t } = useI18n();
  const [form, setForm] = useState({
    raisonSociale: settings.raisonSociale,
    employeurCnps: settings.employeurCnps,
    rccm: settings.rccm || '',
    compteContribuable: settings.compteContribuable || '',
    activite: settings.activite || '',
    logoDataUrl: settings.logoDataUrl || '',
    adresse: settings.adresse,
    modePaiement: settings.modePaiement || 'Virement',
    tauxAT: (settings.tauxAccidentTravail * 100).toString(),
    transportExonere: settings.transportExonere
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };

  // Limite raisonnable (fichier source, avant encodage base64) pour garder un
  // PDF léger et un temps de chargement correct de la page Paramètres.
  const LOGO_MAX_BYTES = 500 * 1024;

  const onLogoChange = (evt) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('settings.logoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set('logoDataUrl', reader.result);
    reader.onerror = () => setError(t('settings.logoReadError'));
    reader.readAsDataURL(file);
  };

  const removeLogo = () => set('logoDataUrl', '');

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await saveSettings({
        raisonSociale: form.raisonSociale.trim(),
        employeurCnps: form.employeurCnps.trim(),
        rccm: form.rccm.trim(),
        compteContribuable: form.compteContribuable.trim(),
        activite: form.activite.trim(),
        logoDataUrl: form.logoDataUrl,
        adresse: form.adresse.trim(),
        modePaiement: form.modePaiement,
        tauxAccidentTravail: Math.max(0, Number(form.tauxAT) || 0) / 100,
        transportExonere: Math.max(0, Number(form.transportExonere) || 0)
      });
      setSaved(true);
    } catch (err) {
      setError(t(err.message) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (window.confirm(t('settings.resetConfirm'))) resetDemoData();
  };

  const legalRates = [
    ['Retraite CNPS (salarié)', '6,3 %'],
    ['CMU', '1 000 FCFA/mois (500 salarié + 500 employeur)'],
    ['Prestations familiales (patronal)', '5,75 %'],
    ['Accident du travail (patronal)', '2 à 5 %'],
    ['Retraite CNPS (patronal)', '7,7 %'],
    ['Taxe d’apprentissage', '0,4 %'],
    ['Taxe FPC (mensuelle)', '0,6 %'],
    ['Impôt sur salaires — locaux', '1,2 %'],
    ['Impôt sur salaires — expatriés', '11,5 %'],
    ['Plafond retraite CNPS', DEFAULT_PARAMS.plafondCnps.toLocaleString('fr-FR') + ' FCFA'],
    ['Plafond prest. familiales / AT', DEFAULT_PARAMS.plafondPfAt.toLocaleString('fr-FR') + ' FCFA']
  ];

  return (
    <div>
      <PageTitle>{t('settings.title')}</PageTitle>

      {isLocalMode() && (
        <div className="mb-4">
          <InfoNote>{t('settings.localMode')}</InfoNote>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <form onSubmit={save} className="space-y-4">
            <h2 className="text-sm font-semibold text-stone-800">{t('settings.employer')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('settings.raisonSociale')}>
                <input className={inputClass} value={form.raisonSociale} onChange={(e) => set('raisonSociale', e.target.value)} />
              </Field>
              <Field label={t('settings.employeurCnps')} help={t('settings.employeurCnpsHelp')}>
                <input className={inputClass} value={form.employeurCnps} onChange={(e) => set('employeurCnps', e.target.value)} />
              </Field>
              <Field label={t('settings.rccm')}>
                <input className={inputClass} value={form.rccm} onChange={(e) => set('rccm', e.target.value)} />
              </Field>
              <Field label={t('settings.compteContribuable')}>
                <input className={inputClass} value={form.compteContribuable} onChange={(e) => set('compteContribuable', e.target.value)} />
              </Field>
              <Field label={t('settings.activite')}>
                <input className={inputClass} value={form.activite} onChange={(e) => set('activite', e.target.value)} />
              </Field>
              <Field label={t('settings.adresse')}>
                <input className={inputClass} value={form.adresse} onChange={(e) => set('adresse', e.target.value)} />
              </Field>
              <Field label={t('settings.modePaiement')}>
                <select className={inputClass} value={form.modePaiement} onChange={(e) => set('modePaiement', e.target.value)}>
                  {['Virement', 'Espèces', 'Chèque', 'Mobile Money'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>

            <Field label={t('settings.logo')} help={t('settings.logoHelp')}>
              <div className="flex items-center gap-3">
                {form.logoDataUrl && (
                  <img src={form.logoDataUrl} alt="Logo" className="h-14 w-auto rounded border border-stone-200 bg-white object-contain p-1" />
                )}
                <input
                  className="block text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={onLogoChange}
                />
                {form.logoDataUrl && (
                  <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={removeLogo}>
                    {t('settings.logoRemove')}
                  </button>
                )}
              </div>
            </Field>

            <h2 className="border-t border-stone-100 pt-4 text-sm font-semibold text-stone-800">{t('settings.payParams')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('settings.tauxAT')} help={t('settings.tauxATHelp')}>
                <input className={inputClass} type="number" step="0.1" min="0" value={form.tauxAT} onChange={(e) => set('tauxAT', e.target.value)} />
              </Field>
              <Field label={t('settings.transportExonere')} help={t('settings.transportExonereHelp')}>
                <input className={inputClass} type="number" min="0" value={form.transportExonere} onChange={(e) => set('transportExonere', e.target.value)} />
              </Field>
            </div>

            <ErrorNote>{error}</ErrorNote>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={saving}>{t('settings.save')}</Button>
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
          {isDemoMode() && (
            <div className="mt-4 border-t border-stone-100 pt-3">
              <Button variant="danger" onClick={reset}>{t('settings.reset')}</Button>
            </div>
          )}
        </Card>

        <div className="lg:col-span-3">
          <BackupCard settings={settings} employees={employees} versements={versements} t={t} />
        </div>
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
