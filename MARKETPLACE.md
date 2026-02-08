<div align="center">

# 🐘 PgStudio

### *Professional Database Management for VS Code*

**PgStudio is a comprehensive PostgreSQL database management extension featuring interactive SQL notebooks, real-time monitoring dashboard, AI-powered assistance, and advanced database operations—all within VS Code.**

</div>

---

## 📸 Screenshots

### 🎥 Video Guides

#### 1. Quick Setup
![PgStudio Setup](docs/assets/01-setup.gif)

#### 2. Database Explorer
![Database Explorer](docs/assets/03-explorer.gif)

#### 3. AI Assistant Configuration
![AI Assistant Setup](docs/assets/02-ai-assist-setup.gif)

#### 4. AI Assistant In-Action
![AI Assistant Usage](docs/assets/04-ai-assist.gif)

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔌 **Secure Connections** | Manage multiple connections with VS Code SecretStorage encryption |
| 🛡️ **Connection Safety** | Environment tagging (🔴 PROD, 🟡 STAGING, 🟢 DEV), read-only mode, query safety analyzer |
| 📊 **Live Dashboard** | Real-time metrics, active query monitoring, and performance graphs |
| 📓 **SQL Notebooks** | Interactive notebooks with rich output, AI assistance, and export options |
| 💾 **Saved Queries** | Tag-based organization, AI metadata generation, connection context restoration, edit & reuse |
| 🌳 **Database Explorer** | Browse tables, views, functions, types, extensions, roles, and FDWs |
| 🛠️ **Object Operations** | Full CRUD operations, scripts, VACUUM, ANALYZE, REINDEX |
| 📊 **Table Intelligence** | Profile, activity monitor, index usage analytics, definition viewer |
| 🔍 **EXPLAIN CodeLens** | One-click EXPLAIN/ANALYZE with results in notebooks |
| 🛡️ **Auto-LIMIT** | Automatic query protection with configurable row limits (default 1000) |
| 🌍 **Foreign Data Wrappers** | Manage foreign servers, user mappings, and tables |
| 🤖 **AI-Powered** | GitHub Copilot, OpenAI, Anthropic, and Google Gemini integration |
| ⌨️ **Developer Tools** | IntelliSense, keyboard shortcuts, PSQL terminal access |
| 📤 **Export Data** | Export query results to CSV, JSON, or Excel formats |

---

## 🎯 Why PgStudio?

<table>
<tr>
<td width="50%">

### 🎨 Modern Interface
- Beautiful, intuitive UI designed for developers
- Real-time dashboard with live metrics
- Context-aware operations
- Seamless VS Code integration

</td>
<td width="50%">

### ⚡ Powerful Features
- Interactive SQL notebooks
- 🤖 AI-powered Copilot & agentic support
- Advanced query management
- Complete CRUD operations

</td>
</tr>
<tr>
<td>

### 🔐 Secure & Reliable
- VS Code SecretStorage for credentials
- Environment tagging & read-only mode
- Query safety analyzer with risk scoring
- Auto-LIMIT protection
- Transaction support

</td>
<td>

### 📊 Performance Intelligence
- Table profiling with size breakdown
- Real-time activity monitoring
- Index usage analytics
- Bloat detection & warnings
- EXPLAIN CodeLens for optimization

</td>
</tr>
<tr>
<td>

### 🚀 Developer Friendly
- 🤖 GitHub Copilot integration
- Keyboard shortcuts
- IntelliSense support
- PSQL terminal integration

</td>
</tr>
</table>

---

## 🌳 Database Explorer

Navigate your database with an intuitive hierarchical tree view:

```
📁 Connection
└── 🗄️ Database
    └── 📂 Schema
        ├── 📊 Tables
        ├── 👁️ Views
        ├── 🔄 Materialized Views
        ├── ⚙️ Functions
        ├── 🏷️ Types
        ├── 🌍 Foreign Data Wrappers
        ├── 🧩 Extensions
        └── 👥 Roles
```

---

## 💾 Saved Queries Library

