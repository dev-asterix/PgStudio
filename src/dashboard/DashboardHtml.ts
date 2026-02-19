import * as vscode from 'vscode';
import { DashboardStats } from '../common/types';

export async function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri, stats: DashboardStats): Promise<string> {
  const nonce = getNonce();
  const cspSource = webview.cspSource;

  try {
    const templatesDir = vscode.Uri.joinPath(extensionUri, 'templates', 'dashboard');
    const [htmlBuffer, cssBuffer, jsBuffer] = await Promise.all([
      vscode.workspace.fs.readFile(vscode.Uri.joinPath(templatesDir, 'index.html')),
      vscode.workspace.fs.readFile(vscode.Uri.joinPath(templatesDir, 'styles.css')),
      vscode.workspace.fs.readFile(vscode.Uri.joinPath(templatesDir, 'scripts.js'))
    ]);

    let html = new TextDecoder().decode(htmlBuffer);
    const css = new TextDecoder().decode(cssBuffer);
    let js = new TextDecoder().decode(jsBuffer);

    // Security: Content Security Policy
    const csp = `default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;`;

    // Inject Data safely
    js = js.replace('null; // __STATS_JSON__', JSON.stringify(stats));

    console.log('DashboardHtml: Loaded resources. HTML length:', html.length, 'CSS length:', css.length, 'JS length:', js.length);

    // Inject content
    // Use replacer function to avoid special replacement patterns (like $&) in the code/css
    // Inject content with flexible Regex: matches {{NAME}}, { { NAME } }, or /* NAME */
    const replacePlaceholder = (name: string, value: string) => {
      // Regex explanation:
      // 1. (?:\s*\{\s*\{\s*${name}\s*\}\s*\}\s*)  -> Matches curly braces with optional whitespace/split
      // 2. (?:\/\*\s*${name}\s*\*\/)              -> Matches /* NAME */ comments
      const regex = new RegExp(`(?:\\{\\s*\\{\\s*${name}\\s*\\}\\s*\\}|\\/\\*\\s*${name}\\s*\\*\\/)`);

      if (regex.test(html)) {
        html = html.replace(regex, () => value);
        console.log(`DashboardHtml: Successfully replaced ${name}`);
      } else {
        console.error(`DashboardHtml: Placeholder ${name} NOT found! Regex: ${regex.source}`);
        // Log start and end of HTML to debug
        console.log('DashboardHtml Head (500 chars):', html.substring(0, 500));
        console.log('DashboardHtml Tail (500 chars):', html.substring(html.length - 500));
      }
    };

    html = html.replace('{{CSP}}', () => csp);
    replacePlaceholder('INLINE_STYLES', css);
    replacePlaceholder('INLINE_SCRIPTS', js);

    html = html.replace('{{NONCE}}', () => nonce);

    console.log('DashboardHtml: Final HTML length:', html.length);
    return html;
  } catch (error) {
    console.error('Failed to load dashboard templates:', error);
    return getErrorHtml(error instanceof Error ? error.message : String(error));
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getErrorHtml(error: string) {
  return `<!DOCTYPE html>
    <html>
        <body style="padding: 20px; color: #f87171; font-family: sans-serif;">
            <h3>Dashboard Error</h3>
            <p>Failed to load dashboard resources.</p>
            <pre>${error}</pre>
        </body>
    </html>`;
}

export function getLoadingHtml(): string {
  return `<!DOCTYPE html>
    <html>
      <head><title>Loading</title></head>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;background-color: var(--vscode-editor-background);color: var(--vscode-editor-foreground);font-family: var(--vscode-font-family);">
        <h3 style="font-weight: normal;">Loading Dashboard...</h3>
      </body>
    </html>`;
}
