/**
 * AI Provider service for chat functionality
 */
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { ChatMessage } from './types';

export class AiService {
  private _messages: ChatMessage[] = [];
  private _cancellationTokenSource: vscode.CancellationTokenSource | null = null;
  private _abortController: AbortController | null = null;

  setMessages(messages: ChatMessage[]): void {
    this._messages = messages;
  }

  /**
   * Cancel any ongoing AI request
   */
  cancel(): void {
    if (this._cancellationTokenSource) {
      this._cancellationTokenSource.cancel();
      this._cancellationTokenSource.dispose();
      this._cancellationTokenSource = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  buildSystemPrompt(): string {
    return `You are an expert PostgreSQL database assistant. You help users with:
- Writing and optimizing SQL queries
- Understanding database concepts and best practices
- Debugging query issues
- Explaining query execution plans
- Schema design recommendations
- PostgreSQL-specific features and extensions

**IMPORTANT - DATABASE SCHEMA CONTEXT:**
When the user references database objects (tables, views, functions, etc.), I will provide you with the actual schema information in a section marked "=== DATABASE SCHEMA CONTEXT ===". 
- ALWAYS use this provided schema information when answering questions
- The schema context includes real column names, data types, constraints, indexes, and relationships
- Reference the exact column names and types from the provided schema
- Do NOT say you don't have access to the schema when it's provided in the context

**SQL QUALITY CHECKLIST (MANDATORY - Follow before every SQL response):**
Before providing any SQL query, you MUST verify:
1. ✓ All table names exist in the provided schema context or user input
2. ✓ All column names are EXACTLY as shown in the schema (case-sensitive)
3. ✓ All data types are compatible with the operations performed
4. ✓ JOIN conditions use correct column names from both tables
5. ✓ WHERE conditions reference existing columns
6. ✓ GROUP BY includes all non-aggregated columns in SELECT
7. ✓ No syntax errors (matching parentheses, proper comma placement, semicolon at end)
8. ✓ Aliases are used consistently throughout the query
9. ✓ Foreign key relationships are correctly referenced
10. ✓ The query is complete and can be executed as-is

**SQL FORMATTING RULES (MANDATORY):**
When providing SQL code, ALWAYS format it for maximum readability:
1. Use proper indentation (4 spaces) for nested clauses
2. Put each major clause (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, etc.) on a new line
3. Put each column in SELECT on its own line for queries with more than 3 columns
4. Put each condition in WHERE/AND/OR on its own line
5. Align JOIN conditions properly
6. Use UPPERCASE for SQL keywords
7. Use lowercase for table/column names (unless schema shows otherwise)
8. Add blank lines between CTEs and main query
9. Break long lines at logical points (operators, commas)
10. Always end queries with a semicolon

Example of properly formatted SQL:
\`\`\`sql
SELECT
    u.id,
    u.username,
    u.email,
    COUNT(o.id) AS order_count,
    SUM(o.total_amount) AS total_spent
FROM
    users u
LEFT JOIN
    orders o ON o.user_id = u.id
WHERE
    u.created_at >= '2024-01-01'
    AND u.status = 'active'
GROUP BY
    u.id,
    u.username,
    u.email
HAVING
    COUNT(o.id) > 5
ORDER BY
    total_spent DESC
LIMIT 100;
\`\`\`

**RESPONSE QUALITY:**
- Double-check all SQL for correctness before responding
- If schema context is provided, ONLY use columns that exist in that schema
- If you're unsure about a column name, ask the user to clarify
- Provide complete, executable SQL - never truncate or abbreviate
- If a query is complex, break it down and explain each part
- NEVER include HTML tags, CSS classes, or any markup in SQL code
- SQL strings should use single quotes like 'value', not any special formatting
- Your output is plain markdown only - no HTML

IMPORTANT: At the end of each response, provide 2-4 numbered follow-up questions the user might want to ask next. Format them as:

**Follow-up questions:**
1. [First question]
2. [Second question]
3. [Third question]

Make these questions relevant to the topic discussed and progressively more advanced.`;
  }

  async callVsCodeLm(userMessage: string, config: vscode.WorkspaceConfiguration, customSystemPrompt?: string): Promise<{ text: string, usage?: string }> {
    const configuredModel = config.get<string>('aiModel');
    let models: vscode.LanguageModelChat[];

    if (configuredModel) {
      // Extract base name if format is "name (family)"
      const baseName = configuredModel.replace(/\s*\(.*\)$/, '').trim();

      // Try to find the specific model by name/id/family
      const allModels = await vscode.lm.selectChatModels({});
      const matchingModels = allModels.filter(m =>
        m.id === baseName ||
        m.name === baseName ||
        m.family === baseName ||
        m.id === configuredModel ||
        m.name === configuredModel ||
        m.family === configuredModel
      );
      models = matchingModels.length > 0 ? matchingModels : allModels;
    } else {
      // Default: try gpt-4o family first
      models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
      if (models.length === 0) {
        models = await vscode.lm.selectChatModels({});
      }
    }

    const model = models[0];
    if (!model) {
      throw new Error('No AI models available via VS Code API. Please ensure GitHub Copilot Chat is installed or switch provider.');
    }

    const systemPrompt = customSystemPrompt !== undefined ? customSystemPrompt : this.buildSystemPrompt();

    const messages = [];
    if (systemPrompt) {
      messages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
    }

    messages.push(
      ...this._messages.slice(-10).map(msg =>
        msg.role === 'user'
          ? vscode.LanguageModelChatMessage.User(this._sanitizeContent(this._getMessageContent(msg)))
          : vscode.LanguageModelChatMessage.Assistant(this._sanitizeContent(this._getMessageContent(msg)))
      )
    );
    messages.push(vscode.LanguageModelChatMessage.User(userMessage));

    // Debug: Log all messages being sent to model
    console.log('[AiService] ========== MESSAGES SENT TO MODEL ==========');
    console.log('[AiService] System prompt length:', systemPrompt.length);
    console.log('[AiService] Conversation history messages:', this._messages.length);

    // Create and store cancellation token source for this request
    this._cancellationTokenSource = new vscode.CancellationTokenSource();

    try {
      const chatRequest = await model.sendRequest(messages, {}, this._cancellationTokenSource.token);
      let responseText = '';

      for await (const fragment of chatRequest.text) {
        responseText += fragment;
      }

      return { text: responseText };
    } finally {
      // Clean up cancellation token source
      if (this._cancellationTokenSource) {
        this._cancellationTokenSource.dispose();
        this._cancellationTokenSource = null;
      }
    }
  }

  // Sanitize content to remove any HTML/CSS artifacts before sending to AI
  private _sanitizeContent(content: string): string {
    let cleaned = content;
    // Remove CSS class-like patterns that may have leaked into history
    cleaned = cleaned.replace(/\b(sql-keyword|sql-string|sql-function|sql-number|sql-type|sql-comment|sql-operator|sql-special|function)"\s*>/gi, '');
    return cleaned;
  }

  private _getMessageContent(msg: ChatMessage): string {
    let content = msg.content;
    if (msg.attachments && msg.attachments.length > 0) {
      const attachmentTexts = msg.attachments.map(att =>
        `\n\nFile: ${att.name} (${att.type})\n\`\`\`${att.type}\n${att.content}\n\`\`\``
      ).join('');
      content += attachmentTexts;
    }
    return content;
  }

  async callDirectApi(provider: string, userMessage: string, config: vscode.WorkspaceConfiguration, customSystemPrompt?: string): Promise<{ text: string, usage?: string }> {
    const apiKey = config.get<string>('aiApiKey');
    
    // API key is required for most providers, but optional for custom endpoints
    if (!apiKey && provider !== 'custom') {
      throw new Error(`API Key is required for ${provider} provider. Please configure postgresExplorer.aiApiKey.`);
    }

    let endpoint = '';
    let model = config.get<string>('aiModel');
    let headers: any = {
      'Content-Type': 'application/json'
    };
    
    // Only add Authorization header if API key is provided
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    let body: any = {};

    const systemPrompt = customSystemPrompt !== undefined ? customSystemPrompt : this.buildSystemPrompt();

    // Sanitize conversation history to remove any HTML artifacts
    const conversationHistory = this._messages.slice(-10).map(msg => ({
      role: msg.role,
      content: this._sanitizeContent(this._getMessageContent(msg))
    }));

    if (provider === 'openai') {
      endpoint = 'https://api.openai.com/v1/chat/completions';
      model = model || 'gpt-4o';

      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push(...conversationHistory);
      messages.push({ role: 'user', content: userMessage });

      body = {
        model: model,
        messages: messages,
        temperature: 0.7
      };
    } else if (provider === 'anthropic') {
      endpoint = 'https://api.anthropic.com/v1/messages';
      model = model || 'claude-3-5-sonnet-20241022';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Authorization'];
      body = {
        model: model,
        system: systemPrompt,
        messages: [
          ...conversationHistory,
          { role: 'user', content: userMessage }
        ],
        max_tokens: 4096
      };
    } else if (provider === 'gemini') {
      model = model || 'gemini-1.5-flash';
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      headers['X-goog-api-key'] = apiKey;
      delete headers['Authorization'];

      body = {
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents: [
          ...conversationHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          })),
          { role: 'user', parts: [{ text: userMessage }] }
        ]
      };
    } else if (provider === 'custom') {
      endpoint = config.get<string>('aiEndpoint') || '';
      if (!endpoint) {
        throw new Error('Endpoint is required for custom provider');
      }
      model = model || 'gpt-3.5-turbo';

      const messages: any[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push(...conversationHistory);
      messages.push({ role: 'user', content: userMessage });

      body = {
        model: model,
        messages: messages
      };
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    return this._makeHttpRequest(endpoint, headers, body, provider);
  }

  private _makeHttpRequest(endpoint: string, headers: any, body: any, provider: string): Promise<{ text: string, usage?: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const requestData = JSON.stringify(body);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(requestData)
        }
      };

      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);

