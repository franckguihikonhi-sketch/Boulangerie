import { useMemo, useState } from 'react';
import { useStore } from '../lib/useStore';
import { useI18n } from '../i18n/I18nContext';
import { resumeAudit } from '../lib/audit';
import { Card, PageTitle, Field, inputClass, InfoNote, Badge } from '../components/ui';

const ACTION_LABEL = { create: 'Créé', update: 'Modifié', delete: 'Supprimé' };
const ACTION_TONE = { create: 'success', update: 'brand', delete: 'danger' };

function formatDate(iso, locale) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Historique des modifications salariés (qui a changé quoi, quand) — voir
// db.js (saveEmployee/deleteEmployee) pour la constitution de chaque entrée.
// Purement en lecture : aucune action n'est possible depuis cette page.
export default function Historique() {
  const { auditLog } = useStore();
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = auditLog || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      (e.employeeNom || '').toLowerCase().includes(q) || (e.utilisateur || '').toLowerCase().includes(q)
    );
  }, [auditLog, search]);

  return (
    <div>
      <PageTitle>{t('historique.title')}</PageTitle>
      <p className="mb-4 text-sm text-stone-500">{t('historique.subtitle')}</p>

      <Card className="p-4">
        <div className="max-w-sm">
          <Field label={t('historique.search')}>
            <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('historique.searchPlaceholder')} />
          </Field>
        </div>
      </Card>

      <div className="mt-4">
        {!auditLog || auditLog.length === 0 ? (
          <InfoNote>{t('historique.empty')}</InfoNote>
        ) : filtered.length === 0 ? (
          <InfoNote>{t('historique.noMatch')}</InfoNote>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((entry) => (
              <Card key={entry.id} className="p-3.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone={ACTION_TONE[entry.action] || 'neutral'}>{ACTION_LABEL[entry.action] || entry.action}</Badge>
                  <p className="font-medium text-stone-800">{entry.employeeNom || t('historique.unknownEmployee')}</p>
                  <span className="ml-auto text-xs text-stone-400">{formatDate(entry.createdAt, locale)}</span>
                </div>
                {entry.utilisateur && (
                  <p className="mb-1 text-xs text-stone-500">{t('historique.by', { utilisateur: entry.utilisateur })}</p>
                )}
                <ul className="space-y-0.5 text-xs text-stone-600">
                  {resumeAudit(entry).map((ligne, i) => <li key={i}>• {ligne}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
