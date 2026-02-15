
export interface ExplainNode {
  'Node Type': string;
  'Total Cost': number;
  'Startup Cost': number;
  'Plan Rows': number;
  'Plan Width': number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: ExplainNode[];
  [key: string]: any;
}

export class ExplainVisualizer {
  private container: HTMLElement;
  private plan: ExplainNode;
  private maxCost: number = 0;

  constructor(container: HTMLElement, plan: any) {
    this.container = container;
    // Handle different plan formats (generic JSON w/ Plan key vs direct array)
    this.plan = (plan.Plan || (Array.isArray(plan) ? plan[0]?.Plan : plan)) as ExplainNode;
    this.calculateStats();
  }

  private calculateStats() {
    this.maxCost = this.findMaxCost(this.plan);
  }

  private findMaxCost(node: ExplainNode): number {
    let max = node['Total Cost'] || 0;
    if (node.Plans) {
      for (const child of node.Plans) {
        max = Math.max(max, this.findMaxCost(child));
      }
    }
    return max;
  }

  public render() {
    this.container.innerHTML = '';

    // Styles
    const style = document.createElement('style');
    style.textContent = `
      .explain-tree {
        font-family: var(--vscode-editor-font-family);
        font-size: 13px;
        padding: 20px;
        overflow: auto;
        height: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }
      .explain-node {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        margin: 8px 0;
        padding: 8px;
        background: var(--vscode-editor-background);
        position: relative;
        transition: all 0.2s;
      }
      .explain-node:hover {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }
      .explain-node-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
        cursor: pointer;
      }
      .explain-node-type {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .explain-node-stats {
        display: flex;
        gap: 12px;
        font-size: 0.9em;
        opacity: 0.8;
      }
      .explain-children {
        margin-left: 24px;
        border-left: 1px dashed var(--vscode-widget-border);
        padding-left: 12px;
      }
      .explain-details {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed var(--vscode-widget-border);
        font-size: 0.9em;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
      }
      .explain-detail-item {
        display: flex;
        flex-direction: column;
      }
      .explain-label {
        opacity: 0.6;
        font-size: 0.85em;
      }
      .cost-bar {
        height: 4px;
        background: var(--vscode-progressBar-background);
        margin-top: 4px;
        border-radius: 2px;
        opacity: 0.3;
      }
      .high-cost {
        border-left: 4px solid var(--vscode-errorForeground);
      }
      .medium-cost {
        border-left: 4px solid var(--vscode-charts-yellow);
      }
      .toggle-icon {
        width: 16px;
        text-align: center;
        transition: transform 0.2s;
      }
      .explain-node.collapsed .explain-children,
      .explain-node.collapsed .explain-details {
        display: none;
      }
      .explain-node.collapsed .toggle-icon {
        transform: rotate(-90deg);
      }
      .badge {
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.85em;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
    `;
    this.container.appendChild(style);

    const treeContainer = document.createElement('div');
    treeContainer.className = 'explain-tree';

    if (this.plan) {
      treeContainer.appendChild(this.createNodeElement(this.plan));
    } else {
      treeContainer.textContent = 'No plan data available';
    }

    this.container.appendChild(treeContainer);
  }

  private createNodeElement(node: ExplainNode): HTMLElement {
    const el = document.createElement('div');
    el.className = 'explain-node';

    // Heuristic for cost coloring
    const costRatio = (node['Total Cost'] || 0) / (this.maxCost || 1);
    if (costRatio > 0.5) el.classList.add('high-cost');
    else if (costRatio > 0.2) el.classList.add('medium-cost');

    // Header
    const header = document.createElement('div');
    header.className = 'explain-node-header';

    const typeSection = document.createElement('div');
    typeSection.className = 'explain-node-type';

    // Toggle
    if (node.Plans && node.Plans.length > 0) {
      const toggle = document.createElement('span');
      toggle.className = 'toggle-icon';
      toggle.textContent = '▼';
      typeSection.appendChild(toggle);

      header.onclick = (e) => {
        // Don't toggle if clicking specific actions if we add them later
        el.classList.toggle('collapsed');
        e.stopPropagation();
      };
    } else {
      typeSection.style.marginLeft = '16px';
    }

    const typeName = document.createElement('span');
    typeName.textContent = node['Node Type'];
    typeSection.appendChild(typeName);

    // Add badges for specific things (e.g. Scan direction, Strategy)
    if (node['Scan Direction'] === 'Backward') {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'Backward';
      typeSection.appendChild(b);
    }

    header.appendChild(typeSection);

    // Stats Summary
    const stats = document.createElement('div');
    stats.className = 'explain-node-stats';

    const actualTime = node['Actual Total Time'];
    const totalCost = node['Total Cost'];

    if (actualTime !== undefined) {
      stats.innerHTML = `<span>⏱️ ${actualTime.toFixed(2)}ms</span>`;
    }
    stats.innerHTML += `<span>💰 ${totalCost.toFixed(2)}</span>`;

    // Rows mismatch warning
    const planRows = node['Plan Rows'];
    const actualRows = node['Actual Rows'];
    if (actualRows !== undefined && planRows !== undefined) {
      const misEst = Math.abs(actualRows - planRows) / (planRows || 1);
      if (misEst > 10 && actualRows > 0) { // Off by 10x
        stats.innerHTML += `<span style="color:var(--vscode-errorForeground)">⚠️ Bad Est.</span>`;
      }
    }

    header.appendChild(stats);
    el.appendChild(header);

    // Cost Bar
    const bar = document.createElement('div');
    bar.className = 'cost-bar';
    bar.style.width = `${Math.min(100, costRatio * 100)}%`;
    // Color logic
    if (costRatio > 0.5) bar.style.backgroundColor = 'var(--vscode-errorForeground)';
    else if (costRatio > 0.2) bar.style.backgroundColor = 'var(--vscode-charts-yellow)';
    el.appendChild(bar);

    // Details Panel
    const details = document.createElement('div');
    details.className = 'explain-details';

    // Populate details
    const importantKeys = ['Relation Name', 'Alias', 'Index Name', 'Hash Cond', 'Filter', 'Join Filter', 'Output'];
    const ignoredKeys = ['Node Type', 'Plans', 'Total Cost', 'Startup Cost', 'Plan Rows', 'Plan Width', 'Actual Startup Time', 'Actual Total Time', 'Actual Rows', 'Actual Loops'];

    // Add standard stats first
    const mkDetail = (label: string, val: any) => {
      const d = document.createElement('div');
      d.className = 'explain-detail-item';
      d.innerHTML = `<span class="explain-label">${label}</span><span>${val}</span>`;
      return d;
    };

    details.appendChild(mkDetail('Cost', `${node['Startup Cost']} .. ${node['Total Cost']}`));
    details.appendChild(mkDetail('Rows', `${node['Plan Rows']} (Plan) / ${node['Actual Rows'] ?? '?'} (Actual)`));
    if (node['Actual Loops']) details.appendChild(mkDetail('Loops', node['Actual Loops']));

    // Dynamic keys
    for (const [key, val] of Object.entries(node)) {
      if (ignoredKeys.includes(key)) continue;
      if (importantKeys.includes(key) || typeof val === 'string' || typeof val === 'number') {
        details.appendChild(mkDetail(key, val));
      }
    }
    el.appendChild(details);

    // Children
    if (node.Plans && node.Plans.length > 0) {
      const children = document.createElement('div');
      children.className = 'explain-children';
      node.Plans.forEach(child => {
        children.appendChild(this.createNodeElement(child));
      });
      el.appendChild(children);
    }

    return el;
  }
}
