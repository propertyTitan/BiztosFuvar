'use client';

// AI-asszisztens beszélgetés-előzménye — FIÓKHOZ kötve (audit P1 R1-7, 2026-09-28).
//
// A teljes oldalas AI segéd eddig fiókfüggetlen 'gofuvar_ai_history' kulcsba
// írt, a kijelentkezés nem törölte, a lebegő widget pedig „migrációként"
// átvette, ha az új fióknak nem volt saját előzménye — közös böngészőben a B
// fiók megkapta az A fiók teljes beszélgetését (és az ment kontextusként a
// Geminihez). Ugyanaz az osztály, mint a GF-006 mód-kulcs és a D3 piszkozat.
// Mostantól: egy kulcs-séma, egy hook, amit a widget ÉS az oldal is használ;
// a régi kulcsot soha nem olvassuk, csak töröljük; kijelentkezéskor minden
// AI-előzmény törlődik. Közvetlen localStorage-hozzáférés az előzményhez
// TILOS (forrás-őr: components/ai-elozmeny-fiokhatar.test.tsx).
import { useCallback, useEffect, useRef, useState } from 'react';

export type AiMessage = { role: 'user' | 'assistant'; content: string };

/** A régi, fiókfüggetlen kulcs (és a fiókonkénti kulcsok előtagja). */
const KULCS_ELOTAG = 'gofuvar_ai_history';
const EVENT = 'gofuvar:ai-history';

/** A backend is ennyinél vág el (AI_MESSAGE_TOO_LONG) — a mezők maxLength-je. */
export const AI_MESSAGE_MAX_LENGTH = 2000;

export function aiHistoryKey(userId: string): string {
  return `${KULCS_ELOTAG}:${userId}`;
}

function ertesit(userId: string | null) {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { userId } })); } catch { /* SSR */ }
}

/** A fiók előzménye; sérült / idegen alakú tartalomnál üres lista. Sose dob. */
export function readAiHistory(userId: string): AiMessage[] {
  try {
    const nyers = window.localStorage.getItem(aiHistoryKey(userId));
    const lista: unknown = nyers ? JSON.parse(nyers) : [];
    if (!Array.isArray(lista)) return [];
    return lista.filter((m): m is AiMessage => !!m
      && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  } catch {
    return [];
  }
}

/** Mentés a fiók kulcsára (üres lista = törlés) + a többi felület értesítése. */
export function writeAiHistory(userId: string, messages: AiMessage[]): void {
  try {
    if (messages.length === 0) window.localStorage.removeItem(aiHistoryKey(userId));
    else window.localStorage.setItem(aiHistoryKey(userId), JSON.stringify(messages));
  } catch { /* privát mód / tele tároló: nincs előzmény */ }
  ertesit(userId);
}

export function clearAiHistory(userId: string): void {
  writeAiHistory(userId, []);
}

/** A régi, fiókfüggetlen kulcs törlése — a tartalmát SOHA nem vesszük át. */
export function removeLegacyAiHistory(): void {
  try { window.localStorage.removeItem(KULCS_ELOTAG); } catch { /* nincs tároló */ }
}

/**
 * Kijelentkezéskor: MINDEN AI-előzmény (a kilépő fióké, a lejárt munkamenetek
 * után maradtak és a régi globális kulcs) törlése — a fuvarpiszkozat mintájára.
 */
export function clearAllAiHistory(): void {
  try {
    const kulcsok: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && (k === KULCS_ELOTAG || k.startsWith(`${KULCS_ELOTAG}:`))) kulcsok.push(k);
    }
    kulcsok.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* nincs tároló */ }
  ertesit(null);
}

/** Barátságos hibaszöveg az AI-hívás kudarcára (a backend kódja a hibán). */
export function aiErrorText(e: unknown): string {
  if ((e as { code?: string } | null)?.code === 'AI_MESSAGE_TOO_LONG') {
    return `Az üzeneted túl hosszú: legfeljebb ${AI_MESSAGE_MAX_LENGTH} karakter lehet. `
      + 'Rövidítsd le, és küldd el újra.';
  }
  return `Hiba: ${e instanceof Error ? e.message : String(e)}`;
}

type Allapot = { owner: string | null; messages: AiMessage[]; dirty: boolean };

/**
 * A bejelentkezett fiók AI-előzménye. Az állapot a TULAJDONOS id-jával
 * együtt él: fiókváltáskor (újratöltés nélkül is) azonnal üres, majd a
 * friss fiók kulcsáról töltődik; egy késve érkező válasz csak annak a
 * fióknak az előzményébe kerülhet, amelyik a kérdést feltette. A widget és
 * az oldal ugyanazt a kulcsot olvassa, és egymás mentésére frissül.
 */
export function useAiHistory(userId: string | null | undefined) {
  const owner = userId ?? null;
  const [allapot, setAllapot] = useState<Allapot>({ owner: null, messages: [], dirty: false });
  const tulajRef = useRef<string | null>(owner);
  useEffect(() => { tulajRef.current = owner; }, [owner]);

  useEffect(() => {
    removeLegacyAiHistory();
    setAllapot({ owner, messages: owner ? readAiHistory(owner) : [], dirty: false });
    if (!owner) return;
    const ujraolvas = (e: Event) => {
      if (e instanceof StorageEvent) {
        if (e.key !== null && e.key !== aiHistoryKey(owner)) return;
      } else {
        const cel = (e as CustomEvent<{ userId: string | null }>).detail?.userId;
        if (cel !== null && cel !== owner) return;
      }
      setAllapot({ owner, messages: readAiHistory(owner), dirty: false });
    };
    window.addEventListener(EVENT, ujraolvas);
    window.addEventListener('storage', ujraolvas);
    return () => {
      window.removeEventListener(EVENT, ujraolvas);
      window.removeEventListener('storage', ujraolvas);
    };
  }, [owner]);

  // Csak a helyi változást mentjük (dirty) — az újraolvasás nem ír vissza,
  // így két felület nem pörgeti egymást végtelen körben.
  useEffect(() => {
    if (allapot.dirty && allapot.owner) writeAiHistory(allapot.owner, allapot.messages);
  }, [allapot]);

  /** Módosítás a MEGADOTT fiók nevében; ha közben fiókváltás volt, eldobjuk. */
  const update = useCallback((forOwner: string, fn: (prev: AiMessage[]) => AiMessage[]) => {
    setAllapot((prev) => (prev.owner === forOwner
      ? { owner: forOwner, messages: fn(prev.messages), dirty: true }
      : prev));
  }, []);

  const clear = useCallback(() => {
    if (owner) update(owner, () => []);
  }, [owner, update]);

  /** Még mindig ez a fiók van-e belépve (késve érkező válasz utáni UI-lépéshez). */
  const isOwner = useCallback((id: string) => tulajRef.current === id, []);

  return {
    messages: allapot.owner === owner ? allapot.messages : [],
    update,
    clear,
    isOwner,
  };
}
