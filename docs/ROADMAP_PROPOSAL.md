# PgStudio Roadmap 2026: The Path to a Full-Fledged DBMS

> **Mission:** Combine the depth of pgAdmin with the developer-centric speed of VS Code.
> **Philosophy:** "Reduce fear. Increase speed. Everything else waits."

---

## 🎯 Strategic Pillars

### 1. Visual Schema Builder (VSB) — *"Design without Code"*
**Goal:** Empower users to design and modify database schemas visually without manually writing `ALTER TABLE` statements, while maintaining safety.

- **Visual Table Designer**: A GUI to add/remove columns, change types, and set constraints.
- **Index Manager**: Visually create, drop, and analyze indexes.
- **Constraint Manager**: Manage Foreign Keys, Unique constraints, and Checks with a simple UI.
- **Role/User Management**: Basic interface for creating users and granting permissions (essential for local dev setup).

### 2. Data Fluidity — *"Move Data Instantly"*
**Goal:** Make getting data in and out of the database frictionless and immediate.

- **Smart Paste**: Copy from Excel/Sheets, paste directly into a table grid to insert rows.
- **Visual Import Wizard**: Drag & drop CSV/JSON files, map columns, and import data.
- **Enhanced Export**: Configurable delimiters, encoding, and direct-to-file streaming for large datasets.
- **Quick Clone**: Right-click a table to "Duplicate Structure & Data".

### 3. Operability Suite — *"Diagnose & Fix"*
**Goal:** Give users deep visibility and control over the running database instance to diagnose issues instantly.

- **Session Manager**: View active queries, see who is blocking whom, and `KILL` stuck processes.
- **Lock Viewer**: Visualize blocking chains to resolve deadlocks.
- **Visual Explain Plan**: Graphical flowchart representation of query execution plans (to identify bottlenecks at a glance).
- **Server Dashboard**: Real-time CPU/RAM/IO usage (if compatible with provider).

### 4. Developer Experience (DX) — *"Code Faster"*
**Goal:** Leverage the VS Code ecosystem to bridge the gap between database and application code.

- **TypeScript Type Generation**: Right-click a table -> "Copy TypeScript Interface".
- **Global Object Search**: Integrate with VS Code's `Ctrl+P` (e.g., `#users` to jump to users table).
- **"Go to Definition"**: `F12` on a table name in SQL to jump to its DDL/Designer.
- **API Generator**: Right-click table -> "Generate CRUD API (Node/Python)".

---

## 🗓️ Proposed Rollout Phases

### 🏗️ Phase 7: Visual Schema Design (The "Builder" Phase)
*Focus: making schema changes safe and easy.*
- [ ] **Visual Table Designer** (Add/Edit Columns & Types)
- [ ] **Constraint Manager** (FK, PK, Unique, Check)
- [ ] **Index Manager** (Create/Drop Indexes visually)
- [ ] **Schema Diff** (Compare local vs remote schema)

### 🌊 Phase 8: Data Productivity (The "Mover" Phase)
*Focus: getting data into the right shape fast.*
- [ ] **Smart Paste** (Excel -> Table)
- [ ] **Visual Import Wizard** (CSV/JSON Drag & Drop)
- [ ] **Bulk Row Editing** (Spreadsheet-like experience)
- [ ] **Result Grid Aggregations** (Sum/Avg of selected cells)

### 🩺 Phase 9: Diagnostics & Ops (The "Doctor" Phase)
*Focus: solving performance issues and locks.*
- [ ] **Visual Explain Plan** (Flowchart view)
- [ ] **Session Manager** (View & Kill queries)
- [ ] **Lock Viewer** (Blocking chains)
- [ ] **Log Viewer** (Live tail of Postgres logs if accessible)

### 💻 Phase 10: Developer Integrations (The "Coder" Phase)
*Focus: bridging DB and App code.*
- [ ] **TypeScript / Zod Type Generator**
- [ ] **Global Object Search** (`Ctrl+P` integration)
- [ ] **Snippet Manager** (Team-shared query library)
- [ ] **"Generate Mock Data"** (AI-powered fake data population)

---

## 📊 Feature Comparison (Target State)

| Feature | PgStudio (Future) | pgAdmin | DBeaver | VS Code SQLTools |
|---------|-------------------|---------|---------|------------------|
| **Visual Table Design** | ✅ Modern React UI | ✅ Legacy Dialogs | ✅ | ❌ |
| **Data Import/Export** | ✅ Drag & Drop | ✅ Wizard | ✅ Wizard | ❌ Basic |
| **Interactive Notebooks**| ✅ | ❌ | ❌ | ❌ |
| **TS Type Gen** | ✅ Built-in | ❌ | ❌ | ❌ |
| **AI Copilot** | ✅ Built-in | ❌ | ❌ | ❌ |
| **Session Manager** | ✅ | ✅ | ✅ | ❌ |
