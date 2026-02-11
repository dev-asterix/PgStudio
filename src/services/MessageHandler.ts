import * as vscode from 'vscode';

export interface IMessageHandler {
  handle(message: any, context: {
    editor?: vscode.NotebookEditor | undefined;
    webview?: vscode.Webview | undefined;
    postMessage?: (message: any) => Thenable<boolean>;
    [key: string]: any;
  }): Promise<void>;
}

export class MessageHandlerRegistry {
  private static instance: MessageHandlerRegistry;
  private handlers: Map<string, IMessageHandler> = new Map();

  private constructor() { }

  public static getInstance(): MessageHandlerRegistry {
    if (!MessageHandlerRegistry.instance) {
      MessageHandlerRegistry.instance = new MessageHandlerRegistry();
    }
    return MessageHandlerRegistry.instance;
  }

  public register(type: string, handler: IMessageHandler) {
    if (this.handlers.has(type)) {
      console.warn(`Overwriting handler for message type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  public async handleMessage(message: any, context: {
    editor?: vscode.NotebookEditor | undefined;
    webview?: vscode.Webview | undefined;
    postMessage?: (message: any) => Thenable<boolean>;
    [key: string]: any;
  }) {
    const handler = this.handlers.get(message.type);
    if (handler) {
      try {
        await handler.handle(message, context);
      } catch (error) {
        console.error(`Error handling message ${message.type}:`, error);
        vscode.window.showErrorMessage(`Error processing ${message.type}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.warn(`No handler registered for message type: ${message.type}`);
    }
  }
}
