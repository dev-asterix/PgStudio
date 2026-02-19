import { createButton } from '../components/ui';

export const createImportButton = (
  columns: string[],
  tableInfo: any | undefined,
  context?: { postMessage?: (msg: any) => void }
) => {
  const importBtn = createButton('Import', true);
  importBtn.style.position = 'relative';

  if (!tableInfo) {
    importBtn.style.display = 'none'; // Completely hide if not a table
    return importBtn;
  }

  importBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showImportModal(columns, tableInfo, context);
  });

  return importBtn;
};

function showImportModal(tableColumns: string[], tableInfo: any, context?: { postMessage?: (msg: any) => void }) {
  // Create Modal Overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.5); z-index: 1000;
    display: flex; justify-content: center; align-items: center;
  `;

  // Create Modal Content
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    border-radius: 6px;
    width: 600px;
    max-height: 80vh;
    display: flex; flex-direction: column;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding: 12px 16px; border-bottom: 1px solid var(--vscode-widget-border); font-weight: 600; display: flex; justify-content: space-between; align-items: center;';
  header.innerHTML = `<span>Import Data into ${tableInfo.schema}.${tableInfo.table}</span>`;

  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'cursor: pointer; font-size: 20px;';
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding: 16px; overflow-y: auto; flex: 1;';
  modal.appendChild(body);

  // Step 1: File Selection
  const dropZone = document.createElement('div');
  dropZone.style.cssText = `
    border: 2px dashed var(--vscode-widget-border);
    padding: 32px; text-align: center;
    border-radius: 4px; cursor: pointer;
    transition: background 0.2s;
  `;
  dropZone.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 8px;">📂</div>
    <div>Click or Drag & Drop CSV/JSON file here</div>
    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">Max size recommended: 10MB</div>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,.json,.txt';
  fileInput.style.display = 'none';
  body.appendChild(fileInput);

  dropZone.onclick = () => fileInput.click();

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.background = 'var(--vscode-list-hoverBackground)'; };
  dropZone.ondragleave = () => { dropZone.style.background = 'transparent'; };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.background = 'transparent';
    if (e.dataTransfer?.files?.length) handleFile(e.dataTransfer.files[0]);
  };

  fileInput.onchange = (e: any) => {
    if (e.target.files?.length) handleFile(e.target.files[0]);
  };

  body.appendChild(dropZone);

  // Preview Container (Initially Hidden)
  const previewContainer = document.createElement('div');
  previewContainer.style.display = 'none';
  previewContainer.style.marginTop = '16px';
  body.appendChild(previewContainer);

  // Footer (Actions)
  const footer = document.createElement('div');
  footer.style.cssText = 'padding: 12px 16px; border-top: 1px solid var(--vscode-widget-border); display: flex; justify-content: flex-end; gap: 8px;';

  const cancelBtn = createButton('Cancel', false);
  cancelBtn.onclick = () => overlay.remove();

  const importBtn = createButton('Import', true) as HTMLButtonElement;
  importBtn.disabled = true;
  importBtn.style.opacity = '0.5';

  footer.appendChild(cancelBtn);
  footer.appendChild(importBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Logic
  let parsedData: any[] = [];
  let fileColumns: string[] = [];
  const columnMapping: Record<string, string> = {}; // FileCol -> TableCol

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      if (file.name.endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          if (Array.isArray(json)) {
            parsedData = json;
            if (parsedData.length > 0) fileColumns = Object.keys(parsedData[0]);
            showMappingUI();
          } else {
            alert('JSON file must contain an array of objects');
          }
        } catch (err) { alert('Invalid JSON file'); }
      } else {
        parsedData = parseCSV(content);
        if (parsedData.length > 0) {
          fileColumns = Object.keys(parsedData[0]);
          showMappingUI();
        }
      }
    };
    reader.readAsText(file);
  };

  const showMappingUI = () => {
    dropZone.style.display = 'none';
    previewContainer.style.display = 'block';

    // Auto-map based on name match (case-insensitive)
    fileColumns.forEach(fCol => {
      const match = tableColumns.find(tCol => tCol.toLowerCase() === fCol.toLowerCase());
      if (match) columnMapping[fCol] = match;
    });

    const rowsHtml = fileColumns.map(fCol => {
      const options = [`<option value="">(Skip)</option>`]
        .concat(tableColumns.map(tCol =>
          `<option value="${tCol}" ${columnMapping[fCol] === tCol ? 'selected' : ''}>${tCol}</option>`
        )).join('');

      return `
        <tr>
          <td style="padding: 6px; border-bottom: 1px solid var(--vscode-widget-border);">${fCol}</td>
          <td style="padding: 6px; border-bottom: 1px solid var(--vscode-widget-border); text-align: center;">➜</td>
          <td style="padding: 6px; border-bottom: 1px solid var(--vscode-widget-border);">
            <select class="mapping-select" data-file-col="${fCol}" style="width: 100%; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border);">
              ${options}
            </select>
          </td>
        </tr>
      `;
    }).join('');

    previewContainer.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">Map Columns</div>
      <div style="font-size: 11px; margin-bottom: 12px; opacity: 0.8;">
        Matched ${parsedData.length} rows. Map file columns to table columns.
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px;">
        <tr style="text-align: left; border-bottom: 1px solid var(--vscode-widget-border);">
          <th style="padding: 4px;">File Header</th>
          <th style="padding: 4px;"></th>
          <th style="padding: 4px;">Table Column</th>
        </tr>
        ${rowsHtml}
      </table>
    `;

    // Bind events
    previewContainer.querySelectorAll('select').forEach((select: any) => {
      select.onchange = (e: any) => {
        const fCol = select.getAttribute('data-file-col');
        const val = e.target.value;
        if (val) columnMapping[fCol] = val;
        else delete columnMapping[fCol];
      };
    });

    importBtn.disabled = false;
    importBtn.style.opacity = '1';
    importBtn.onclick = () => {
      const mappedData = parsedData.map(row => {
        const newRow: any = {};
        Object.keys(row).forEach(fCol => {
          if (columnMapping[fCol]) {
            newRow[columnMapping[fCol]] = row[fCol];
          }
        });
        return newRow;
      });

      // Filter out empty rows (if any) or rows with no mapped keys
      const validData = mappedData.filter(r => Object.keys(r).length > 0);

      if (validData.length === 0) {
        alert('No data to import (check column mappings)');
        return;
      }

      importBtn.innerText = 'Importing...';
      importBtn.disabled = true;

      context?.postMessage?.({
        type: 'import_request',
        table: tableInfo.table,
        schema: tableInfo.schema,
        data: validData
      });

      setTimeout(() => overlay.remove(), 500);
    };
  };

  function parseCSV(text: string): any[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const result = [];

    for (let i = 1; i < lines.length; i++) {
      // Simple regex-based splitter that respects quotes
      const line = lines[i];
      const values: string[] = [];
      let inQuote = false;
      let val = '';
      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (c === '"') {
          inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
          values.push(val.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
          val = '';
        } else {
          val += c;
        }
      }
      values.push(val.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));

      const row: any = {};
      headers.forEach((h, idx) => {
        if (idx < values.length) {
          row[h] = values[idx];
        }
      });
      result.push(row);
    }
    return result;
  }
}
