import { useState, useEffect } from 'react';
import { setParametres } from '../lib/db';
import { Button, Card, Field, InfoNote, inputClass } from '../components/ui';
import CompteSelect from '../components/CompteSelect';

export default function Parametres({ store, backend }) {
  const { parametres } = store;
  const [form, setForm] = useState(parametres);
  const [ok, setOk] = useState(false);
  useEffect(() => setForm(parametres), [parametres]);
  const set = (p) => {
    setForm((f) => ({ ...f, ...p }));
    setOk(false);
  };

  const enregistrer = async (e) => {
    e.preventDefault();
    await setParametres(form);
    setOk(true);
  };

  return (
    <div className="space-y-6">
      <Card
        title="Paramètres comptables"
        subtitle="Comptes fixes appliqués à chaque écriture. Le solde Wave est un compte de trésorerie ; les frais Wave sont une charge financière."
      >
        <form onSubmit={enregistrer} className="grid gap-4 sm:grid-cols-2">
          <Field label="Code journal SAGE" hint="Journal de destination dans SAGE (par défaut la caisse : CAI).">
            <input value={form.journal} onChange={(e) => set({ journal: e.target.value.toUpperCase() })} className={inputClass} maxLength={6} />
          </Field>
          <Field label="Intitulé du journal">
            <input value={form.intituleJournal} onChange={(e) => set({ intituleJournal: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Compte de trésorerie (solde Wave)" hint="Base réelle : 55200000 Monnaie téléphonique portable.">
            <CompteSelect value={form.compteTresorerie} onChange={(c) => set({ compteTresorerie: c })} />
          </Field>
          <Field label="Compte des frais Wave" hint="Base réelle : 63170000 Frais sur instruments de monnaie électronique.">
            <CompteSelect value={form.compteFrais} onChange={(c) => set({ compteFrais: c })} />
          </Field>
          <Field label="Compte de charge par défaut" hint="Paiements non reconnus par une règle.">
            <CompteSelect value={form.compteChargeDefaut} onChange={(c) => set({ compteChargeDefaut: c })} />
          </Field>
          <Field label="Compte de produit par défaut" hint="Encaissements non reconnus par une règle.">
            <CompteSelect value={form.compteProduitDefaut} onChange={(c) => set({ compteProduitDefaut: c })} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit">Enregistrer les paramètres</Button>
            {ok && <span className="text-sm text-emerald-700">✔ Enregistré</span>}
          </div>
        </form>
      </Card>

      <Card title="Base de données" subtitle="Cette application possède sa propre base, indépendante des autres projets du dépôt.">
        <InfoNote tone={backend === 'supabase' ? 'success' : 'info'}>
          {backend === 'supabase' ? (
            <>Base <strong>Supabase dédiée connectée</strong> : paramètres, règles, mappings et historique sont partagés entre appareils.</>
          ) : (
            <>
              Mode <strong>local (navigateur)</strong> : tout fonctionne sans configuration, les données restent sur cet appareil.
              Pour une base partagée, créez un projet Supabase dédié, exécutez <code>supabase/setup.sql</code>, puis renseignez
              <code> VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code>.
            </>
          )}
        </InfoNote>
      </Card>
    </div>
  );
}
