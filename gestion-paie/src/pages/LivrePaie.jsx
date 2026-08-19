import { useState } from 'react';
import { useStore, useActivePeriod } from '../lib/useStore';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n/I18nContext';
import { formatFCFA } from '../lib/money';
import { libelleMois, moisSuivant } from '../lib/payroll';
import { cloturerMois, rouvrirMois } from '../lib/db';
import { setActivePeriod } from '../lib/period';
import {
  livrePaieData, livrePaieTotaux, livreDocumentHtml, imprimerLivrePaie, telechargerLivrePaie,
  telechargerVirementCsv
} from '../lib/livrePaie';
import { Button, Card, PageTitle, Field, inputClass, InfoNote, ErrorNote, Badge } from '../components/ui';

// Aperçu fidèle : on affiche EXACTEMENT le registre imprimé dans un iframe
// isolé, à l'échelle réduite (les colonnes sont nombreuses). « Ce qui est
// affiché est ce qui est imprimé. »
function RegisterPreview({ rows, ym, t, locale }) {
  const html = livreDocumentHtml(rows, ym, { t, locale });
  const onLoad = (ev) => {
    try {
      const doc = ev.target.contentDocument;
      ev.target.style.height = `${doc.documentElement.scrollHeight + 8}px`;
    } catch {
      /* iframe inaccessible : on garde la hauteur par défaut */
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 shadow-sm">
      <iframe
        title={`Livre de paie ${ym}`}
        srcDoc={html}
        onLoad={onLoad}
        className="block w-full"
        style={{ border: 0, minHeight: 300 }}
      />
    </div>
  );
}

export default function LivrePaie() {
  const { settings, employees, clotures } = useStore();
  const { user } = useAuth();
  const { t, locale } = useI18n();

  // Mois par défaut choisi via le bouton « Base » (en-tête).
  const activePeriod = useActivePeriod();
  const [ym, setYm] = useState(activePeriod);
  const [rows, setRows] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [clotureSaving, setClotureSaving] = useState(false);

  const cloture = clotures?.[ym] || null;
  const auditMeta = { utilisateur: user?.name || user?.email || '' };

  // Clôture le mois affiché : marqueur partagé (voir bouton « Base »), et
  // garde-fou contre toute modification ultérieure d'un salarié qui
  // changerait le bulletin déjà calculé de ce mois (voir lib/cloture.js).
  const cloturer = async () => {
    setError('');
    setNotice('');
    setClotureSaving(true);
    try {
      await cloturerMois(ym, auditMeta);
      setNotice(t('livrePaie.clotureDone', { mois: libelleMois(ym, locale) }));
    } catch (err) {
      setError(t(err.message) || err.message);
    } finally {
      setClotureSaving(false);
    }
  };

  const rouvrir = async () => {
    if (!window.confirm(t('livrePaie.reouvrirConfirm', { mois: libelleMois(ym, locale) }))) return;
    setError('');
    setNotice('');
    setClotureSaving(true);
    try {
      await rouvrirMois(ym);
      setNotice(t('livrePaie.reouvertDone', { mois: libelleMois(ym, locale) }));
    } catch (err) {
      setError(t(err.message) || err.message);
    } finally {
      setClotureSaving(false);
    }
  };

  // « Ouvrir un nouveau mois de paie » : bascule le mois affiché ET la
  // période active de toute l'appli (bouton « Base ») sur le mois suivant.
  const ouvrirMoisSuivant = () => {
    const next = moisSuivant(ym);
    setActivePeriod(next);
    setYm(next);
    setRows(null);
    setNotice('');
  };

  const build = () => {
    setError('');
    setNotice('');
    if (employees.length === 0) { setError(t('bulletins.noEmployees')); return; }
    // Bloquant : un salarié sous contrôle est exclu de l'état agrégé tant
    // que le contrôle n'est pas levé.
    const blocked = employees.filter((e) => e.sousControle);
    const targets = employees.filter((e) => !e.sousControle);
    if (blocked.length > 0) {
      setNotice(t('employees.blockedControle', { nom: blocked.map((e) => e.nom).join(', ') }));
    }
    setRows(livrePaieData(targets, ym, settings));
  };

  const runExport = async (fn) => {
    if (!rows || !rows.length || exporting) return;
    setNotice('');
    setExporting(true);
    try {
      const ok = await fn(rows, ym, { t, locale });
      setNotice(ok ? t('bulletins.downloaded') : t('bulletins.printFailed'));
    } finally {
      setExporting(false);
    }
  };

  const print = () => runExport(imprimerLivrePaie);
  const download = () => runExport(telechargerLivrePaie);
  const virement = () => {
    if (!rows || !rows.length) return;
    telechargerVirementCsv(rows, ym);
    setNotice(t('livrePaie.virementDownloaded'));
  };

  // Liste de paiement (tous les salariés, avec leur compte bancaire complet)
  // directement depuis la carte « Clôture du mois » : accessible en un clic
  // à la fin de la paie, sans devoir d'abord cliquer « Prévisualiser ».
  // Même export CSV que le bouton ci-dessus (matricule, nom, compte bancaire
  // intégral, net à payer), juste calculé à la volée pour ce mois.
  const telechargerListePaiement = () => {
    setError('');
    setNotice('');
    if (employees.length === 0) { setError(t('bulletins.noEmployees')); return; }
    const targets = employees.filter((e) => !e.sousControle);
    const data = livrePaieData(targets, ym, settings);
    if (data.length === 0) { setError(t('livrePaie.none')); return; }
    telechargerVirementCsv(data, ym);
    setNotice(t('livrePaie.virementDownloaded'));
  };

  const totaux = rows && rows.length ? livrePaieTotaux(rows) : null;

  return (
    <div>
      <PageTitle>{t('livrePaie.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('livrePaie.subtitle')}</p>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
          <Field label={t('livrePaie.month')}>
            <input className={inputClass} type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={build}>{t('bulletins.generate')}</Button>
          {rows && rows.length > 0 && (
            <>
              <Button onClick={print} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('livrePaie.print')}
              </Button>
              <Button variant="secondary" onClick={download} disabled={exporting}>
                {exporting ? t('bulletins.generating') : t('bulletins.download')}
              </Button>
              <Button variant="secondary" onClick={virement}>{t('livrePaie.virement')}</Button>
            </>
          )}
        </div>
        {notice && (
          <p className="mt-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{notice}</p>
        )}
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              {t('livrePaie.clotureTitle')}
              {cloture ? <Badge tone="success">{t('livrePaie.clotureBadge')}</Badge> : <Badge>{t('livrePaie.ouvertBadge')}</Badge>}
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              {cloture
                ? t('livrePaie.clotureInfo', {
                    date: new Date(cloture.clotureLe).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US'),
                    par: cloture.cloturePar || '—'
                  })
                : t('livrePaie.clotureHelp')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={telechargerListePaiement}>{t('livrePaie.listePaiement')}</Button>
            {cloture ? (
              <>
                <Button variant="secondary" onClick={rouvrir} disabled={clotureSaving}>
                  {clotureSaving ? t('livrePaie.clotureSaving') : t('livrePaie.reouvrir')}
                </Button>
                <Button onClick={ouvrirMoisSuivant}>{t('livrePaie.ouvrirSuivant')}</Button>
              </>
            ) : (
              <Button onClick={cloturer} disabled={clotureSaving}>
                {clotureSaving ? t('livrePaie.clotureSaving') : t('livrePaie.cloturer')}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-400">{t('livrePaie.listePaiementHelp')}</p>
      </Card>

      {rows && (
        <div className="mt-5">
          {rows.length === 0 ? (
            <InfoNote>{t('livrePaie.none')}</InfoNote>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm capitalize text-stone-600">{libelleMois(ym, locale)}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>{t('livrePaie.employeeCount')} : <strong>{rows.length}</strong></span>
                  <span>{t('slip.netAPayer')} : <strong className="text-brand-700">{formatFCFA(totaux.netAPayer, locale)}</strong></span>
                  <span>{t('slip.coutTotal')} : <strong>{formatFCFA(totaux.coutTotalEmployeur, locale)}</strong></span>
                </div>
              </div>
              <InfoNote>{t('livrePaie.previewNote')}</InfoNote>
              <div className="mt-3">
                <RegisterPreview rows={rows} ym={ym} t={t} locale={locale} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
