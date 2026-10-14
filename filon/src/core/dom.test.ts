import { describe, it, expect } from 'vitest';
import { screenText } from './dom';

describe('dom', () => {
  it('shows a full no-break space before « ; ! ? » where the source has the narrow one; keeps it before « % » and between thousands', () => {
    expect(screenText('tier ; chaque')).toBe('tier ; chaque');
    expect(screenText('Confirmer ? Oui !')).toBe('Confirmer ? Oui !');
    expect(screenText('+25 % · 7 258')).toBe('+25 % · 7 258');
    expect(screenText('English; no space')).toBe('English; no space');
  });
});
