// AI-előzmény helper — kulcs-séma, sérült adat, kijelentkezési takarítás
// (audit P1 R1-7, 2026-09-28). A felületi őr: components/ai-elozmeny-fiokhatar.test.tsx.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_MESSAGE_MAX_LENGTH, aiErrorText, aiHistoryKey, clearAllAiHistory, clearAiHistory,
  readAiHistory, removeLegacyAiHistory, writeAiHistory,
} from './aiHistory';

beforeEach(() => localStorage.clear());

describe('aiHistory kulcs-séma', () => {
  it('fiókonként külön kulcs, a két fiók nem látja egymást', () => {
    writeAiHistory('a', [{ role: 'user', content: 'A kérdése' }]);
    expect(aiHistoryKey('a')).toBe('gofuvar_ai_history:a');
    expect(readAiHistory('a')).toEqual([{ role: 'user', content: 'A kérdése' }]);
    expect(readAiHistory('b')).toEqual([]);
  });

  it('üres lista mentése és a törlés a kulcsot is eltávolítja', () => {
    writeAiHistory('a', [{ role: 'user', content: 'x' }]);
    writeAiHistory('a', []);
    expect(localStorage.getItem(aiHistoryKey('a'))).toBeNull();
    writeAiHistory('a', [{ role: 'user', content: 'x' }]);
    clearAiHistory('a');
    expect(localStorage.getItem(aiHistoryKey('a'))).toBeNull();
  });

  it('sérült vagy idegen alakú tartalomból nem dob, és csak érvényes üzenetet ad vissza', () => {
    localStorage.setItem(aiHistoryKey('a'), '{nem json');
    expect(readAiHistory('a')).toEqual([]);
    localStorage.setItem(aiHistoryKey('a'), JSON.stringify({ role: 'user' }));
    expect(readAiHistory('a')).toEqual([]);
    localStorage.setItem(aiHistoryKey('a'), JSON.stringify([
      { role: 'user', content: 'jó' }, { role: 'system', content: 'rossz' }, { role: 'assistant', content: 7 }, null,
    ]));
    expect(readAiHistory('a')).toEqual([{ role: 'user', content: 'jó' }]);
  });

  it('a régi globális kulcs törölhető, és sosem olvasódik fiók nevében', () => {
    localStorage.setItem('gofuvar_ai_history', JSON.stringify([{ role: 'user', content: 'idegen' }]));
    expect(readAiHistory('a')).toEqual([]);
    removeLegacyAiHistory();
    expect(localStorage.getItem('gofuvar_ai_history')).toBeNull();
  });

  it('kijelentkezési takarítás: minden AI-előzmény megy, más kulcs marad', () => {
    writeAiHistory('a', [{ role: 'user', content: 'a' }]);
    writeAiHistory('b', [{ role: 'user', content: 'b' }]);
    localStorage.setItem('gofuvar_ai_history', '[]');
    localStorage.setItem('gofuvar_theme', 'dark');
    clearAllAiHistory();
    expect(Object.keys(localStorage)).toEqual(['gofuvar_theme']);
  });
});

describe('aiErrorText', () => {
  it('AI_MESSAGE_TOO_LONG → barátságos, a plafont megnevező szöveg', () => {
    const e = Object.assign(new Error('raw'), { code: 'AI_MESSAGE_TOO_LONG' });
    expect(aiErrorText(e)).toContain(`legfeljebb ${AI_MESSAGE_MAX_LENGTH} karakter`);
    expect(aiErrorText(e)).not.toContain('raw');
  });

  it('más hibánál a korábbi „Hiba: …" forma marad', () => {
    expect(aiErrorText(new Error('Időtúllépés'))).toBe('Hiba: Időtúllépés');
  });
});
