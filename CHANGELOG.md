# Changelog

All notable changes to the PostgreSQL Explorer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.8.4] - 2026-02-19
    
### Added
- **Visual Table Designer**: A robust, interactive UI for creating tables. Define columns, data types, constraints, and foreign keys visually without writing SQL.
- **Visual Index & Constraint Manager**: Manage indexes and constraints with a modern GUI. Analyze usage, drop unused indexes, and create new constraints with ease.
- **Smart Paste**: Intelligent clipboard handling that detects SQL, CSV, or JSON content and offers context-aware actions (e.g., "Insert as Rows", "Format SQL").
- **Dashboard Improvements**:
    - **Visual Lock Viewer**: Diagnostic tree view to identify and resolve blocking chains and deadlocks.
    - **Enhanced Metrics**: Real-time charts for IO, Checkpoints, and System Load.
    - **Active Query Management**: Kill/Cancel blocking queries directly from the dashboard.

### Improved
- **Stability**: Fixed dashboard template loading issues to ensure reliable rendering on all platforms.

---

## [0.8.3] - 2026-02-14

### Added
- **Query Performance Tracking**: Automatically tracks execution times for queries and warns about performance degradation ( > 50% slower than baseline).
- **Visual Explain Plans**: Enhanced visualization for `EXPLAIN (FORMAT JSON)` results, providing a clear graphical representation of query execution paths.

### Improved
- **Message Handling Architecture**: Refactored internal message routing to a robust `MessageHandler` registry pattern for improved stability and maintainability.
- **CodeLens UX**: Cleaned up and reordered CodeLens actions for better usability; removed redundant 'Explain' action (now accessible via main toolbar/menus).

---

## [0.8.2] - 2026-02-08

### Added
- **Advanced Saved Queries System**: Complete redesign with tag-based organization, connection context preservation, AI metadata generation, and rich metadata display.
- **Context Menu Actions**: Copy Query, Edit Query (modify title/description/tags/SQL), Open in Notebook (with context restoration), and Delete.
- **Professional Query Form**: Syntax-highlighted SQL preview, form validation, error handling, and AI-assisted metadata generation.
- **Tree View Organization**: Queries grouped by collapsible tag groups; untagged queries displayed separately.

### Improved
- **Notebook Integration**: Saved queries now open directly in `.pgsql` notebooks with full connection metadata (connectionId, databaseName, schemaName) automatically restored.
- **Query Discovery**: Rich tooltips with creation/last-used dates, database name, connection name, and usage count on tree items.

---

## [0.8.1] - 2026-02-08

### Added
- **Connection Safety Features**: Environment tagging (🔴 PROD, 🟡 STAGING, 🟢 DEV), read-only mode enforcement, query safety analyzer with risk scoring, and status bar risk indicator.
- **Auto-LIMIT for SELECT**: Automatically appends LIMIT clause to SELECT queries (default 1000 rows, configurable).
- **EXPLAIN CodeLens**: One-click EXPLAIN/EXPLAIN ANALYZE buttons on SQL queries, results inserted directly into notebooks.
- **Table Intelligence**: New table operations for comprehensive insights:
    - **Profile**: Size breakdown, column statistics, and bloat metrics.
    - **Activity Monitor**: Access patterns, modifications, maintenance history, and bloat warnings.
    - **Index Usage**: Performance statistics with unused index detection.
    - **Definition Viewer**: Complete DDL, constraints, indexes, and relationships.

### Improved
- **Connection Form**: Enhanced with "Safety & Security" section for environment selection and read-only mode.
- **Notebook Integration**: EXPLAIN results now insert directly into notebooks for seamless workflow.

---

## [0.8.0] - 2026-02-08

### Added
- **AI Usage Metrics**: AI service responses now include token usage information, displayed in the UI for transparency and monitoring.
- **Comprehensive Test Suite**: Added extensive test utilities and unit tests for renderer components:
    - `TestDatabaseSetup`: Manages test database connections and schema setup.
    - `TestTimer` and `CoverageReporter`: Performance measurement and coverage reporting.
    - Unit tests for notebook cell rendering, dashboard components, form validation, and accessibility features.
