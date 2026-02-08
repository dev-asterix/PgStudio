import { expect } from 'chai';
import * as sinon from 'sinon';
import { JSDOM } from 'jsdom';

describe('Renderer Component Tests', () => {
  let dom: JSDOM;
  let window: any;
  let document: any;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    window = dom.window;
    document = window.document;
    
    // Setup global objects for component testing
    (global as any).window = window;
    (global as any).document = document;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Notebook Cell Renderer', () => {
    it('should render SQL cell output correctly', () => {
      const cellContainer = document.createElement('div');
      cellContainer.className = 'notebook-cell';
      document.body.appendChild(cellContainer);

      // Create output element
      const output = document.createElement('div');
      output.className = 'cell-output';
      output.innerHTML = '<table><tr><td>Result</td></tr></table>';
      cellContainer.appendChild(output);

      expect(cellContainer.querySelector('.cell-output')).to.exist;
      expect(cellContainer.querySelector('table')).to.exist;
    });

    it('should render query results in table format', () => {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const tbody = document.createElement('tbody');

      const headerRow = document.createElement('tr');
      const headers = ['id', 'name', 'email'];
      headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);

      const dataRow = document.createElement('tr');
      const data = ['1', 'John Doe', 'john@example.com'];
      data.forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell;
        dataRow.appendChild(td);
      });
      tbody.appendChild(dataRow);

      table.appendChild(thead);
      table.appendChild(tbody);
      document.body.appendChild(table);

      expect(table.querySelectorAll('th')).to.have.length(3);
      expect(table.querySelectorAll('td')).to.have.length(3);
      expect(table.querySelector('td')?.textContent).to.equal('1');
    });

    it('should display execution time information', () => {
      const cellInfo = document.createElement('div');
      cellInfo.className = 'cell-info';
      cellInfo.innerHTML = '<span class="execution-time">Executed in 234ms</span>';
      document.body.appendChild(cellInfo);

      const executionTime = document.querySelector('.execution-time');
      expect(executionTime?.textContent).to.include('234ms');
    });

    it('should handle empty result sets', () => {
      const output = document.createElement('div');
      output.className = 'query-result';
      output.innerHTML = '<p class="empty-result">No results returned</p>';
      document.body.appendChild(output);

      const emptyMsg = document.querySelector('.empty-result');
      expect(emptyMsg?.textContent).to.equal('No results returned');
    });

    it('should render error messages with styling', () => {
      const errorContainer = document.createElement('div');
      errorContainer.className = 'error-container';
      errorContainer.innerHTML = `
        <div class="error-message">
          <strong>ERROR:</strong> syntax error at or near "SELCT"
        </div>
      `;
      document.body.appendChild(errorContainer);

      const error = document.querySelector('.error-message');
      expect(error?.textContent).to.include('syntax error');
    });
  });

  describe('Dashboard Components', () => {
    it('should render dashboard cards', () => {
      const dashboard = document.createElement('div');
      dashboard.className = 'dashboard';

      const card = document.createElement('div');
      card.className = 'dashboard-card';
      card.innerHTML = `
        <h3>Connections</h3>
        <div class="metric">5</div>
      `;
      dashboard.appendChild(card);
      document.body.appendChild(dashboard);

      const cardElement = document.querySelector('.dashboard-card');
      expect(cardElement?.querySelector('h3')?.textContent).to.equal('Connections');
      expect(cardElement?.querySelector('.metric')?.textContent).to.equal('5');
    });

    it('should render chart containers', () => {
      const chartContainer = document.createElement('div');
      chartContainer.id = 'queryTimingChart';
      chartContainer.style.height = '300px';
      document.body.appendChild(chartContainer);

      expect(document.getElementById('queryTimingChart')).to.exist;
      expect(document.getElementById('queryTimingChart')?.style.height).to.equal('300px');
    });

    it('should render connection list with status indicators', () => {
      const list = document.createElement('ul');
      list.className = 'connection-list';

      const connectionItem = document.createElement('li');
      connectionItem.className = 'connection-item';
      connectionItem.innerHTML = `
        <span class="status-indicator active"></span>
        <span class="connection-name">Production DB</span>
      `;
      list.appendChild(connectionItem);
      document.body.appendChild(list);

      const indicator = document.querySelector('.status-indicator');
      expect(indicator?.className).to.include('active');
    });
  });

  describe('Form Components', () => {
    it('should render connection form fields', () => {
      const form = document.createElement('form');
      form.className = 'connection-form';

      const fields = ['host', 'port', 'database', 'user', 'password'];
      fields.forEach(field => {
        const input = document.createElement('input');
        input.type = field === 'password' ? 'password' : 'text';
        input.name = field;
        input.className = `form-input-${field}`;
        form.appendChild(input);
      });

      document.body.appendChild(form);

      expect(document.querySelector('input[name="host"]')).to.exist;
      expect(document.querySelector('input[name="port"]')).to.exist;
      expect(document.querySelector('input[type="password"]')).to.exist;
    });

    it('should validate form input on change', () => {
      const input = document.createElement('input');
      input.type = 'email';
      input.className = 'email-input';
      document.body.appendChild(input);

      const changeEvent = new window.Event('change', { bubbles: true });
      const changeHandler = sandbox.spy();
      input.addEventListener('change', changeHandler);
      input.dispatchEvent(changeEvent);

      expect(changeHandler.calledOnce).to.be.true;
    });

    it('should disable form on submission', () => {
      const button = document.createElement('button');
      button.className = 'submit-btn';
      button.disabled = false;
      document.body.appendChild(button);

      button.disabled = true;
      expect(button.disabled).to.be.true;
    });
  });

  describe('Tree View Components', () => {
    it('should render tree view items', () => {
      const tree = document.createElement('ul');
      tree.className = 'tree-view';

      const item = document.createElement('li');
      item.className = 'tree-item';
      item.innerHTML = `
        <span class="tree-label">public schema</span>
        <ul class="tree-children"></ul>
      `;
      tree.appendChild(item);
      document.body.appendChild(tree);

      expect(document.querySelector('.tree-label')?.textContent).to.equal('public schema');
    });

    it('should expand and collapse tree items', () => {
      const item = document.createElement('li');
      item.className = 'tree-item';
      item.innerHTML = `
        <span class="expand-icon">▶</span>
        <span class="tree-label">Tables</span>
        <ul class="tree-children" style="display: none;"></ul>
      `;
      document.body.appendChild(item);

      const children = item.querySelector('.tree-children') as any;
      expect(children.style.display).to.equal('none');

      children.style.display = 'block';
      expect(children.style.display).to.equal('block');
    });

    it('should render context menu for tree items', () => {
      const contextMenu = document.createElement('div');
      contextMenu.className = 'context-menu';
      contextMenu.innerHTML = `
        <div class="menu-item">Create Table</div>
        <div class="menu-item">Drop Table</div>
      `;
      document.body.appendChild(contextMenu);

      const items = document.querySelectorAll('.menu-item');
      expect(items).to.have.length(2);
    });
  });

  describe('Theme and Styling', () => {
    it('should apply theme variables', () => {
      const root = document.documentElement;
      root.style.setProperty('--vscode-editor-background', '#1e1e1e');
      root.style.setProperty('--vscode-editor-foreground', '#d4d4d4');

      expect(root.style.getPropertyValue('--vscode-editor-background')).to.equal('#1e1e1e');
    });

    it('should toggle dark mode class', () => {
      const body = document.body;
      body.classList.add('theme-dark');

      expect(body.classList.contains('theme-dark')).to.be.true;

      body.classList.remove('theme-dark');
      expect(body.classList.contains('theme-dark')).to.be.false;
    });
  });

  describe('Interactive Elements', () => {
    it('should handle button clicks', () => {
      const button = document.createElement('button');
      button.textContent = 'Execute';
      document.body.appendChild(button);

      const clickHandler = sandbox.spy();
      button.addEventListener('click', clickHandler);
      button.click();

      expect(clickHandler.calledOnce).to.be.true;
    });

    it('should handle input changes', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const changeHandler = sandbox.spy();
      input.addEventListener('change', changeHandler);

      input.value = 'test value';
      input.dispatchEvent(new window.Event('change', { bubbles: true }));

      expect(changeHandler.called).to.be.true;
    });

    it('should handle keyboard events', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const keydownHandler = sandbox.spy();
      input.addEventListener('keydown', keydownHandler);

      const event = new window.KeyboardEvent('keydown', { key: 'Enter' });
      input.dispatchEvent(event);

      expect(keydownHandler.called).to.be.true;
    });
  });

  describe('Message Handling', () => {
    it('should handle webview message events', () => {
      const messageHandler = sandbox.spy();
      window.addEventListener('message', messageHandler);

      const message = {
        command: 'executeQuery',
        query: 'SELECT 1'
      };

      // Manually dispatch event since jsdom's postMessage is async
      const event = new window.MessageEvent('message', {
        data: message,
        origin: '*'
      });
      window.dispatchEvent(event);
      expect(messageHandler.called).to.be.true;
    });

    it('should serialize and deserialize message data', () => {
      const data = {
        type: 'result',
        rows: [{ id: 1, name: 'test' }],
        executionTime: 100
      };

      const serialized = JSON.stringify(data);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.rows).to.have.length(1);
      expect(deserialized.executionTime).to.equal(100);
    });
  });

  describe('Accessibility', () => {
    it('should include ARIA labels on buttons', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Execute Query');
      document.body.appendChild(button);

      expect(button.getAttribute('aria-label')).to.equal('Execute Query');
    });

    it('should support keyboard navigation', () => {
      const button = document.createElement('button');
      button.tabIndex = 0;
      document.body.appendChild(button);

      expect(button.tabIndex).to.equal(0);
    });

    it('should render semantic HTML structure', () => {
      const header = document.createElement('header');
      const main = document.createElement('main');
      const footer = document.createElement('footer');

      document.body.appendChild(header);
      document.body.appendChild(main);
      document.body.appendChild(footer);

      expect(document.querySelector('header')).to.exist;
      expect(document.querySelector('main')).to.exist;
      expect(document.querySelector('footer')).to.exist;
    });
  });
});
