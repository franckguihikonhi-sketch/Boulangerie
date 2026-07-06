import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// La clé se lit depuis l'environnement pour ne rien committer de sensible :
//   SUPABASE_URL=... SUPABASE_KEY=<clé> node scripts/seed.mjs
// Repli sur la clé publishable (publique) si non fournie.
const URL = process.env.SUPABASE_URL || 'https://llnmrlylpmswptancysq.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_oKTwjR1moLiwLMNxMPBV_g_cMe9cFDk';
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const author = 'admin@boulangerie.com';
const F = (base) => (base === 'unite' ? 1 : 1000);

async function main() {
  // 1) Les tables existent-elles ?
  const probe = await sb.from('ingredients').select('id').limit(1);
  if (probe.error) {
    if (/PGRST205|does not exist|schema cache/i.test(probe.error.message)) {
      console.log('TABLES_ABSENTES : exécutez supabase/setup.sql dans Supabase avant de relancer.');
      process.exit(2);
    }
    throw probe.error;
  }

  // 2) Déjà peuplée ? (évite les doublons)
  const count = await sb.from('ingredients').select('id', { count: 'exact', head: true });
  if ((count.count || 0) > 0) {
    console.log(`Base déjà peuplée (${count.count} ingrédients). Aucune action.`);
    await report();
    return;
  }

  console.log('Base vide → insertion des données de démonstration…');

  const mkIng = async (name, type, base_unit, min_threshold, unit_cost) => {
    const { data, error } = await sb.from('ingredients')
      .insert({ name, type, base_unit, min_threshold, unit_cost }).select('id').single();
    if (error) throw error;
    return { id: data.id, base_unit };
  };
  const farine = await mkIng('Farine de blé', 'matiere_premiere', 'g', 20000, 400);
  const sel = await mkIng('Sel', 'matiere_premiere', 'g', 2000, 650);
  const sucre = await mkIng('Sucre', 'matiere_premiere', 'g', 5000, 800);
  const beurre = await mkIng('Beurre', 'matiere_premiere', 'g', 3000, 3500);
  const levure = await mkIng('Levure boulangère', 'matiere_premiere', 'g', 1000, 2500);
  const lait = await mkIng('Lait', 'matiere_premiere', 'ml', 5000, 500);
  const chocolat = await mkIng('Chocolat pâtissier', 'matiere_premiere', 'g', 1000, 4000);
  const eau = await mkIng('Eau', 'charge_utilite', 'ml', 10000, 1);
  const elec = await mkIng('Électricité (kWh)', 'charge_utilite', 'unite', 20, 150);

  const mkProd = async (name, category, selling_price) => {
    const { data, error } = await sb.from('products')
      .insert({ name, category, selling_price }).select('id').single();
    if (error) throw error;
    return data.id;
  };
  const baguette = await mkProd('Baguette', 'pain', 150);
  const painComplet = await mkProd('Pain complet', 'pain', 250);
  const croissant = await mkProd('Croissant', 'viennoiserie', 300);
  const painChoco = await mkProd('Pain au chocolat', 'viennoiserie', 350);

  const addRecipe = async (product_id, lines) => {
    const { error } = await sb.from('recipes').insert(
      lines.map(([ing, qty_base]) => ({ product_id, ingredient_id: ing.id, qty_base }))
    );
    if (error) throw error;
  };
  await addRecipe(baguette, [[farine, 250], [sel, 5], [levure, 3], [eau, 150], [elec, 0.1]]);
  await addRecipe(painComplet, [[farine, 400], [sel, 8], [levure, 5], [eau, 220], [elec, 0.15]]);
  await addRecipe(croissant, [[farine, 80], [beurre, 30], [sucre, 10], [levure, 2], [lait, 30], [elec, 0.1]]);
  await addRecipe(painChoco, [[farine, 80], [beurre, 30], [chocolat, 25], [sucre, 10], [levure, 2], [elec, 0.1]]);

  const purchase = async (ing, qty_base, unit_cost, supplier) => {
    const { error } = await sb.rpc('record_purchase', {
      p_ingredient: ing.id, p_qty_base: qty_base, p_unit_cost: unit_cost,
      p_supplier: supplier, p_note: '', p_idempotency_key: randomUUID(), p_author: author
    });
    if (error) throw error;
  };
  await purchase(farine, 150000, 400, "Moulins d'Abidjan");
  await purchase(sel, 19000, 650, 'Marché central');
  await purchase(sucre, 25000, 800, 'Marché central');
  await purchase(beurre, 15000, 3500, 'Laiterie Ivoire');
  await purchase(levure, 5000, 2500, "Moulins d'Abidjan");
  await purchase(lait, 20000, 500, 'Laiterie Ivoire');
  await purchase(chocolat, 5000, 4000, 'Pâtis-Fournitures');
  await purchase(eau, 150000, 1, 'SODECI');
  await purchase(elec, 200, 150, 'CIE');

  const produce = async (product_id, quantity) => {
    const { error } = await sb.rpc('record_production', {
      p_product: product_id, p_quantity: quantity, p_note: '',
      p_idempotency_key: randomUUID(), p_author: author
    });
    if (error) throw error;
  };
  for (let d = 0; d < 5; d++) {
    await produce(baguette, 40);
    await produce(croissant, 24);
  }
  await produce(painComplet, 15);
  await produce(painChoco, 18);

  const sale = async (product_id, quantity, unit_price, client = '') => {
    const { error } = await sb.rpc('record_sale', {
      p_product: product_id, p_quantity: quantity, p_unit_price: unit_price,
      p_client: client, p_note: '', p_idempotency_key: randomUUID(), p_author: author
    });
    if (error) throw error;
  };
  await sale(baguette, 180, 150);
  await sale(croissant, 100, 300, 'Café du coin');
  await sale(painComplet, 12, 250);
  await sale(painChoco, 15, 350);

  // 3) Test d'idempotence : deux appels avec la MÊME clé = une seule production
  const key = randomUUID();
  const p1 = await sb.rpc('record_production', { p_product: baguette, p_quantity: 2, p_note: 'idem', p_idempotency_key: key, p_author: author });
  const p2 = await sb.rpc('record_production', { p_product: baguette, p_quantity: 2, p_note: 'idem', p_idempotency_key: key, p_author: author });
  console.log(`Idempotence : appel1=${p1.data?.slice(0,8)} appel2=${p2.data?.slice(0,8)} → ${p1.data === p2.data ? 'IDENTIQUE ✅ (pas de doublon)' : 'DIFFÉRENT ❌'}`);

  await report();
}

async function report() {
  const t = async (name) => (await sb.from(name).select('id', { count: 'exact', head: true })).count;
  console.log('\n--- Contenu de la base ---');
  console.log('ingredients   :', await t('ingredients'));
  console.log('products      :', await t('products'));
  console.log('recipes       :', await t('recipes'));
  console.log('purchases     :', await t('purchases'));
  console.log('productions   :', await t('productions'));
  console.log('sales         :', await t('sales'));
  console.log('stock_movements:', await t('stock_movements'));
  const { data: ing } = await sb.from('ingredients').select('name, unit_cost').eq('name', 'Beurre').single();
  if (ing) console.log(`CMP Beurre (arrondi entier) : ${ing.unit_cost} FCFA/kg`);
  console.log('✅ Vérification terminée.');
}

main().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