- **EXPLAIN Plan Visualizer**: New `ExplainProvider` for visualizing EXPLAIN ANALYZE plans in an interactive webview.
- **Transaction Management**: Advanced transaction control system:
    - `TransactionToolbarManager`: Notebook toolbar for transaction controls.
    - Support for savepoints, isolation levels, and auto-rollback features.
    - Visual indicators for transaction status in notebooks.
- **Row Deletion**: Added support for deleting rows directly from the table renderer.

### Improved
- **Schema Cache**: Implemented adaptive TTL that optimizes cache behavior based on access patterns.
- **Connection Pool**: Added metrics and automatic idle timeout for better resource management.
- **Tree View Performance**: 
    - Debounced tree refresh to improve UI responsiveness during rapid operations.
    - Support for tree view virtualization to handle large schemas efficiently.
- **Chat Navigation**: Enhanced chat templates with breadcrumb navigation for improved database object selection.

### Changed
- **Edit Connection**: Added command to edit existing connection settings from the tree view.

---

## [0.7.9] - 2026-01-05

### Fixed
- **Changelog Loading**: Enhanced changelog loading to check multiple casing variants (CHANGELOG.md, changelog.md, Changelog.md) with detailed debug information.

---

## [0.7.7] - 2026-01-05

### Fixed
- **What's New Screen**: Fixed issues with the What's New welcome screen display and markdown rendering.

---

## [0.7.6] - 2026-01-05

### Added
- **What's New Welcome Screen**: A new immersive welcome page that automatically displays release notes upon extension update.
- **Manual Trigger**: New command `PgStudio: Show What's New` to view the changelog history at any time.
- **Rich Markdown Rendering**: The changelog viewer now supports full markdown rendering with syntax highlighting.

---

## [0.7.5] - 2026-01-05

### Architecture Refactoring (Phase 3 Complete)
- **Hybrid Connection Pooling**: Implemented a smart pooling strategy using `pg.Pool` for ephemeral operations and `pg.Client` for session-based tasks.
- **Service Layer**: Introduced a robust service layer architecture:
    - `QueryHistoryService`: Centralized management of query history with persistence.
    - `ErrorService`: Standardized error handling and reporting across the extension.
    - `SecretStorageService`: Secure management of credentials using VS Code's SecretStorage API.
- **Modular Codebase**: Split monolithic files (`extension.ts`, `renderer_v2.ts`) into focused modules (`commands/`, `providers/`, `services/`) for better maintainability.

### Added
- **SQL Parsing Engine**: Integrated a sophisticated SQL parser to enable advanced query analysis and safety checks.
- **Schema Caching**: Implemented intelligent caching for database schemas to improve autocomplete and tree view performance.

### Improved
- **Performance**: Enforced a **10k row limit** on backend results to prevent memory crashes on large queries.
- **Infinite Scrolling**: Frontend now handles large datasets using a virtualized list with intersection observers (200 rows/chunk).
- **Type Safety**: Removed `any` types from core services, enforcing strict TypeScript definitions.

---

## [0.7.1] - 2025-12-30

### Fixed
- **Connection Reliability**: Implemented smart SSL fallback logic. Connections with `sslmode=prefer` or `allow` now gracefully downgrade if SSL is not available, fixing connection issues on various server configurations.

---

## [0.7.0] - 2025-12-26

### Added
- **AI Request Cancellation**: Added the ability to cancel in-progress AI generation requests.
- **Streaming Responses**: AI responses now stream in real-time, providing immediate feedback during query generation.
- **Telemetry**: Introduced anonymous telemetry to track feature usage and improve extension stability.
- **Feature Badges**: Added visual badges to UI sections to highlight new capabilities.

### Improved
- **AI Context**: Enhanced the AI prompt engineering to include richer schema context and query history.

---

## [0.6.9] - 2025-12-14

### Changed
- **Packaging**: optimized the VSIX package to include all necessary `node_modules`, ensuring reliable offline installation.

---

## [0.6.8] - 2025-12-14

### Improved
- **Connection UI**: Redesigned the connection card with clearer status indicators, badges, and a simplified layout for better readability.

---

## [0.6.7] - 2025-12-14

### Security
- **Fix**: Resolved a potential insecure randomness vulnerability in the ID generation logic.

---

## [0.6.6] - 2025-12-14

### Added
- **FDW Documentation**: Added comprehensive in-editor documentation and feature lists for Foreign Data Wrappers.

---

