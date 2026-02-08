import * as vscode from 'vscode';

interface ExplainNode {
  name: string;
  cost?: string;
  actual?: string;
  rows?: number;
  loops?: number;
  extra?: Record<string, any>;
  children?: ExplainNode[];
}

export class ExplainProvider {
  private static panel: vscode.WebviewPanel | undefined;

  public static show(extensionUri: vscode.Uri, planJson: any, query?: string): void {
    if (!ExplainProvider.panel) {
      ExplainProvider.panel = vscode.window.createWebviewPanel(
        'postgres-explain-plan',
        'EXPLAIN ANALYZE Plan',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      ExplainProvider.panel.onDidDispose(() => (ExplainProvider.panel = undefined));
    }

    const plan = ExplainProvider.parsePlan(planJson);
    ExplainProvider.panel.webview.html = ExplainProvider.renderHtml(plan, query);
    ExplainProvider.panel.reveal(vscode.ViewColumn.Beside);
  }

  private static parsePlan(planJson: any): ExplainNode {
    let root = planJson;
    if (Array.isArray(planJson)) {
      root = planJson[0];
    }
    if (root && root.Plan) {
      root = root.Plan;
    }
    return ExplainProvider.toNode(root);
  }

  private static toNode(plan: any): ExplainNode {
    const node: ExplainNode = {
      name: plan?.['Node Type'] || 'Plan',
      cost: ExplainProvider.formatCost(plan),
      actual: ExplainProvider.formatActual(plan),
      rows: plan?.['Actual Rows'] ?? plan?.['Plan Rows'],
      loops: plan?.['Actual Loops'],
      extra: ExplainProvider.extractExtras(plan),
      children: []
    };

    const children = plan?.Plans || [];
    for (const child of children) {
      node.children?.push(ExplainProvider.toNode(child));
    }
    return node;
  }

  private static formatCost(plan: any): string | undefined {
    if (plan?.['Startup Cost'] !== undefined && plan?.['Total Cost'] !== undefined) {
      return `${plan['Startup Cost']} → ${plan['Total Cost']}`;
    }
    return undefined;
  }

  private static formatActual(plan: any): string | undefined {
    if (plan?.['Actual Startup Time'] !== undefined && plan?.['Actual Total Time'] !== undefined) {
      return `${plan['Actual Startup Time']}ms → ${plan['Actual Total Time']}ms`;
    }
    return undefined;
  }

  private static extractExtras(plan: any): Record<string, any> {
    const extras: Record<string, any> = {};
    const keys = ['Relation Name', 'Schema', 'Index Name', 'Filter', 'Join Filter', 'Hash Cond', 'Merge Cond', 'Rows Removed by Filter'];
    for (const key of keys) {
      if (plan?.[key] !== undefined) {
        extras[key] = plan[key];
      }
    }
    return extras;
  }

  private static renderHtml(root: ExplainNode, query?: string): string {
    const renderNode = (node: ExplainNode): string => {
      const extras = node.extra && Object.keys(node.extra).length > 0
        ? `<div class="extras">${Object.entries(node.extra).map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('')}</div>`
        : '';

      const meta = [
        node.cost ? `<span class="meta">Cost: ${node.cost}</span>` : '',
        node.actual ? `<span class="meta">Actual: ${node.actual}</span>` : '',
        node.rows !== undefined ? `<span class="meta">Rows: ${node.rows}</span>` : '',
        node.loops !== undefined ? `<span class="meta">Loops: ${node.loops}</span>` : ''
      ].filter(Boolean).join('');

      const children = node.children?.length
        ? `<ul>${node.children.map(renderNode).join('')}</ul>`
        : '';

      return `
        <li>
          <div class="node">
            <div class="title">${node.name}</div>
            <div class="meta-row">${meta}</div>
            ${extras}
          </div>
          ${children}
        </li>
      `;
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>EXPLAIN ANALYZE</title>
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
          .query { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); padding: 8px; margin-bottom: 16px; white-space: pre-wrap; }
          ul { list-style: none; padding-left: 20px; }
          .node { padding: 8px 12px; border: 1px solid var(--vscode-widget-border); margin-bottom: 8px; border-radius: 4px; background: var(--vscode-editor-background); }
          .title { font-weight: 600; margin-bottom: 4px; }
          .meta-row { display: flex; gap: 12px; flex-wrap: wrap; color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 6px; }
          .extras { font-size: 12px; color: var(--vscode-descriptionForeground); }
          .meta { background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        ${query ? `<div class="query">${query}</div>` : ''}
        <ul>
          ${renderNode(root)}
        </ul>
      </body>
      </html>
    `;
  }
}