            if (res.statusCode !== 200) {
              reject(new Error(response.error?.message || `API request failed with status ${res.statusCode}`));
              return;
            }

            let content = '';
            let usage = '';

            if (provider === 'anthropic') {
              content = response.content?.[0]?.text || '';
              if (response.usage) {
                 usage = `${response.usage.input_tokens} input, ${response.usage.output_tokens} output`;
              }
            } else if (provider === 'gemini') {
              content = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (response.usageMetadata) {
                 usage = `${response.usageMetadata.totalTokenCount} tokens`;
              }
            } else {
              // OpenAI or compatible
              content = response.choices?.[0]?.message?.content || '';
              if (response.usage) {
                 usage = `${response.usage.total_tokens} tokens (P:${response.usage.prompt_tokens}, C:${response.usage.completion_tokens})`;
              }
            }

            if (!content && provider === 'custom') {
              content = JSON.stringify(response); // Fallback
            }

            resolve({ text: content, usage });
          } catch (e) {
            // If response is not JSON, we might want to log it
            reject(new Error(`Failed to parse API response: ${e instanceof Error ? e.message : String(e)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(requestData);
      req.end();
    });
  }

  async generateTitle(firstMessage: string, provider: string): Promise<string> {
    try {
      if (provider === 'vscode-lm') {
        const models = await vscode.lm.selectChatModels({});
        if (models.length > 0) {
          const prompt = `Generate a very short title (max 5 words) for a chat about: "${firstMessage.substring(0, 100)}". Return only the title, nothing else.`;
          const messages = [vscode.LanguageModelChatMessage.User(prompt)];
          const response = await models[0].sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
          let title = '';
          for await (const fragment of response.text) {
            title += fragment;
          }
          return title.trim().substring(0, 50);
        }
      }

      // Fallback to simple extraction
      const title = firstMessage.substring(0, 40).replace(/\n/g, ' ').trim();
      return title.length === 40 ? title + '...' : title;
    } catch {
      const simple = firstMessage.substring(0, 40).replace(/\n/g, ' ').trim();
      return simple.length === 40 ? simple + '...' : simple;
    }
  }

  async getModelInfo(provider: string, config: vscode.WorkspaceConfiguration): Promise<string> {
    try {
      const configuredModel = config.get<string>('aiModel');

      if (provider === 'vscode-lm') {
        if (configuredModel) {
          const baseName = configuredModel.replace(/\s*\(.*\)$/, '').trim();
          const allModels = await this._selectChatModelsWithTimeout({});
          const matchingModels = allModels.filter((m: vscode.LanguageModelChat) =>
            m.id === baseName || m.name === baseName || m.family === baseName ||
            m.id === configuredModel || m.name === configuredModel || m.family === configuredModel
          );
          if (matchingModels.length > 0) {
            return matchingModels[0].name || matchingModels[0].id;
          }
        }
        const models = await this._selectChatModelsWithTimeout({ family: 'gpt-4o' });
        if (models.length > 0) {
          return models[0].name || models[0].id;
        }
        const anyModels = await this._selectChatModelsWithTimeout({});
        return anyModels.length > 0 ? (anyModels[0].name || anyModels[0].id) : 'VS Code LM (No Models)';
      } else {
        return configuredModel || this._getDefaultModel(provider);
      }
    } catch {
      return 'Unknown';
    }
  }

  private _getDefaultModel(provider: string): string {
    switch (provider) {
      case 'openai': return 'gpt-4o';
      case 'anthropic': return 'claude-3-5-sonnet-20241022';
      case 'gemini': return 'gemini-1.5-flash';
      case 'custom': return 'custom-model';
      default: return 'Unknown';
    }
  }

  private async _selectChatModelsWithTimeout(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat[]> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[AiService] vscode.lm.selectChatModels timed out after 2000ms');
        resolve([]);
      }, 2000);

      vscode.lm.selectChatModels(selector).then((models) => {
        clearTimeout(timeout);
        resolve(models);
      }, (error) => {
        clearTimeout(timeout);
        console.error('[AiService] vscode.lm.selectChatModels failed:', error);
        resolve([]);
      });
    });
  }
}
