import { describe, expect, it } from 'vitest';
import { roundFCFA, formatFCFA, formatNum } from './money';

describe('roundFCFA', () => {
  it('arrondit à l\'entier le plus proche', () => {
    expect(roundFCFA(1000.4)).toBe(1000);
    expect(roundFCFA(1000.5)).toBe(1001);
    expect(roundFCFA(1000.6)).toBe(1001);
  });

  it('renvoie 0 pour une valeur non finie ou invalide', () => {
    expect(roundFCFA(NaN)).toBe(0);
    expect(roundFCFA(Infinity)).toBe(0);
    expect(roundFCFA(undefined)).toBe(0);
    expect(roundFCFA(null)).toBe(0);
    expect(roundFCFA('abc')).toBe(0);
  });

  it('convertit une chaîne numérique', () => {
    expect(roundFCFA('150000')).toBe(150000);
  });
});

describe('formatFCFA', () => {
  // Le séparateur de milliers « fr-FR » n'est pas une espace normale (U+0020)
  // mais une espace fine insécable (U+202F) — on le recalcule via
  // toLocaleString plutôt que de le coder en dur, pour ne pas dépendre d'un
  // caractère Unicode invisible dans le code source du test.
  it('formate avec séparateur de milliers et suffixe FCFA (fr)', () => {
    expect(formatFCFA(150000, 'fr')).toBe(`${(150000).toLocaleString('fr-FR')} FCFA`);
  });

  it('formate en anglais avec des virgules', () => {
    expect(formatFCFA(150000, 'en')).toBe('150,000 FCFA');
  });
});

describe('formatNum', () => {
  it('formate sans le suffixe FCFA', () => {
    expect(formatNum(150000, 'fr')).toBe((150000).toLocaleString('fr-FR'));
  });
});