Organize, manage, and reuse your most important queries with intelligent tagging and context preservation.

### Core Capabilities
- **🏷️ Tag-Based Organization** — Group queries by purpose for instant discovery
- **🔗 Connection Context** — Queries remember their original connection, database, and schema
- **📓 One-Click Reopening** — Restore queries with full context in a new notebook
- **✏️ In-Place Editing** — Modify queries without creating duplicates
- **🤖 AI Metadata Generation** — Auto-generate titles, descriptions, and tags
- **📊 Rich Metadata Display** — See creation date, usage count, database, and connection at a glance

---

## 🤖 AI-Powered Assistance

Leverage AI to write, optimize, and debug your queries faster:

- **Smart Completions** — Context-aware SQL suggestions
- **Query Explanation** — Understand complex queries in plain English
- **Query Optimization** — Get performance improvement suggestions
- **Error Detection** — Real-time syntax and logical error detection
- **Natural Language to SQL** — Describe what you need, let AI write the SQL

### 🛡️ Safe AI Execution
PgStudio provides a **Safe Execution Model** for AI interactions.
- **Human-in-the-Loop**: AI generates the code, but it is **never executed automatically**. You review it in a notebook cell first.
- **Context Control**: You decide which tables the AI can see.

**Supported AI Providers:**
- GitHub Copilot (VS Code LM)
- OpenAI
- Anthropic Claude
- Google Gemini

---

## 🎨 Rich Data Visualization

Transform your data into insights without exporting to Excel.

### Instantly Visualize Results
- **One-Click Charts**: Create Bar, Line, Area, and Pie charts from any query result.
- **Customizable**: Adjust log scales, use varied point styles, and control fill opacity.
- **Modern VFX**: Enable **Glow** and **Blur** effects for stunning, dashboard-ready visuals.
- Custom Endpoints

---

## 🚀 Quick Start

### Installation

1. Open VS Code → Press `Ctrl+Shift+X`
2. Search for **PostgreSQL Explorer**
3. Click **Install**

Or install via command line:
```bash
code --install-extension ric-v.postgres-explorer
```

### First Connection

1. Click the PostgreSQL icon in the Activity Bar
2. Click **Add Connection** or use `Ctrl+Shift+P` → `PostgreSQL: Add Connection`
3. Enter your connection details and click **Save**
4. Click on your connection to connect and start exploring!

---

## 📊 Complete Database Operations

| Object Type | Operations |
|-------------|------------|
| 📊 **Tables** | View, Edit, Insert, Update, Delete, Truncate, Drop, VACUUM, ANALYZE, REINDEX |
| 👁️ **Views** | View Definition, Edit, Query Data, Drop |
| 🔄 **Materialized Views** | Refresh, View Data, Edit, Drop |
| ⚙️ **Functions** | View, Edit, Call with Parameters, Drop |
| 🏷️ **Types** | View Properties, Edit, Drop |
| 🌍 **Foreign Data Wrappers** | Create/Drop Server, User Mappings, Import Schema |
| 🔗 **Foreign Tables** | View, Edit, Drop |
| 🧩 **Extensions** | Enable, Disable, Drop |
| 👥 **Roles** | Grant/Revoke Permissions, Edit, Drop |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Execute current cell |
| `Shift+Enter` | Execute and move to next |
| `F5` | Refresh current item |
| `Ctrl+Shift+P` | Command palette |

---

## 📚 Resources

- 📖 [Full Documentation](https://dev-asterix.github.io/yape/)
- 🐛 [Report Issues](https://github.com/dev-asterix/yape/issues)
- 💡 [Request Features](https://github.com/dev-asterix/yape/issues/new?template=feature_request.md)
- ⭐ [Star on GitHub](https://github.com/dev-asterix/yape)

---

## 📝 License

This extension is licensed under the [MIT License](https://github.com/dev-asterix/yape/blob/main/LICENSE).

---

<div align="center">

**Made with ❤️ for the PostgreSQL Community**

Also available on [Open VSX](https://open-vsx.org/extension/ric-v/postgres-explorer)

</div>
