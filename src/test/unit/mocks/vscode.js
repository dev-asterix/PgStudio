import * as sinon from 'sinon';

export const workspace = {
  getConfiguration: () => ({
    get: () => [],
    update: () => Promise.resolve(),
  }),
  onDidChangeConfiguration: () => ({ dispose: () => { } }),
  notebookDocuments: [],
  onDidOpenNotebookDocument: () => ({ dispose: () => { } }),
  onDidSaveNotebookDocument: () => ({ dispose: () => { } }),
  onDidChangeNotebookDocument: () => ({ dispose: () => { } }),
  onDidCloseNotebookDocument: () => ({ dispose: () => { } }),
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => { }
  }
};

export const window = {
  createOutputChannel: () => ({
    appendLine: () => { },
    show: () => { },
    dispose: () => { }
  }),
  showErrorMessage: async () => { },
  showInformationMessage: async () => { },
  createTreeView: () => ({
    reveal: async () => { }
  }),
  registerTreeDataProvider: () => ({ dispose: () => { } })
};

export const commands = {
  registerCommand: () => ({ dispose: () => { } }),
  executeCommand: async () => { }
};

export const notebooks = {
  createNotebookController: () => ({
    createNotebookCellExecution: () => ({
      start: () => { },
      end: () => { },
      replaceOutput: () => { },
      clearOutput: () => { }
    })
  })
};

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

export class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class EventEmitter {
  constructor() {
    this.event = () => ({ dispose: () => { } });
    this.fire = () => { };
  }
}

export class Disposable {
  constructor() {
    this.dispose = () => { };
  }
}

export const ExtensionContext = {
  subscriptions: []
};

export const SecretStorage = {
  get: async () => undefined,
  store: async () => { },
  delete: async () => { },
  onDidChange: () => ({ dispose: () => { } })
};

export class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

export class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

export class NotebookCellOutput {
  constructor(items, metadata) {
    this.items = items;
    this.metadata = metadata;
  }
}

export class NotebookCellOutputItem {
  constructor(data, mime) {
    this.data = data;
    this.mime = mime;
  }

  static text(value, mime) {
    return new NotebookCellOutputItem(Buffer.from(value), mime || 'text/plain');
  }
  
  static error(err) {
    return new NotebookCellOutputItem(Buffer.from(String(err)), 'application/vnd.code.notebook.error');
  }
}

export const languages = {
  registerCompletionItemProvider: () => ({ dispose: () => { } })
};

export const NotebookCellKind = {
  Markup: 1,
  Code: 2
};

export const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
  User: 25,
  Issue: 26,
};

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0
};

export class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
    this.detail = undefined;
    this.documentation = undefined;
    this.insertText = undefined;
  }
}

export class MarkdownString {
  constructor(value) {
    this.value = value;
  }
  
  appendCodeblock(value, language) { return this; }
  appendMarkdown(value) { return this; }
  appendText(value) { return this; }
}

export class SnippetString {
  constructor(value) {
    this.value = value;
  }
  
  appendText(value) { return this; }
  appendTabstop(number) { return this; }
  appendPlaceholder(value, number) { return this; }
  appendVariable(name, defaultValue) { return this; }
}

export class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

export class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

export class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
  }
  
  static file(path) { return new Uri(path); }
  static parse(path) { return new Uri(path); }
  static joinPath(base, ...segments) {
    const joined = [base.fsPath, ...segments].join('/').replace(/\/+/g, '/');
    return new Uri(joined);
  }
  
  toString() { return this.fsPath; }
  with(change) { return this; }
}
