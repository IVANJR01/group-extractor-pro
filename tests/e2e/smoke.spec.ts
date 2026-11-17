import { expect, test } from '@playwright/test';
import { mockBackend } from './mockBackend';

const PAGES: [string, RegExp][] = [
  ['/', /Dashboard/], ['/importar', /Importar contatos/], ['/fontes', /Fontes de contatos/], ['/contatos', /Central de contatos/],
  ['/duplicidades', /Duplicidades/], ['/segmentos', /Segmentação/], ['/grupos', /Grupos de destino/], ['/inscricoes', /Páginas de inscrição/], ['/convites', /Convites/],
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

test('página pública de inscrição: valida, exige autorização e mostra o botão do grupo', async ({ page }) => {
  const state = await mockBackend(page, { loggedIn: false });
  await page.goto('/i/abc123def456');
  await expect(page.getByRole('heading', { name: 'Grupo VIP Segurança do Trabalho' })).toBeVisible();
  await page.getByLabel('Seu nome').fill('Maria Souza');
  await page.getByLabel('Seu WhatsApp (com DDD)').fill('84 9999-0001');
  await page.getByRole('button', { name: 'Quero me inscrever' }).click();
  await expect(page.getByText('9 dígitos')).toBeVisible();
  await expect(page.getByText('Marque a autorização')).toBeVisible();
  await page.getByLabel('Seu WhatsApp (com DDD)').fill('(84) 99999-0001');
  await page.getByText('Autorizo Ivan Treinamentos').click();
  await page.screenshot({ path: `test-results/inscricao-form-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Quero me inscrever' }).click();
  await expect(page.getByRole('heading', { name: 'Inscrição confirmada!' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Entrar no grupo Grupo A/ })).toHaveAttribute('href', 'https://chat.whatsapp.com/AbCdEfGhIjKlMn');
  expect(state.signups[0]).toMatchObject({ p_slug: 'abc123def456', p_name: 'Maria Souza', p_phone: '+5584999990001', p_consent: true });
  await page.screenshot({ path: `test-results/inscricao-ok-${test.info().project.name}.png`, fullPage: true });
});

test('página de inscrição inexistente mostra aviso', async ({ page }) => {
  await mockBackend(page, { loggedIn: false });
  await page.goto('/i/naoexiste0000');
  await expect(page.getByRole('heading', { name: 'Inscrições encerradas' })).toBeVisible();
});

test('gestão das páginas de inscrição', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/inscricoes');
  await expect(page.getByText('37')).toBeVisible();
  await expect(page.getByText('/i/abc123def456')).toBeVisible();
  await page.getByRole('button', { name: 'Nova página' }).click();
  await page.getByLabel('Quem coleta os dados').fill('Ivan Treinamentos');
  await page.getByRole('button', { name: 'Usar texto pronto' }).click();
  await expect(page.getByLabel('Texto da autorização')).toHaveValue(/Autorizo Ivan Treinamentos/);
  await page.screenshot({ path: `test-results/inscricoes-gestao-${test.info().project.name}.png`, fullPage: true });
});
