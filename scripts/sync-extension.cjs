const fs = require('fs');
const path = require('path');

const contentJs = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
const manifestJson = fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(__dirname, '../extension/content.css'), 'utf8');

const extZipContent = `import JSZip from 'jszip';

const POPUP_HTML = ${JSON.stringify(popupHtml)};

const POPUP_JS = ${JSON.stringify(popupJs)};

const BACKGROUND_JS = ${JSON.stringify(backgroundJs)};

const CONTENT_JS = ${JSON.stringify(contentJs)};

const CONTENT_CSS = ${JSON.stringify(contentCss)};

export async function generateExtensionZipBlob(): Promise<Blob> {
  const zip = new JSZip();
  const manifest = ${manifestJson};

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('popup.html', POPUP_HTML);
  zip.file('popup.js', POPUP_JS);
  zip.file('background.js', BACKGROUND_JS);
  zip.file('content.js', CONTENT_JS);
  zip.file('content.css', CONTENT_CSS);

  return zip.generateAsync({ type: 'blob' });
}
`;

fs.writeFileSync(path.join(__dirname, '../src/utils/extensionZip.ts'), extZipContent);

const consoleScriptContent = `/**
 * Código JavaScript autossuficiente para execução direta no console do navegador (F12) no WhatsApp Web (v2.3).
 */
export const WHATSAPP_CONSOLE_SCRIPT = ${JSON.stringify(contentJs)};
`;

fs.writeFileSync(path.join(__dirname, '../src/utils/whatsappConsoleScript.ts'), consoleScriptContent);

console.log('Arquivos sincronizados com sucesso!');
