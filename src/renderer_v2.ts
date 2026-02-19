import type { ActivationFunction } from 'vscode-notebook-renderer';
import { Chart, registerables } from 'chart.js';
import { createButton, createTab, createBreadcrumb, BreadcrumbSegment } from './renderer/components/ui';
import { createExportButton } from './renderer/features/export';
import { createImportButton } from './renderer/features/import';
import { createAiButtons } from './renderer/features/ai';
import { TableRenderer, TableEvents } from './renderer/components/table/TableRenderer';
import { ChartRenderer } from './renderer/components/chart/ChartRenderer';
import { ChartControls } from './renderer/components/chart/ChartControls';
import { TableInfo, QueryResults, ChartRenderOptions } from './common/types';
import { getNumericColumns, isDateColumn } from './renderer/utils/formatting';
import { ExplainVisualizer } from './renderer/components/ExplainVisualizer';

// Register Chart.js components
Chart.register(...registerables);

// Track renderer instances and their containers per output element for cleanup
const chartInstances = new WeakMap<HTMLElement, ChartRenderer>();
const tableInstances = new WeakMap<HTMLElement, TableRenderer>();

export const activate: ActivationFunction = context => {
  return {
    renderOutputItem(data, element) {
      const json = data.json();

      if (!json) {
        element.innerText = 'No data';
        return;
      }

      const { columns = [], rows, rowCount, command, query, notices, executionTime, tableInfo, success, columnTypes, backendPid, breadcrumb } = json;

      // Data Management
      const originalRows: any[] = rows ? JSON.parse(JSON.stringify(rows)) : [];
      let currentRows: any[] = rows ? JSON.parse(JSON.stringify(rows)) : [];
      const selectedIndices = new Set<number>();
      const modifiedCells = new Map<string, { originalValue: any, newValue: any }>();
      const rowsMarkedForDeletion = new Set<number>();

      // Main Container
      const mainContainer = document.createElement('div');
      mainContainer.style.cssText = `
        font-family: var(--vscode-font-family), "Segoe UI", "Helvetica Neue", sans-serif;
        font-size: 13px;
        color: var(--vscode-editor-foreground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
      `;

      // Header
      const header = document.createElement('div');
      header.style.cssText = `
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-widget-border);
        cursor: pointer; display: flex; align-items: center; gap: 8px; user-select: none;
        background: ${success ? 'rgba(115, 191, 105, 0.25)' : 'var(--vscode-editor-background)'};
      `;
      if (success) {
        header.style.borderLeft = '4px solid var(--vscode-testing-iconPassed)';
      }

      const chevron = document.createElement('span');
      chevron.textContent = '▼';
      chevron.style.cssText = 'font-size: 10px; transition: transform 0.2s; display: inline-block;';

      const title = document.createElement('span');
      title.textContent = command || 'QUERY';
      title.style.cssText = 'font-weight: 600; text-transform: uppercase;';

      const summary = document.createElement('span');
      summary.style.marginLeft = 'auto';
      summary.style.opacity = '0.7';
      summary.style.fontSize = '0.9em';

      let summaryText = '';
      if (rowCount !== undefined && rowCount !== null) summaryText += `${rowCount} rows`;
      if (notices?.length) summaryText += summaryText ? `, ${notices.length} messages` : `${notices.length} messages`;
      if (executionTime !== undefined) summaryText += summaryText ? `, ${executionTime.toFixed(3)}s` : `${executionTime.toFixed(3)}s`;
      if (!summaryText) summaryText = 'No results';
      summary.textContent = summaryText;

      header.appendChild(summary);
      mainContainer.appendChild(header);

      // Performance Warning
      if (json.performanceAnalysis?.isDegraded) {
        const perfBanner = document.createElement('div');
        perfBanner.style.cssText = `
          padding: 6px 12px;
          background: rgba(255, 165, 0, 0.15);
          border-bottom: 1px solid rgba(255, 165, 0, 0.3);
          color: var(--vscode-editorWarning-foreground);
          font-size: 11px;
          display: flex; align-items: center; gap: 6px;
        `;
        perfBanner.innerHTML = `<span style="font-size:14px">⚠️</span> <span>${json.performanceAnalysis.analysis}</span>`;
        mainContainer.appendChild(perfBanner);
      }

      // Breadcrumb Navigation
      if (breadcrumb) {
        const segments: BreadcrumbSegment[] = [];

        if (breadcrumb.connectionName) {
          segments.push({ label: breadcrumb.connectionName, id: 'connection', type: 'connection' });
        }
        if (breadcrumb.database) {
          segments.push({ label: breadcrumb.database, id: 'database', type: 'database' });
        }
        if (breadcrumb.schema) {
          segments.push({ label: breadcrumb.schema, id: 'schema', type: 'schema' });
        }
        if (breadcrumb.object?.name) {
          segments.push({
            label: breadcrumb.object.name,
            id: 'object',
            type: 'object',
            isLast: true
          });
        }

        // Mark last segment
        if (segments.length > 0) {
          segments[segments.length - 1].isLast = true;
        }

        const breadcrumbEl = createBreadcrumb(segments, {
          onConnectionDropdown: (anchorEl: HTMLElement) => {
            context.postMessage?.({
              type: 'showConnectionSwitcher',
              connectionId: breadcrumb.connectionId
            });
          },
          onDatabaseDropdown: (anchorEl: HTMLElement) => {
            context.postMessage?.({
              type: 'showDatabaseSwitcher',
              connectionId: breadcrumb.connectionId,
              currentDatabase: breadcrumb.database
            });
          }
        });
        mainContainer.appendChild(breadcrumbEl);
      }

      // Content Container
      const contentContainer = document.createElement('div');
      contentContainer.style.cssText = 'display: flex; flex-direction: column; height: 100%;';
      mainContainer.appendChild(contentContainer);

      let isExpanded = true;
      header.onclick = () => {
        isExpanded = !isExpanded;
        contentContainer.style.display = isExpanded ? 'flex' : 'none';
        chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        header.style.borderBottom = isExpanded ? '1px solid var(--vscode-widget-border)' : 'none';
      };

      // Error Section
      if (json.error) {
        const errorContainer = document.createElement('div');
        errorContainer.style.cssText = 'padding: 12px; border-bottom: 1px solid var(--vscode-widget-border);';

        const errorMsg = document.createElement('div');
        errorMsg.style.cssText = 'color: var(--vscode-errorForeground); padding: 8px;';
        errorMsg.innerHTML = `<strong>Error executing query:</strong><br><pre style="white-space: pre-wrap; margin-top: 4px;">${json.error}</pre>`;
        errorContainer.appendChild(errorMsg);

        if (json.canExplain) {
          const btnContainer = document.createElement('div');
          btnContainer.style.cssText = 'margin-top: 12px; display: flex; gap: 8px;';

          const explainBtn = createButton('✨ Explain Error');
          explainBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            context.postMessage?.({ type: 'explainError', error: json.error, query: json.query });
          };

          const fixBtn = createButton('🛠️ Fix Query');
          fixBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            context.postMessage?.({ type: 'fixQuery', error: json.error, query: json.query });
          };

          btnContainer.appendChild(explainBtn);
          btnContainer.appendChild(fixBtn);
          errorMsg.appendChild(btnContainer);
        }
        contentContainer.appendChild(errorContainer);
      }

      // Messages Section
      if (notices?.length) {
        const msgContainer = document.createElement('div');
        msgContainer.style.cssText = `
            padding: 8px 12px; background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border); margin: 8px 12px 0 12px;
            font-family: var(--vscode-editor-font-family); white-space: pre-wrap; font-size: 12px;
          `;
        const msgTitle = document.createElement('div');
        msgTitle.textContent = 'Messages';
        msgTitle.style.cssText = 'font-weight: 600; margin-bottom: 4px; opacity: 0.8;';
        msgContainer.appendChild(msgTitle);

        notices.forEach((msg: string) => {
          const d = document.createElement('div');
          d.textContent = msg;
          d.style.marginBottom = '2px';
          msgContainer.appendChild(d);
        });
        contentContainer.appendChild(msgContainer);
      }

      // Actions Bar
      const actionsBar = document.createElement('div');
      actionsBar.style.cssText = `
        display: none; padding: 8px 12px; gap: 8px; align-items: center; justify-content: space-between;
        border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background);
      `;

      // Helper to export/copy based on CURRENT selection or ALL if none selected
      const getSelectedRows = () => {
        if (selectedIndices.size === 0) return currentRows;
        return currentRows.filter((_, i) => selectedIndices.has(i));
      };

      const selectAllBtn = createButton('Select All', true);
      const copyBtn = createButton('Copy Selected', true);
      const deleteBtn = createButton('🗑️ Delete Selected', true);
      deleteBtn.style.cssText = 'display: none; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 8px;';

      const exportBtn = createExportButton(columns, currentRows, tableInfo, context, query);
      const importBtn = createImportButton(columns, tableInfo, context);

      // Left Group
      const leftActions = document.createElement('div');
      leftActions.style.cssText = 'display: flex; gap: 8px; align-items: center;';
      leftActions.appendChild(selectAllBtn);
      leftActions.appendChild(copyBtn);
      leftActions.appendChild(deleteBtn);
      leftActions.appendChild(importBtn);
      leftActions.appendChild(exportBtn);

      // Right Group
      const rightActions = document.createElement('div');
      rightActions.style.cssText = 'display: flex; gap: 8px; align-items: center;';

      // Copy to Chat
      const copyToChatBtn = createButton('💬 Send to Chat', true);
      copyToChatBtn.title = 'Send results to SQL Assistant chat';
      copyToChatBtn.onclick = () => {
        const rowsToSend = currentRows.slice(0, 100);
        const resultsJson = JSON.stringify({
          totalRows: currentRows.length,
          columns: columns,
          rows: rowsToSend
        }, null, 2);
        context.postMessage?.({
          type: 'sendToChat',
          data: {
            query: query || '-- Query',
            results: resultsJson,
            message: ''
          }
        });
      };
      rightActions.appendChild(copyToChatBtn);

      // AI Buttons
      const { analyzeBtn, optimizeBtn } = createAiButtons(
        { postMessage: (msg: any) => context.postMessage?.(msg) },
        columns,
        currentRows,
        query || command || 'result set',
        command,
        executionTime
      );
      rightActions.appendChild(analyzeBtn);
      rightActions.appendChild(optimizeBtn);

      // Detect if this is an EXPLAIN query (either JSON or text format)
      const isExplainQuery = json.explainPlan ||
        (query && /^\s*EXPLAIN/i.test(query)) ||
        command === 'EXPLAIN' ||
        (columns.length === 1 && columns[0] === 'QUERY PLAN');

      if (isExplainQuery) {
        const explainPlanBtn = createButton('🧭 View Plan', true);
        explainPlanBtn.title = json.explainPlan
          ? 'Open EXPLAIN ANALYZE plan view'
          : 'Convert to JSON format and open visual plan view';

        explainPlanBtn.onclick = () => {
          if (json.explainPlan) {
            // Already have JSON plan, show it directly
            // Now we prefer the in-renderer tab if available
            if (explainTab) {
              switchTab('explain');
            } else {
              // Fallback / legacy external view
              context.postMessage?.({
                type: 'showExplainPlan',
                plan: json.explainPlan,
                query: query || ''
              });
            }
          } else {
            // Text format - request re-execution with FORMAT JSON
            // Log for debugging
            console.log('Converting EXPLAIN to JSON, query:', query);
            if (!query) {
              alert('Cannot convert EXPLAIN plan: query not available');
              return;
            }
            context.postMessage?.({
              type: 'convertExplainToJson',
              query: query
            });
          }
        };
        rightActions.appendChild(explainPlanBtn);
      }

      actionsBar.appendChild(leftActions);
      actionsBar.appendChild(rightActions);
      if (!json.error) {
        contentContainer.appendChild(actionsBar);
      }

      // Save Changes Logic
      const saveBtn = createButton('Save Changes', true);
      saveBtn.style.marginRight = '8px';

      const updateSaveButtonVisibility = () => {
        // Show save button if there are edits OR deletions
        const hasChanges = modifiedCells.size > 0 || rowsMarkedForDeletion.size > 0;

        if (hasChanges) {
          if (!rightActions.contains(saveBtn)) rightActions.prepend(saveBtn);

          // Build button text with counts
          const parts = [];
          if (modifiedCells.size > 0) parts.push(`${modifiedCells.size} edit${modifiedCells.size !== 1 ? 's' : ''}`);
          if (rowsMarkedForDeletion.size > 0) parts.push(`${rowsMarkedForDeletion.size} deletion${rowsMarkedForDeletion.size !== 1 ? 's' : ''}`);
          saveBtn.innerText = `💾 Save Changes (${parts.join(', ')})`;
        } else {
          if (rightActions.contains(saveBtn)) rightActions.removeChild(saveBtn);
        }
      };

      saveBtn.onclick = () => {
        console.log('Renderer: Save button clicked');
        console.log('Renderer: Modified cells size:', modifiedCells.size);
        console.log('Renderer: Rows marked for deletion:', rowsMarkedForDeletion.size);

        const updates: any[] = [];
        modifiedCells.forEach((diff, key) => {
          const [rowIndexStr, colName] = key.split('-');
          const rowIndex = parseInt(rowIndexStr);

          console.log(`Renderer: Processing diff for row ${rowIndex}, col ${colName}`);

          if (tableInfo?.primaryKeys) {
            const pkValues: Record<string, any> = {};
            tableInfo.primaryKeys.forEach((pk: string) => {
              pkValues[pk] = originalRows[rowIndex][pk];
            });
            updates.push({
              keys: pkValues,
              column: colName,
              value: diff.newValue,
              originalValue: diff.originalValue
            });
          } else {
            console.warn('Renderer: No primary keys found in tableInfo', tableInfo);
          }
        });

        // Build deletions array
        const deletions: any[] = [];
        rowsMarkedForDeletion.forEach((rowIndex) => {
          if (tableInfo?.primaryKeys) {
            const pkValues: Record<string, any> = {};
            tableInfo.primaryKeys.forEach((pk: string) => {
              pkValues[pk] = originalRows[rowIndex][pk];
            });
            deletions.push({
              keys: pkValues,
              row: originalRows[rowIndex]  // Include full row for reference
            });
          }
        });

        console.log('Renderer: Updates prepared:', updates);
        console.log('Renderer: Deletions prepared:', deletions);

        if (updates.length > 0 || deletions.length > 0) {
          console.log('Renderer: Posting saveChanges message');
          context.postMessage?.({
            type: 'saveChanges',
            updates,
            deletions,
            tableInfo
          });
        } else {
          const reason = !tableInfo?.primaryKeys ? 'No primary keys found for this table.' : 'Unknown error preparing updates.';
          console.warn(`Renderer: Save failed. ${reason}`);

          // Inform user nicely
          context.postMessage?.({
            type: 'showErrorMessage',
            message: `Cannot save changes: ${reason} (Primary keys are required to identify rows)`
          });
        }
      };

      // Listen for messages from extension (e.g., saveSuccess)
      context.onDidReceiveMessage?.((message: any) => {
        if (message.type === 'saveSuccess') {
          console.log('Renderer: Received saveSuccess, clearing modified cells and removing deleted rows');

          // Remove deleted rows from arrays (in reverse order to maintain indices)
          const deletedIndices = Array.from(rowsMarkedForDeletion).sort((a, b) => b - a);
          deletedIndices.forEach(index => {
            currentRows.splice(index, 1);
            originalRows.splice(index, 1);
          });

          // Update originalRows with edited values
          modifiedCells.forEach((diff, key) => {
            const [rowIndexStr, colName] = key.split('-');
            const rowIndex = parseInt(rowIndexStr);
            if (rowIndex < originalRows.length) {  // Check bounds after deletions
              originalRows[rowIndex][colName] = diff.newValue;
            }
          });

          // Clear all pending changes
          modifiedCells.clear();
          rowsMarkedForDeletion.clear();

          // Update save button visibility
          updateSaveButtonVisibility();

          // Re-render table to remove highlights and deleted rows
          if (tableRenderer) {
            tableRenderer.render({
              columns,
              rows: currentRows,
              originalRows,
              columnTypes,
              tableInfo,
              initialSelectedIndices: selectedIndices,
              modifiedCells
            });
          }
        }
      });

      // Tabs
      const tabs = document.createElement('div');
      tabs.style.cssText = 'display: flex; padding: 0 12px; margin-top: 8px; border-bottom: 1px solid var(--vscode-panel-border);';

      const tableTab = createTab('Table', 'table', true, () => switchTab('table'));
      const chartTab = createTab('Chart', 'chart', false, () => switchTab('chart'));

      let explainTab: HTMLElement | null = null;
      if (json.explainPlan) {
        explainTab = createTab('Explain Plan', 'explain', false, () => switchTab('explain'));
      }

      tabs.appendChild(tableTab);
      tabs.appendChild(chartTab);
      if (explainTab) tabs.appendChild(explainTab);
      if (!json.error) {
        contentContainer.appendChild(tabs);
      }


      // Views Containers
      const viewContainer = document.createElement('div');
      viewContainer.style.cssText = 'flex: 1; overflow: hidden; display: flex; flex-direction: column; position: relative; max-height: 500px;';
      if (!json.error) {
        contentContainer.appendChild(viewContainer);
      }

      // TABLE RENDERER
      const tableRenderer = new TableRenderer(viewContainer, {
        onSelectionChange: (indices) => {
          console.log('[renderer_v2] onSelectionChange called, indices:', Array.from(indices));
          // Sync local state with TableRenderer's state
          selectedIndices.clear();
          indices.forEach(i => selectedIndices.add(i));
          console.log('[renderer_v2] local selectedIndices after sync:', selectedIndices.size);

          updateActionsVisibility();
        },
        onDataChange: (rowIndex, col, newVal, originalVal) => {
          updateSaveButtonVisibility();
          updateActionsVisibility();
        }
      });

      // Store for cleanup on disposal
      tableInstances.set(element, tableRenderer);

      // CHART RENDERER
      const chartCanvas = document.createElement('canvas');
      const chartRenderer = new ChartRenderer(chartCanvas);

      // Store for cleanup on disposal
      chartInstances.set(element, chartRenderer);

      const exportChartBtn = createButton('📷 Export Chart', true);
      exportChartBtn.style.display = 'none'; // Hidden by default
      exportChartBtn.onclick = () => {
        const dataUrl = chartRenderer.exportImage('png');
        if (dataUrl) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `chart-${new Date().toISOString()}.png`;
          a.click();
        }
      };
      leftActions.appendChild(exportChartBtn);

      const updateActionsVisibility = () => {
        // Always show actions bar
        actionsBar.style.display = 'flex';

        if (currentMode === 'table') {
          // Table Mode: Show Table Buttons, Hide Chart Buttons
          selectAllBtn.style.display = 'inline-block';
          copyBtn.style.display = 'inline-block';
          exportBtn.style.display = 'inline-block';
          importBtn.style.display = tableInfo ? 'inline-block' : 'none';
          exportChartBtn.style.display = 'none';
        } else {
          // Chart Mode: Hide Table Buttons, Show Chart Button
          selectAllBtn.style.display = 'none';
          copyBtn.style.display = 'none';
          exportBtn.style.display = 'none'; // Hide Data Export in Chart Mode
          importBtn.style.display = 'none';
          exportChartBtn.style.display = 'inline-block';
        }

        // Update Select All Button Text
        if (currentMode === 'table') {
          selectAllBtn.innerText = selectedIndices.size === currentRows.length ? 'Deselect All' : 'Select All';

          if (selectedIndices.size > 0) { // Removed PK check for debugging
            deleteBtn.style.display = 'inline-block';
            deleteBtn.innerText = `🗑️ Delete (${selectedIndices.size})`;
            if (!tableInfo?.primaryKeys) {
              deleteBtn.title = 'Warning: No Primary Keys detected. Deletion may fail.';
              deleteBtn.style.opacity = '0.7';
            } else {
              deleteBtn.title = 'Delete selected rows';
              deleteBtn.style.opacity = '1';
            }
          } else {
            // console.log('Renderer: Delete button hidden. Selected:', selectedIndices.size);
            deleteBtn.style.display = 'none';
          }
        }
      };

      deleteBtn.onclick = () => {
        console.log('[renderer_v2] Delete button clicked!');
        const selectedCount = selectedIndices.size;
        console.log('[renderer_v2] selectedCount:', selectedCount);
        if (selectedCount === 0) return;

        // Mark selected rows for deletion
        selectedIndices.forEach(index => {
          rowsMarkedForDeletion.add(index);
        });

        console.log('[renderer_v2] Rows marked for deletion:', Array.from(rowsMarkedForDeletion));

        // Clear selection
        selectedIndices.clear();

        // Update save button visibility
        updateSaveButtonVisibility();

        // Re-render table to show strikethrough on marked rows
        if (tableRenderer) {
          tableRenderer.render({
            columns,
            rows: currentRows,
            originalRows,
            columnTypes,
            tableInfo,
            initialSelectedIndices: selectedIndices,
            modifiedCells,
            rowsMarkedForDeletion  // Pass to renderer for styling
          });
        }

        // Update actions visibility
        updateActionsVisibility();
      };

      selectAllBtn.onclick = () => {
        const allSelected = selectedIndices.size === currentRows.length;
        if (allSelected) selectedIndices.clear();
        else currentRows.forEach((_, i) => selectedIndices.add(i));

        tableRenderer.updateSelection(selectedIndices);
        updateActionsVisibility();
      };

      copyBtn.onclick = () => {
        if (selectedIndices.size === 0) return;
        const selected = currentRows.filter((_, i) => selectedIndices.has(i));

        // Convert to CSV
        const csv = columns.map((c: string) => `"${c}"`).join(',') + '\n' +
          selected.map(row =>
            columns.map((col: string) => {
              const val = row[col];
              const str = (typeof val === 'object' && val !== null) ? JSON.stringify(val) : String(val ?? '');
              if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
              return str;
            }).join(',')
          ).join('\n');

        navigator.clipboard.writeText(csv).then(() => {
          const prev = copyBtn.innerText;
          copyBtn.innerText = 'Copied!';
          setTimeout(() => copyBtn.innerText = prev, 2000);
        });
      };

      // Switch Tab Logic
      let currentMode = 'table';
      const switchTab = (mode: string) => {
        currentMode = mode;
        viewContainer.innerHTML = '';

        if (mode === 'table') {
          tableTab.style.borderBottom = '2px solid var(--vscode-focusBorder)';
          tableTab.style.opacity = '1';
          // Reset chart tab style
          chartTab.style.borderBottom = '2px solid transparent';
          chartTab.style.opacity = '0.6';
          // Show actions bar if needed
          updateActionsVisibility();

          tableRenderer.render({
            columns,
            rows: currentRows,
            originalRows,
            columnTypes,
            tableInfo,
            initialSelectedIndices: selectedIndices,
            modifiedCells
          });
        } else if (mode === 'explain') {
          // Explain Mode
          if (tableTab) { tableTab.style.borderBottom = '2px solid transparent'; tableTab.style.opacity = '0.6'; }
          if (chartTab) { chartTab.style.borderBottom = '2px solid transparent'; chartTab.style.opacity = '0.6'; }
          if (explainTab) { explainTab.style.borderBottom = '2px solid var(--vscode-focusBorder)'; explainTab.style.opacity = '1'; }

          updateActionsVisibility(); // Should probably hide most actions

          const explainWrapper = document.createElement('div');
          explainWrapper.style.cssText = 'flex: 1; overflow: hidden; height: 100%; display: flex; flex-direction: column;';
          viewContainer.appendChild(explainWrapper);

          new ExplainVisualizer(explainWrapper, json.explainPlan).render();

        } else {
          // Hide table specific styles
          tableTab.style.borderBottom = '2px solid transparent';
          tableTab.style.opacity = '0.6';
          if (explainTab) { explainTab.style.borderBottom = '2px solid transparent'; explainTab.style.opacity = '0.6'; }

          chartTab.style.borderBottom = '2px solid var(--vscode-focusBorder)';
          chartTab.style.opacity = '1';
          updateActionsVisibility();

          const chartWrapper = document.createElement('div');
          chartWrapper.style.cssText = 'flex: 1; display: flex; flex-direction: column; height: 100%; overflow: hidden;';

          const controlsContainer = document.createElement('div');
          controlsContainer.style.cssText = 'width: 250px; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column;';

          const canvasContainer = document.createElement('div');
          canvasContainer.style.cssText = 'flex: 1; padding: 8px; position: relative; min-height: 0;';
          canvasContainer.appendChild(chartCanvas);

          const innerContainer = document.createElement('div');
          innerContainer.style.cssText = 'display: flex; flex: 1; overflow: hidden; height: 100%;';
          innerContainer.appendChild(canvasContainer);
          innerContainer.appendChild(controlsContainer);
          chartWrapper.appendChild(innerContainer);

          viewContainer.appendChild(chartWrapper);

          new ChartControls(controlsContainer, {
            columns,
            rows: currentRows,
            onConfigChange: (config) => {
              chartRenderer.render(currentRows, config);
            }
          });
        }
      };

      // Initial Render
      if (columns.length > 0) {
        switchTab('table');
      } else {
        if (rowCount === 0) mainContainer.innerHTML += '<div style="padding:12px">Query returned no data</div>';
      }

      element.appendChild(mainContainer);
    }
  };
};
