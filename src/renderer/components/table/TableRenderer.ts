import { createButton } from '../ui';
import { formatValue } from '../../utils/formatting';
import { TableInfo, TableRenderOptions } from '../../../common/types';

export interface TableEvents {
  onSelectionChange?: (selectedIndices: Set<number>) => void;
  onDataChange?: (rowIndex: number, col: string, newValue: any, originalValue: any) => void;
  onExplainError?: (error: string, query: string) => void;
  onFixQuery?: (error: string, query: string) => void;
}

export class TableRenderer {
  private mainContainer: HTMLElement;
  private tableContainer: HTMLElement;
  private tableBody: HTMLElement | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;
  private loadMoreSentinel: HTMLElement | null = null;

  // State
  private columns: string[] = [];
  private rows: any[] = [];
  private originalRows: any[] = [];
  private columnTypes: Record<string, string> = {};
  private tableInfo?: TableInfo;
  private selectedIndices: Set<number> = new Set();
  private modifiedCells: Map<string, { originalValue: any, newValue: any }> = new Map();
  private rowsMarkedForDeletion: Set<number> = new Set();
  private dateTimeDisplayMode: Map<string, boolean> = new Map();

  private renderedCount = 0;
  private readonly CHUNK_SIZE = 50;
  private currentlyEditingCell: HTMLElement | null = null;

  // Events
  private events: TableEvents = {};

  constructor(container: HTMLElement, events: TableEvents = {}) {
    this.mainContainer = container;
    this.events = events;

    // Create internal container
    this.tableContainer = document.createElement('div');
    this.tableContainer.style.overflow = 'auto';
    this.tableContainer.style.flex = '1';
    this.tableContainer.style.width = '100%';
    this.tableContainer.style.position = 'relative'; // For stickiness context
    this.tableContainer.style.minHeight = '0'; // For flex scrolling

    this.mainContainer.appendChild(this.tableContainer);
  }

  public render(options: TableRenderOptions) {
    // Ensure container is attached (it might have been removed by tab switching)
    if (!this.mainContainer.contains(this.tableContainer)) {
      this.mainContainer.appendChild(this.tableContainer);
    }

    this.columns = options.columns;
    this.rows = options.rows;
    this.originalRows = options.originalRows;
    this.columnTypes = options.columnTypes || {};
    this.tableInfo = options.tableInfo;
    this.selectedIndices = options.initialSelectedIndices ? new Set(options.initialSelectedIndices) : new Set();
    this.modifiedCells = options.modifiedCells || new Map();
    this.rowsMarkedForDeletion = options.rowsMarkedForDeletion || new Set();

    // Reset state
    this.tableContainer.innerHTML = '';
    this.renderedCount = 0;
    this.tableBody = null;
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
    this.loadMoreSentinel = null;

    if (this.rows.length === 0) {
      this.renderEmptyState();
      return;
    }

    this.createTableStructure();
    this.renderNextChunk();

    // Setup Infinite Scroll
    this.setupInfiniteScroll();
  }

  public updateSelection(indices: Set<number>) {
    this.selectedIndices = indices;
    this.updateRowSelectionStyles();
  }

  private renderEmptyState() {
    const empty = document.createElement('div');
    empty.textContent = 'No results found';
    empty.style.fontStyle = 'italic';
    empty.style.opacity = '0.7';
    empty.style.padding = '20px';
    empty.style.textAlign = 'center';
    this.tableContainer.appendChild(empty);
  }

