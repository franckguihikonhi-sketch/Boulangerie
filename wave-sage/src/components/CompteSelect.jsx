import { useMemo, useId } from 'react';
import { PLAN_COMPTABLE, intituleCompte } from '../data/planComptable';
import { inputClass } from './ui';

// Sélecteur de compte général sur le plan SYSCOHADA (1091 comptes).
// Champ texte + datalist : on saisit / choisit un numéro, l'intitulé s'affiche.
// Recherche possible par numéro OU par libellé (la datalist filtre nativement).
export default function CompteSelect({ value, onChange, compact = false }) {
  const listId = useId();
  const options = useMemo(
    () => PLAN_COMPTABLE.map((c) => ({ value: c.compte, label: `${c.compte} — ${c.intitule}` })),
    []
  );
  const intitule = intituleCompte(value);
  const inconnu = value && !intitule;

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <input
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="N° compte…"
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
          {inconnu ? 'Compte absent du plan SYSCOHADA' : intitule || '—'}
        </p>
      )}
    </div>
  );
}
