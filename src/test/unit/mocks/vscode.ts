// Minimal mock of VS Code API for unit tests
export const EventEmitter = class<T> {
  private listeners: Function[] = [];
  event = (listener: Function) => { this.listeners.push(listener); return { dispose: () => {} }; };
  fire = (arg?: any) => { this.listeners.forEach(l => l(arg)); };
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
  joinPath: (...parts: string[]) => ({ fsPath: parts.join('/'), toString: () => parts.join('/') })
};

export const workspace: any = {
  getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve() }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  fs: {
    readFile: async () => Buffer.from(''),
    writeFile: async () => {}
  }
};

export const window: any = {
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showQuickPick: () => Promise.resolve(undefined),
  createOutputChannel: () => ({ appendLine: () => {}, show: () => {} })
};

export const commands: any = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => {}
};

export const notebooks: any = {
  createNotebookController: () => ({ dispose: () => {} }),
};

export const env: any = {};
export const languages: any = {};

// export default namespace style
const vscode = { EventEmitter, Uri, workspace, window, commands, notebooks, env, languages } as any;
export default vscode;
import * as sinon from 'sinon';


export const workspace = {
  getConfiguration: () => ({
    get: () => [],
    update: () => Promise.resolve(),
  }),
  onDidChangeConfiguration: () => ({ dispose: () => { } }),
  notebookDocuments: [] as any[],
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
} as const;

export type TreeItemCollapsibleState = typeof TreeItemCollapsibleState[keyof typeof TreeItemCollapsibleState];

export class TreeItem {
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) { }
}

export class EventEmitter {
  event = () => ({ dispose: () => { } });
  fire = () => { };
}

export class Disposable {
  dispose = () => { };
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
  constructor(public id: string) { }
}

export class ThemeIcon {
  constructor(public id: string, public color?: ThemeColor) { }
}

export class NotebookCellOutput {
  metadata: any;
  constructor(public items: any[], metadata?: any) {
    this.items = items;
    this.metadata = metadata;
  }
}

export class NotebookCellOutputItem {
  constructor(public data: any, public mime: string) { }

  static text(value: string, mime?: string) {
    return new NotebookCellOutputItem(Buffer.from(value), mime || 'text/plain');
  }
  static error(err: any) {
    return new NotebookCellOutputItem(Buffer.from(String(err)), 'application/vnd.code.notebook.error');
  }
}

export const languages = {
  registerCompletionItemProvider: () => ({ dispose: () => { } })
};

export const NotebookCellKind = {
  Markup: 1,
  Code: 2
} as const;

export type NotebookCellKind = typeof NotebookCellKind[keyof typeof NotebookCellKind];


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
} as const;

export type CompletionItemKind = typeof CompletionItemKind[keyof typeof CompletionItemKind];

export class CompletionItem {
  detail?: string;
  documentation?: string | MarkdownString;
  insertText?: string | SnippetString;
  kind?: CompletionItemKind;

  constructor(public label: string | CompletionItemLabel, kind?: CompletionItemKind) {
    this.kind = kind;
  }
}

export type CompletionItemLabel = { label: string, detail?: string, description?: string };

export class MarkdownString {
  constructor(public value?: string) { }
  appendCodeblock(value: string, language?: string) { return this; }
  appendMarkdown(value: string) { return this; }
  appendText(value: string) { return this; }
}

export class SnippetString {
  constructor(public value?: string) { }
  appendText(value: string) { return this; }
  appendTabstop(number?: number) { return this; }
  appendPlaceholder(value: string | ((snippet: SnippetString) => any), number?: number) { return this; }
  appendVariable(name: string, defaultValue?: string | ((snippet: SnippetString) => any)) { return this; }
}

export class Position {
  constructor(public line: number, public character: number) { }
}

export class Range {
  constructor(public start: Position, public end: Position) { }
}
export class Uri {
  static file(path: string) { return new Uri(path); }
  static parse(path: string) { return new Uri(path); }
  static joinPath(base: Uri, ...segments: string[]) {
    // Simple mock implementation
    const joined = [base.fsPath, ...segments].join('/').replace(/\/+/g, '/');
    return new Uri(joined);
  }
  constructor(public readonly fsPath: string) { }
  toString() { return this.fsPath; }
  with(change: any) { return this; }
}
