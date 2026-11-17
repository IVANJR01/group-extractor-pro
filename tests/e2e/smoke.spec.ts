import { expect, test } from '@playwright/test';
import { mockBackend } from './mockBackend';

const PAGES: [string, RegExp][] = [
  ['/', /Dashboard/], ['/importar', /Importar contatos/], ['/fontes', /Fontes de contatos/], ['/contatos', /Central de contatos/],
  ['/duplicidades', /Duplicidades/], ['/segmentos', /Segmentação/], ['/grupos', /Grupos de destino/], ['/convites', /Convites/],
  ['/relatorios', /Relatórios/], ['/historico', /Histórico/], ['/configuracoes', /Configurações/],
];

test('sem sessão mostra o login', async ({ page }) => {
  await mockBackend(page, { loggedIn: false });
  await page.goto('/');
  await expect(page).toHaveURL(/entrar/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('todas as páginas abrem sem erro', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockBackend(page);
  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('dashboard mostra indicadores do banco', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  await expect(page.getByText('Contatos únicos')).toBeVisible();
  await expect(page.getByText('2.200', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/dashboard-${test.info().project.name}.png`, fullPage: true });
});

test('menu lateral navega (drawer no celular)', async ({ page, isMobile }) => {
  await mockBackend(page);
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('link', { name: 'Central de contatos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Central de contatos' })).toBeVisible();
  await page.screenshot({ path: `test-results/contatos-${test.info().project.name}.png`, fullPage: true });
});

test('importação CSV completa: arquivo → origem → mapear → validar → importar → relatório', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/importar');
  const csv = 'Nome;Telefone\nMaria;(11) 99999-9999\nJoão;11 98888-8888\nMaria Silva;+55 11 99999-9999\nErro;123\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'grupo-x.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Fonte').selectOption('src-x');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('cell', { name: 'Maria Silva' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByLabel(/Telefone → phone/)).toHaveValue('1');
  await page.getByRole('button', { name: 'Validar registros' }).click();
  await expect(page.getByText('Telefones utilizáveis')).toBeVisible();
  await expect(page.getByText('Repetidos no arquivo').locator('..')).toContainText('1');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('+55 11 99999 9999').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const go = page.getByRole('button', { name: 'Importar agora' });
  await expect(go).toBeDisabled();
  await page.getByText('Confirmo que esta lista foi obtida').click();
  await go.click();
  await expect(page.getByRole('heading', { name: 'Importação concluída' })).toBeVisible();
  await page.screenshot({ path: `test-results/importacao-${test.info().project.name}.png`, fullPage: true });
});

test('arquivo com extensão inválida é recusado', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/importar');
  await page.locator('input[type=file]').setInputFiles({ name: 'lista.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
  await expect(page.getByText('Extensão inválida')).toBeVisible();
});
