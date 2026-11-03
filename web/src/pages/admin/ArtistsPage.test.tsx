import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cat, seedAlbum } from '../../../test/mock-catalog';
import { renderApp } from '../../../test/render';

describe('Artists and albums admin', () => {
  it('creates an artist and opens their page', async () => {
    const { user } = renderApp('/admin/artists', { as: 'admin' });
    expect(await screen.findByText('No artists yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New artist' }));
    const dialog = await screen.findByRole('dialog', { name: 'New artist' });
    await user.type(within(dialog).getByLabelText('Name'), 'Miles Davis');
    await user.click(within(dialog).getByRole('button', { name: 'Create artist' }));

    expect(await screen.findByDisplayValue('Miles Davis')).toBeInTheDocument();
    expect(cat.artists.map((a) => a.name)).toEqual(['Miles Davis']);
    expect(screen.getByRole('button', { name: 'Delete artist' })).toBeInTheDocument();
  });

  it('lists albums with their artist and track count', async () => {
    seedAlbum();
    renderApp('/admin/albums', { as: 'admin' });
    const row = (await screen.findByRole('link', { name: 'Pastel Blues' })).closest('tr')!;
    expect(within(row).getByText('Nina Simone')).toBeInTheDocument();
    expect(within(row).getByText('1965')).toBeInTheDocument();
  });

  it('shows the admin catalog links only to admins', async () => {
    renderApp('/', { as: 'listener' });
    await screen.findByRole('heading', { name: /, Ann$/ });
    expect(screen.queryByRole('link', { name: 'Albums' })).not.toBeInTheDocument();
  });
});
