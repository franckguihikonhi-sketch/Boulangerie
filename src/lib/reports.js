// Agrégations financières et temporelles.
//
// Règles clés (sections 5.9, 5.10 et 6 du cahier des charges) :
//   - Dépenses (trésorerie)  = somme des achats de la période ;
//   - COGS                   = somme des total_cost FIGÉS des productions ;
//   - Marge produit (%)      = (CA − COGS) ÷ CA × 100, "n/a" si CA = 0 ;
//   - regroupement par jour sur UN SEUL fuseau horaire (Afrique/Abidjan) ;
//   - les enregistrements de test (préfixe TEST_) sont exclus des calculs.

import { roundFCFA } from './money';

export const TIMEZONE = 'Africa/Abidjan';

const dayFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

// Clé de jour "YYYY-MM-DD" dans le fuseau unique de l'application.
export function dayKey(isoDate) {
  return dayFmt.format(new Date(isoDate));
}

export function isTestName(name) {
  return /^TEST[_-]/i.test(name || '');
}

export function inPeriod(iso, from, to) {
  const k = dayKey(iso);
  if (from && k < from) return false;
  if (to && k > to) return false;
  return true;
}

// Synthèse financière d'une période. from / to : "YYYY-MM-DD" ou null.
export function financialSummary(s, from, to) {
  const productById = Object.fromEntries(s.products.map((p) => [p.id, p]));

  let revenue = 0;
  for (const v of s.sales) {
    if (!inPeriod(v.soldAt, from, to)) continue;
    if (isTestName(productById[v.productId]?.name)) continue;
    revenue += v.total;
  }

  let expenses = 0;
  for (const p of s.purchases) {
    if (!inPeriod(p.purchasedAt, from, to)) continue;
    expenses += p.totalCost;
  }

  let cogs = 0;
  for (const p of s.productions) {
    if (!inPeriod(p.producedAt, from, to)) continue;
    if (isTestName(productById[p.productId]?.name)) continue;
    cogs += p.totalCost;
  }

  return {
    revenue: roundFCFA(revenue),
    expenses: roundFCFA(expenses), // indicateur de trésorerie
    cogs: roundFCFA(cogs), // coût des marchandises produites
    cashProfit: roundFCFA(revenue - expenses), // Bénéfice = CA − Dépenses
    grossMargin: roundFCFA(revenue - cogs), // Marge brute = CA − COGS
    // Jamais de pourcentage extrême : null ("n/a") si CA = 0 (anomalie n°6).
    marginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null
  };
}

// Détail par produit : CA, COGS, bénéfice, marge (n/a si CA = 0).
export function perProductReport(s, from, to) {
  const rows = new Map();
  const ensure = (product) => {
    if (!rows.has(product.id)) {
      rows.set(product.id, { product, unitsSold: 0, unitsProduced: 0, revenue: 0, cogs: 0 });
    }
    return rows.get(product.id);
  };
  for (const v of s.sales) {
    const product = s.products.find((p) => p.id === v.productId);
    if (!product || isTestName(product.name) || !inPeriod(v.soldAt, from, to)) continue;
    const r = ensure(product);
    r.unitsSold += v.quantity;
    r.revenue += v.total;
  }
  for (const p of s.productions) {
    const product = s.products.find((x) => x.id === p.productId);
    if (!product || isTestName(product.name) || !inPeriod(p.producedAt, from, to)) continue;
    const r = ensure(product);
    r.unitsProduced += p.quantityProduced;
    r.cogs += p.totalCost;
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      profit: roundFCFA(r.revenue - r.cogs),
      marginPct: r.revenue > 0 ? Math.round(((r.revenue - r.cogs) / r.revenue) * 1000) / 10 : null
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Consommation par ingrédient : agrégée par IDENTIFIANT d'ingrédient, jamais
// par nom affiché — élimine les doublons visuels (anomalie n°5).
export function consumptionByIngredient(s, from, to) {
  const byId = new Map();
  for (const m of s.stockMovements) {
    if (m.reason !== 'production' || m.changeBase >= 0) continue;
    if (!inPeriod(m.createdAt, from, to)) continue;
    const ing = s.ingredients.find((i) => i.id === m.ingredientId);
    if (!ing || isTestName(ing.name)) continue;
    const row = byId.get(ing.id) || { ingredient: ing, consumedBase: 0 };
    row.consumedBase += -m.changeBase;
    byId.set(ing.id, row);
  }
  return [...byId.values()].sort((a, b) => b.consumedBase - a.consumedBase);
}

// Séries du graphique "7 derniers jours" : CA (ventes) et unités produites,
// regroupées sur le MÊME référentiel de dates / fuseau (anomalie n°14).
export function last7DaysSeries(s) {
  const productById = Object.fromEntries(s.products.map((p) => [p.id, p]));
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    days.push(dayKey(d.toISOString()));
  }
  const revenue = Object.fromEntries(days.map((k) => [k, 0]));
  const units = Object.fromEntries(days.map((k) => [k, 0]));
  for (const v of s.sales) {
    if (isTestName(productById[v.productId]?.name)) continue;
    const k = dayKey(v.soldAt);
    if (k in revenue) revenue[k] += v.total;
  }
  for (const p of s.productions) {
    if (isTestName(productById[p.productId]?.name)) continue;
    const k = dayKey(p.producedAt);
    if (k in units) units[k] += p.quantityProduced;
  }
  return days.map((k) => ({ day: k, revenue: revenue[k], units: units[k] }));
}
