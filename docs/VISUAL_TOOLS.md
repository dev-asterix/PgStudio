# Visual Database Tools

PgStudio v0.8.4 introduces powerful visual editors to manage your database schema without writing complex DDL manually.

## 🏗️ Visual Table Designer

Create and edit tables with a robust, interactive UI.

### Features
- **Column Management**: Add, remove, and reorder columns.
- **Data Types**: Full support for PostgreSQL data types (TEXT, INTEGER, JSONB, UUID, etc.) with length/precision options.
- **Constraints**: 
    - **Primary Keys**: Define single or composite primary keys.
    - **Foreign Keys**: Visually link to other tables with ON DELETE/UPDATE rules.
    - **Unique/Check**: Add custom constraints.
- **Preview SQL**: See the generated `CREATE TABLE` query in real-time before executing.

### Usage
- **Create**: Right-click a Schema in the sidebar → **Create Table**.
- **Edit**: Right-click an existing Table → **Design Table**.

---

## 🔑 Index & Constraint Manager

Optimize performance and ensure data integrity with a dedicated management interface.

### Features
- **Usage Statistics**: See scan counts and read/fetch efficiency for every index.
- **Unused Index Detection**: Quickly identify indexes that are consuming space but not being used.
- **Visual Creation**: created indexes (B-Tree, Hash, GIN, GiST) on single or multiple columns.
- **Drop Safely**: Remove unused indexes with a single click.

### Usage
- Right-click a Table → **Manage Indexes & Constraints**.

---

## 📋 Smart Paste

Intelligently handle clipboard content based on context.

### Features
- **SQL Detection**: Pasting SQL into a notebook automatically offers to format it.
- **CSV/JSON Detection**: Pasting data suggests:
    - **Insert as Rows**: Convert raw data into `INSERT` statements for the current table context.
    - **Create Table**: Generate a new table schema based on the data structure.

### Usage
- Simply paste (`Ctrl+V` / `Cmd+V`) content into a notebook or SQL editor. PgStudio will analyze the content and show a "Smart Action" notification if applicable.

---

## 📊 Dashboard Diagnostics

The Server Dashboard now includes deep diagnostic tools:

- **Lock Viewer**: A tree visualization of blocking chains. Identify the root cause of stuck queries.
- **Kill/Cancel**: Terminate blocking sessions directly from the "Active Queries" list.
- **IO Metrics**: Real-time charts for Checkpoints, Temp File usage, and Tuple Fetch/Return ratios.