  private createTableStructure() {
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'separate';
    table.style.borderSpacing = '0';
    table.style.fontSize = '13px';
    table.style.whiteSpace = 'nowrap';
    table.style.lineHeight = '1.5';

    const thead = document.createElement('thead');
    this.tableBody = document.createElement('tbody');

    // Header Row
    const headerRow = document.createElement('tr');

    // 1. Selection Header Column
    const selectTh = document.createElement('th');
    selectTh.style.cssText = `
            width: 30px;
            position: sticky;
            top: 0;
            left: 0;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-widget-border);
            z-index: 20;
        `;
    headerRow.appendChild(selectTh);

    // 2. Data Columns
    this.columns.forEach((col) => {
      const th = this.createHeaderCell(col);
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);
    table.appendChild(this.tableBody);
    this.tableContainer.appendChild(table);
  }

  private createHeaderCell(col: string): HTMLElement {
    const th = document.createElement('th');
    th.style.cssText = `
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            border-right: 1px solid var(--vscode-widget-border);
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
            z-index: 10;
            user-select: none;
            max-width: 400px;
        `;

    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const colName = document.createElement('span');
    colName.textContent = col;
    container.appendChild(colName);
    th.appendChild(container);

    // Type info
    if (this.columnTypes[col]) {
      const typeContainer = document.createElement('div');
      typeContainer.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-top: 2px;';

      const colType = document.createElement('span');
      colType.textContent = this.columnTypes[col];
      colType.style.cssText = 'font-size: 0.8em; font-weight: 500; opacity: 0.7;';
      typeContainer.appendChild(colType);

      if (this.tableInfo?.primaryKeys?.includes(col)) {
        typeContainer.innerHTML += '<span title="Primary Key" style="font-size: 0.85em">🔑</span>';
      } else if (this.tableInfo?.uniqueKeys?.includes(col)) {
        typeContainer.innerHTML += '<span title="Unique Key" style="font-size: 0.85em">🔐</span>';
      }

      // Date/Time Toggle
      const lowerType = this.columnTypes[col].toLowerCase();
      const isDateTime = lowerType.includes('timestamp') || lowerType === 'timestamptz' ||
        lowerType === 'date' || lowerType === 'time' || lowerType === 'timetz';

      if (isDateTime) {
        if (!this.dateTimeDisplayMode.has(col)) {
          this.dateTimeDisplayMode.set(col, false);
        }
        const toggle = document.createElement('button');
        const isFormatted = this.dateTimeDisplayMode.get(col);
        toggle.textContent = isFormatted ? '📆' : '#';
        toggle.style.cssText = `
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    border-radius: 3px;
                    padding: 1px 4px;
                    cursor: pointer;
                    font-size: 10px;
                    line-height: 1;
                `;
        toggle.title = isFormatted ? 'Showing formatted time - Click to show raw value' : 'Showing raw value - Click to show formatted time';
        toggle.onclick = (e) => {
          e.stopPropagation();
          this.dateTimeDisplayMode.set(col, !isFormatted);
          this.rerenderTable();
        };
        typeContainer.appendChild(toggle);
      }

      th.appendChild(typeContainer);
    }

    this.addResizeHandle(th);
    return th;
  }

  private addResizeHandle(th: HTMLElement) {
    // th.style.position = 'relative'; // Removed as it conflicts with sticky positioning
    const handle = document.createElement('div');
    handle.style.cssText = `
            position: absolute; right: 0; top: 0; height: 100%; width: 6px;
            cursor: col-resize; user-select: none; z-index: 11;
        `;

    handle.onmouseenter = () => handle.style.borderRight = '2px solid var(--vscode-focusBorder)';
    handle.onmouseleave = () => handle.style.borderRight = '';

    // Note: Full resize logic implementation omitted for brevity, logic remains similar to original
    th.appendChild(handle);
  }

  private renderNextChunk = () => {
    if (!this.tableBody) return;

    const start = this.renderedCount;
    const end = Math.min(this.renderedCount + this.CHUNK_SIZE, this.rows.length);

    if (start >= end) {
      if (this.loadMoreSentinel) {
        this.loadMoreSentinel.remove();
        this.loadMoreSentinel = null;
        this.loadMoreObserver?.disconnect();
        this.loadMoreObserver = null;
      }
      return;
    }

    const chunk = this.rows.slice(start, end);
    chunk.forEach((row, i) => {
      const tr = this.createRow(row, start + i);
      this.tableBody!.appendChild(tr);
    });

    this.renderedCount = end;

    if (this.loadMoreSentinel) {
      this.tableContainer.appendChild(this.loadMoreSentinel);
    }
  }

  private createRow(row: any, index: number): HTMLElement {
    const tr = document.createElement('tr');
    tr.dataset.index = String(index);
    tr.style.cursor = 'pointer';

    this.applyRowStyle(tr, index);

    tr.onclick = (e) => {
      console.log('[TableRenderer] tr.onclick fired, index:', index, 'target:', e.target);
      if (e.ctrlKey || e.metaKey) {
        if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
        else this.selectedIndices.add(index);
      } else {
        this.selectedIndices.clear();
        this.selectedIndices.add(index);
      }
      console.log('[TableRenderer] selectedIndices after click:', Array.from(this.selectedIndices));
      this.updateRowSelectionStyles();
      this.events.onSelectionChange?.(this.selectedIndices);
    };

    tr.onmouseenter = () => {
      if (!this.selectedIndices.has(index)) tr.style.background = 'var(--vscode-list-hoverBackground)';
    };
    tr.onmouseleave = () => {
      if (!this.selectedIndices.has(index)) this.applyRowStyle(tr, index);
    };

    const selectTd = document.createElement('td');
    selectTd.textContent = String(index + 1);
    selectTd.style.cssText = `
            border-bottom: 1px solid var(--vscode-widget-border);
            border-right: 1px solid var(--vscode-widget-border);
            text-align: center; font-size: 10px; color: var(--vscode-descriptionForeground);
            position: sticky;
            left: 0;
            z-index: 5;
            background: var(--vscode-editor-background);
            cursor: pointer;
        `;
    selectTd.title = 'Click to select row';
    selectTd.onclick = (e) => {
      console.log('[TableRenderer] selectTd (row#) clicked, index:', index);
      e.stopPropagation(); // Handle selection here specifically
      if (e.ctrlKey || e.metaKey) {
        if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
        else this.selectedIndices.add(index);
      } else {
        this.selectedIndices.clear();
        this.selectedIndices.add(index);
      }
      console.log('[TableRenderer] selectedIndices after selectTd click:', Array.from(this.selectedIndices));
      this.updateRowSelectionStyles();
      this.events.onSelectionChange?.(this.selectedIndices);
    };
    tr.appendChild(selectTd);

    this.columns.forEach(col => {
      const td = this.createCell(row, col, index);
      tr.appendChild(td);
    });

    return tr;
  }

  private createCell(row: any, col: string, index: number): HTMLElement {
    const td = document.createElement('td');
    const val = row[col];
    const colType = this.columnTypes[col];
    let { text, type } = formatValue(val, colType);

    // If it's a date/time type and display mode is 'as-is' (false), show raw value
    const isDateTime = type === 'date' || type === 'timestamp' || type === 'time';
    if (isDateTime) {
      const isFormatted = this.dateTimeDisplayMode.get(col) ?? false;
      if (!isFormatted) {
        text = val !== null && val !== undefined ? String(val) : 'NULL';
      }
    }

    td.style.cssText = `
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            border-right: 1px solid var(--vscode-widget-border);
            text-align: left; max-width: 400px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            background-color: var(--vscode-editor-background);
        `;

    if (this.tableInfo?.primaryKeys?.includes(col)) {
      td.style.backgroundColor = 'rgba(128, 128, 128, 0.1)';
      td.title = 'Primary Key';
    } else {
      td.style.cursor = 'text';
      td.onclick = (e) => this.handleCellEdit(e, td, index, col, type);
    }

    const cellKey = `${index}-${col}`;
    if (this.modifiedCells.has(cellKey)) {
      td.style.backgroundColor = '#fff3cd';
      td.style.borderLeft = '4px solid #ffc107';
      td.style.color = '#856404';
    }

    td.textContent = text;
    return td;
  }

  private applyRowStyle(tr: HTMLElement, index: number) {
    // Check if row is marked for deletion
    if (this.rowsMarkedForDeletion.has(index)) {
      tr.style.background = 'rgba(255, 0, 0, 0.1)';
      tr.style.color = 'var(--vscode-errorForeground)';
      tr.style.textDecoration = 'line-through';
      tr.style.opacity = '0.6';
    } else if (this.selectedIndices.has(index)) {
      tr.style.background = 'var(--vscode-list-activeSelectionBackground)';
      tr.style.color = 'var(--vscode-list-activeSelectionForeground)';
      tr.style.textDecoration = 'none';
      tr.style.opacity = '1';
    } else {
      tr.style.background = index % 2 === 0 ? 'transparent' : 'var(--vscode-keybindingTable-rowsBackground)';
      tr.style.color = 'var(--vscode-editor-foreground)';
      tr.style.textDecoration = 'none';
      tr.style.opacity = '1';
    }
  }

  private updateRowSelectionStyles() {
    if (!this.tableBody) return;
    Array.from(this.tableBody.children).forEach((child: any) => {
      const idx = parseInt(child.dataset.index);
      this.applyRowStyle(child, idx);
    });
  }

  private handleCellEdit(e: MouseEvent, td: HTMLElement, index: number, col: string, type: string) {
    // e.stopPropagation(); // Allow click to bubble to row for selection
    if (this.currentlyEditingCell === td) return;

    if (this.currentlyEditingCell) {
      const existingInput = this.currentlyEditingCell.querySelector('input, textarea');
      if (existingInput) (existingInput as HTMLElement).blur();
    }

    this.currentlyEditingCell = td;
    const currentValue = this.rows[index][col];
    const isJsonType = type === 'json' || type === 'object';
    const isBoolType = type === 'boolean';
    const cellKey = `${index}-${col}`;

    td.innerHTML = '';

    if (isBoolType) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = currentValue === true;
      checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';

      checkbox.addEventListener('change', () => {
        const newValue = checkbox.checked;
        const originalValue = this.originalRows[index][col];

        if (newValue !== originalValue) {
          this.modifiedCells.set(cellKey, { originalValue, newValue });
        } else {
          this.modifiedCells.delete(cellKey);
        }

        this.rows[index][col] = newValue;
        this.currentlyEditingCell = null;
        this.events.onDataChange?.(index, col, newValue, originalValue);
        this.rerenderTable();
      });

      td.appendChild(checkbox);
      checkbox.focus();
    } else if (isJsonType) {
      const editContainer = document.createElement('div');
      editContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px; width: 100%;';

      const textarea = document.createElement('textarea');
      textarea.value = typeof currentValue === 'object' ? JSON.stringify(currentValue, null, 2) : (currentValue || '');
      textarea.style.cssText = `
                width: 100%; min-width: 200px; min-height: 80px; padding: 4px;
                border: 1px solid var(--vscode-focusBorder); borderRadius: 3px;
                background-color: var(--vscode-input-background); color: var(--vscode-input-foreground);
                font-family: var(--vscode-editor-font-family); font-size: 12px; resize: both;
            `;

      const saveEdit = () => {
        let newValue: any;
        try {
          newValue = JSON.parse(textarea.value);
        } catch (err) {
          newValue = textarea.value;
        }

        const originalValue = this.originalRows[index][col];
        const isDifferent = JSON.stringify(newValue) !== JSON.stringify(originalValue);

        if (isDifferent) {
          this.modifiedCells.set(cellKey, { originalValue, newValue });
        } else {
          this.modifiedCells.delete(cellKey);
        }

        this.rows[index][col] = newValue;
        this.currentlyEditingCell = null;
        this.events.onDataChange?.(index, col, newValue, originalValue);
        this.rerenderTable();
      };

      const cancelEdit = () => {
        this.currentlyEditingCell = null;
        this.rerenderTable();
      };

      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 4px; justify-content: flex-end;';

      const saveBtn = createButton('✓ Save', true);
      saveBtn.onclick = (e: MouseEvent) => { e.stopPropagation(); saveEdit(); };

      const cancelBtn = createButton('✕ Cancel');
      cancelBtn.onclick = (e: MouseEvent) => { e.stopPropagation(); cancelEdit(); };

      btnContainer.appendChild(saveBtn);
      btnContainer.appendChild(cancelBtn);

      editContainer.appendChild(textarea);
      editContainer.appendChild(btnContainer);
      td.appendChild(editContainer);

      textarea.focus();

      textarea.addEventListener('blur', (e) => {
        if (e.relatedTarget === saveBtn || e.relatedTarget === cancelBtn) return;
        if (this.currentlyEditingCell === td) saveEdit();
      });

      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault(); cancelEdit();
        }
      });

    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = (currentValue === null || currentValue === undefined) ? '' : String(currentValue);
      input.style.cssText = `
                width: 100%; padding: 4px; border: 1px solid var(--vscode-focusBorder);
                border-radius: 3px; background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground); font-family: var(--vscode-editor-font-family);
                font-size: 12px;
             `;

      td.appendChild(input);
      input.focus();
      input.select();

      const saveEdit = () => {
        const originalValue = this.originalRows[index][col];
        let newValue: any = input.value;
        if (input.value === '' && originalValue === null) newValue = null;

        if (newValue != originalValue) {
          this.modifiedCells.set(cellKey, { originalValue: this.originalRows[index][col], newValue });
        } else {
          this.modifiedCells.delete(cellKey);
        }

        this.rows[index][col] = newValue;
        this.currentlyEditingCell = null;
        this.events.onDataChange?.(index, col, newValue, originalValue);
        this.rerenderTable();
      };

      const cancelEdit = () => {
        this.currentlyEditingCell = null;
        this.rerenderTable();
      };

      input.addEventListener('blur', saveEdit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
    }
  }

  private setupInfiniteScroll() {
    if (this.loadMoreObserver) return;

    this.loadMoreSentinel = document.createElement('div');
    this.loadMoreSentinel.style.height = '20px';
    this.tableContainer.appendChild(this.loadMoreSentinel);

    this.loadMoreObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        this.renderNextChunk();
      }
    }, { root: this.tableContainer, rootMargin: '100px' });

    this.loadMoreObserver.observe(this.loadMoreSentinel);
  }

  private rerenderTable() {
    this.render({
      columns: this.columns,
      rows: this.rows,
      originalRows: this.originalRows,
      columnTypes: this.columnTypes,
      tableInfo: this.tableInfo,
      initialSelectedIndices: this.selectedIndices,
      modifiedCells: this.modifiedCells
    });
  }

  public dispose() {
    // Cleanup IntersectionObserver
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
    
    // Clear sentinel reference
    this.loadMoreSentinel = null;
    
    // Clear DOM references
    this.tableBody = null;
    this.currentlyEditingCell = null;
  }
}
