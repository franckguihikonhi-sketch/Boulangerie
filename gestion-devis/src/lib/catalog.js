// Catalogue réel Fish-Afric, organisé par famille (source : listes fournies par
// le client). Les prix ci-dessous sont INDICATIFS (non communiqués sur les
// listes d'origine) — à ajuster dans l'écran « Articles ». Ils servent surtout
// à rendre le mode démonstration parlant.
//
// Ce fichier alimente le jeu d'essai (mode démo). En production, le catalogue
// vit en base (table `articles`) et s'édite depuis l'application.

// Familles d'articles (ordre d'affichage). Code technique -> libellé dans i18n
// (clé family.<code>).
export const ARTICLE_FAMILIES = ['poissons', 'viandes', 'frites', 'laitier'];

// { reference, designation, family, price } — price = prix unitaire indicatif.
export const CATALOG = [
  // -------------------------------- Poissons --------------------------------
  { reference: 'POI-001', designation: 'Belle Dame 400-800 GR - 10 Kg', family: 'poissons', price: 22000 },
  { reference: 'POI-002', designation: 'Belle Dame 800 + GR - 10 Kg', family: 'poissons', price: 26000 },
  { reference: 'POI-003', designation: 'Panga 400-1000 GR - 10 Kg', family: 'poissons', price: 18000 },
  { reference: 'POI-004', designation: 'Tilapia 200-300 G - 10 Kg', family: 'poissons', price: 15000 },
  { reference: 'POI-005', designation: 'Tilapia 300-500 G - 10 Kg', family: 'poissons', price: 17000 },
  { reference: 'POI-006', designation: 'Tilapia 500-800 G - 10 Kg', family: 'poissons', price: 20000 },
  { reference: 'POI-007', designation: 'Tilapia 800 GR+ - Kg', family: 'poissons', price: 2500 },
  { reference: 'POI-008', designation: 'Frozen Yellow Croakers - 20 Kg', family: 'poissons', price: 40000 },
  { reference: 'POI-009', designation: 'Frozen Yellow Croakers - 10 Kg', family: 'poissons', price: 21000 },
  { reference: 'POI-010', designation: 'Frozen Maquereaux 20kg Morroco', family: 'poissons', price: 38000 },
  { reference: 'POI-011', designation: 'Frozen Maquereaux 300-500 G - 10 Kg - China', family: 'poissons', price: 19000 },
  { reference: 'POI-012', designation: 'Chinchard - Frozen Atlantic Horse Mackerel - 20 Kg', family: 'poissons', price: 30000 },
  { reference: 'POI-013', designation: 'Frozen Sardine Whole Round - 10 Kg - 20/30', family: 'poissons', price: 16000 },
  { reference: 'POI-014', designation: 'Frozen Sardine Whole Round - 10 Kg - 10/20', family: 'poissons', price: 17000 },

  // --------------------------------- Viandes --------------------------------
  { reference: 'VIA-001', designation: 'BOBY VEAU ALLANA 18 Kg', family: 'viandes', price: 55000 },
  { reference: 'VIA-002', designation: 'Tranche De Viande - Allana 18 Kg', family: 'viandes', price: 60000 },
  { reference: 'VIA-003', designation: 'Viande Hachée - Allana 20 Kg', family: 'viandes', price: 65000 },
  { reference: 'VIA-004', designation: 'Museau 10 kg - Allana', family: 'viandes', price: 28000 },
  { reference: 'VIA-005', designation: 'COEUR DE BUFFLE - ALLANA 10 Kg', family: 'viandes', price: 20000 },
  { reference: 'VIA-006', designation: 'COEUR DE BUFFLE - ALLANA 18 Kg', family: 'viandes', price: 35000 },
  { reference: 'VIA-007', designation: 'COEUR DE BUFFLE - AL TAMAM 10 Kg', family: 'viandes', price: 20000 },
  { reference: 'VIA-008', designation: 'FOIE DE BOEUF - ALLANA 18 Kg', family: 'viandes', price: 30000 },
  { reference: 'VIA-009', designation: 'FOIE DE BOEUF EU - EMRET', family: 'viandes', price: 18000 },
  { reference: 'VIA-010', designation: 'FOIE DE BOEUF - OFFAL EXP', family: 'viandes', price: 17000 },
  { reference: 'VIA-011', designation: 'FOIE DE BOEUF - ALLANA 10 Kg', family: 'viandes', price: 17000 },
  { reference: 'VIA-012', designation: 'FOIE DE BOEUF - CONCEPCION 10 Kg', family: 'viandes', price: 17000 },
  { reference: 'VIA-013', designation: 'BABINE - ALLANA 18 Kg', family: 'viandes', price: 32000 },
  { reference: 'VIA-014', designation: 'BABINE - ALLANA 10 Kg', family: 'viandes', price: 18000 },
  { reference: 'VIA-015', designation: 'Tenderloin 3 LB CHAIN OFF - Friboi - PV', family: 'viandes', price: 9000 },
  { reference: 'VIA-016', designation: 'CUBE ROLL FRIBOI PV', family: 'viandes', price: 12000 },
  { reference: 'VIA-017', designation: 'BRISKET BONELESS - FRIBOI PV', family: 'viandes', price: 11000 },
  { reference: 'VIA-018', designation: 'Frozen Beef Glottis 10 Kg - Dinardi Menudencias - Argentina', family: 'viandes', price: 22000 },
  { reference: 'VIA-019', designation: 'Queue De Boeuf PV - Friboi', family: 'viandes', price: 8000 },
  { reference: 'VIA-020', designation: 'Pieds de boeuf 20 kg - ICC', family: 'viandes', price: 24000 },
  { reference: 'VIA-021', designation: 'Pieds de boeuf 20 Kg - Wimax', family: 'viandes', price: 24000 },
  { reference: 'VIA-022', designation: 'Pieds de boeuf 20 Kg - Italy', family: 'viandes', price: 26000 },
  { reference: 'VIA-023', designation: 'Pieds de boeuf 20 kg - LTN - Biovela', family: 'viandes', price: 25000 },
  { reference: 'VIA-024', designation: 'Rognon De Boeuf Friboi - 13.6 Kg', family: 'viandes', price: 20000 },
  { reference: 'VIA-025', designation: 'Rognon De Boeuf - 10 Kg - Argentina', family: 'viandes', price: 15000 },
  { reference: 'VIA-026', designation: 'Rognon 8 Kg - Premium Offal', family: 'viandes', price: 12000 },
  { reference: 'VIA-027', designation: 'Rognon De Boeuf Minerva - 13.6 Kg', family: 'viandes', price: 20000 },
  { reference: 'VIA-028', designation: 'Tripes De Boeuf 10 Kg - Premium Offal', family: 'viandes', price: 14000 },
  { reference: 'VIA-029', designation: 'Tripes De Boeuf 10 Kg - ZKW - Poland', family: 'viandes', price: 15000 },
  { reference: 'VIA-030', designation: 'Tripes De Boeuf 10 Kg - Dinardi Menudencias - Argentina', family: 'viandes', price: 15000 },
  { reference: 'VIA-031', designation: 'Tripes De Boeuf 10 Kg - ARGALL', family: 'viandes', price: 14000 },
  { reference: 'VIA-032', designation: 'Tripe De Boeuf 10 Kg - Allana', family: 'viandes', price: 14000 },
  { reference: 'VIA-033', designation: 'Tripes De Boeuf 10 Kg - MM - Netherlands', family: 'viandes', price: 15000 },
  { reference: 'VIA-034', designation: 'BABINE FRIBOI 15 Kg', family: 'viandes', price: 26000 },

  // ---------------------------- Frites surgelées ----------------------------
  { reference: 'FRI-001', designation: 'French Fries 7 MM B GRADE Short (4x2.5 Kg)', family: 'frites', price: 9000 }

  // Famille « Produit laitier » : aucun article communiqué pour l'instant.
  // Ajoutez-les depuis l'écran « Articles » quand la liste sera disponible.
];
