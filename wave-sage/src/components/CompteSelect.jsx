import { useMemo, useId } from 'react';
import { normaliserCompte } from '../data/planComptable';
import { useStore } from '../lib/useStore';
import { inputClass } from './ui';

// Sélecteur de compte général sur le plan comptable ÉDITABLE (magasin réactif).
// Champ texte + datalist : on saisit / choisit un numéro, l'intitulé s'affiche.
// Recherche possible par numéro OU par libellé (la datalist filtre nativement).
export default function CompteSelect({ value, onChange, compact = false }) {
  const listId = useId();
  const { plan } = useStore();
  const options = useMemo(
    () => plan.map((c) => ({ value: c.compte, label: `${c.compte} — ${c.intitule}` })),
    [plan]
  );
  const intitule = useMemo(() => {
    const n = normaliserCompte(value);
    const f = plan.find((c) => c.compte === n);
    return f ? f.intitule : '';
  }, [plan, value]);
  const inconnu = value && !intitule;

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <input
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value.trim())}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v) onChange(normaliserCompte(v)); // complète en 8 chiffres à la sortie
        }}
        placeholder="N° compte (8 chiffres)…"
        className={`${inputClass} ${compact ? 'py-1 text-sm' : ''} ${inconnu ? 'border-red-400' : ''}`}
        inputMode="numeric"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </datalist>
      {!compact && (
        <p className={`text-xs ${inconnu ? 'text-red-600' : 'text-stone-500'}`}>
          {inconnu ? 'Compte absent du plan (ajoutez-le dans « Plan comptable »)' : intitule || '—'}
        </p>
      )}
    </div>
  );
}
