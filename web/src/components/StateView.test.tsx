import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, ListSkeleton, ErrorState } from './StateView';

// Az állapot-nézetek a launch-élmény gerince (az első hetekben minden
// user üres listákat lát) — itt a szerkezetüket őrizzük: cím + leírás +
// CTA renderelődik, a skeleton a kért sor-számot adja.

describe('EmptyState', () => {
  it('címet, leírást és CTA-t renderel', () => {
    render(
      <EmptyState
        title="Még nincs fuvarod"
        description="Add fel az elsőt."
        cta={<a className="btn" href="/dashboard/uj-fuvar">Fuvar feladása</a>}
      />,
    );
    expect(screen.getByText('Még nincs fuvarod')).toBeInTheDocument();
    expect(screen.getByText('Add fel az elsőt.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fuvar feladása' })).toHaveAttribute(
      'href', '/dashboard/uj-fuvar',
    );
  });

  it('másodlagos CTA is megjelenik, ha van', () => {
    render(
      <EmptyState
        title="Üres"
        cta={<button>Első</button>}
        secondaryCta={<button>Második</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Első' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Második' })).toBeInTheDocument();
  });

  it('emoji-string ikon (régi hívók) továbbra is működik', () => {
    render(<EmptyState icon="🔍" title="Nem található" />);
    expect(screen.getByText('🔍')).toBeInTheDocument();
  });
});

describe('ListSkeleton', () => {
  it('a kért számú váz-sort adja, betöltés-státuszként', () => {
    const { container } = render(<ListSkeleton rows={5} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelectorAll('.card').length).toBe(5);
    // Minden sorban van shimmer-elem
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(5);
  });
});

describe('ErrorState', () => {
  it('alert-ként renderel, retry-gombbal', () => {
    const retry = () => {};
    render(<ErrorState message="Szerverhiba" onRetry={retry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Szerverhiba')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Újrapróbálom' })).toBeInTheDocument();
  });
});