## [0.6.5] - 2025-12-14
*(Includes updates from 0.6.1 - 0.6.4)*

### Added
- **Foreign Data Wrappers (FDW)**: Full support for managing FDWs:
    - **UI Management**: Create, edit, and drop Foreign Servers, User Mappings, and Foreign Tables.
    - **SQL Templates**: Pre-built templates for all FDW operations.
- **Interactive Documentation**: Replaced static screenshots in the documentation with an interactive video/GIF carousel.
- **Media Support**: Enhanced the media modal to support video playback alongside images.

---

## [0.6.0] - 2025-12-13

### Added
- **Native Charting**: Visualize query results instantly!
    - **Chart Types**: Bar, Line, Pie, Doughnut, and Scatter charts.
    - **Customization**: Extensive options for colors, axes, and legends.
    - **Tabbed Interface**: Seamlessly switch between Table view and Chart view.
- **AI Assistance**: Improved markdown rendering in notebooks, ensuring tables and code blocks from AI responses look perfect.

### Changed
- **Branding**: Renamed the output channel to `PgStudio` to match the new extension identity.

---

## [0.5.4] - 2025-12-13

### Rebranding
- **Project Renamed**: The extension is now **PgStudio**! (formerly "YAPE" / "PostgreSQL Explorer").
- Updated all documentation, UI references, and command titles to reflect the new professional identity.

### Added
- **Dashboard Visuals**: Added "glow" and "blur" effects to dashboard charts for a modern, premium aesthetic.

---

## [0.5.3] - 2025-12-07

### Fixed
- **Stability**: Fixed various reported linting errors and type issues across command files.

---

## [0.5.2] - 2025-12-06

### Changed
- **SQL Template Refactoring**: Extracted embedded SQL strings from TypeScript files into dedicated template modules (`src/commands/sql/`), improving code readability and separation of concerns.

---

## [0.5.1] - 2025-12-05

### Changed
- **Helper Abstractions**: Refactored command files to use standardized `getDatabaseConnection` and `NotebookBuilder` helpers, reducing code duplication.

---

## [0.5.0] - 2025-12-05

### Added
- **Enhanced Table Renderer**: New `renderer_v2.ts` with improved table output styling and performance.
- **Export Data**: Export query results to **CSV**, **JSON**, and **Excel** formats.
- **Column Operations**: Context menu for columns with Copy, Script, and Statistics options.
- **Constraint & Index Operations**: Full management UI for table constraints and indexes (Create, Drop, Analyze Usage).

### Fixed
- **Renderer Cache**: Fixed issues where table results would stale or fail to render on re-open.
- **Row Height**: Optimized table row height for better information density.

---

## [0.4.0] - 2025-12-03

### Added
- **Inline Create Buttons**: Added convenient "+" buttons to explorer nodes for quick object creation.
- **Script Generation**: Improved "Script as CREATE" accuracy for complex indexes.

---

## [0.3.0] - 2025-12-01

### Added
- **Test Coverage**: Added comprehensive unit tests for `NotebookKernel`.
- **Error Handling**: Improved reporting of serialization errors in query results.

### Changed
- **Dashboard UI**: Updated dashboard with pastel colors and modern styling.

---

## [0.2.3] - 2025-11-29

### Added
- **AI Assist CodeLens**: "✨ Ask AI" link added directly above notebook cells.
- **Multi-Provider AI**: Support for Google Gemini, OpenAI, and Anthropic models.
- **Pre-defined Tasks**: Quick actions for "Explain", "Fix Syntax", "Optimize".

---

## [0.2.2] - 2025-11-29

### Fixed
- **Critical Fix**: Corrected `package.json` entry point path pointing to `./dist/extension.js`, resolving "command not found" errors for new installations.

---

## [0.2.0] - 2025-11-29

### Added
- **Real-time Dashboard**: Live metrics monitoring for active queries and performance.
- **Active Query Management**: Ability to Cancel/Kill running queries.
- **PSQL Integration**: Integrated terminal support.
- **Backup & Restore**: UI-driven database backup/restore tools.

### Enhanced
- **Tree View**: Improved navigation and performance.
- **Connection Management**: Secured password storage and refactored connection logic.

---

## [0.1.x] - Previous versions

Earlier versions with basic PostgreSQL exploration, SQL notebooks, and data export features.
