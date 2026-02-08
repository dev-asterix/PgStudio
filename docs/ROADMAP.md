# PgStudio Improvement Roadmap

> Last Updated: December 2025

---

## ✅ Phase 1: Connection Management UX (COMPLETE)

- [x] SSL mode dropdown (disable, allow, prefer, require, verify-ca, verify-full)
- [x] SSL certificate paths (CA, client cert, client key)
- [x] Connection timeout setting
- [x] Statement timeout setting
- [x] Application name (shown in `pg_stat_activity`)
- [x] Raw options field (`-c search_path=myschema`)

---

## 🎯 Phase 2: UX Enhancements

### 2A: Tree View Improvements ✅ COMPLETE
- [x] Quick filter input for searching objects (toggle icon, schema filtering)
- [x] Favorites (star frequently-used tables/views)  
- [x] ⭐ Favorites section under connection
- [x] Context menu preserved for favorited items
- [x] 🕒 Recent items tracking (max 10 items)
- [x] Object count badges on category nodes (right-aligned, muted)

### 2B: Notebook Experience ✅ COMPLETE
- [x] Sticky headers (already implemented)
- [x] Query cancellation backend infrastructure
- [x] Column resizing  
- [x] Infinite scrolling (200 rows/chunk with IntersectionObserver)
- [x] Result truncation (10k row limit to prevent crashes)
- [x] Stop generation button UI (integrated with chat)

### 2C: AI Assistant ✅ COMPLETE
- [x] Schema context caching
- [x] Query history in AI context
- [x] "Explain this error" feature
- [x] Data Analysis (with file attachment)
- [x] Query optimization & suggest indexes
- [x] "Send results to Chat" integration

---

## 🏗️ Phase 3: Architecture Refactoring ✅ COMPLETE

### Code Organization
- [x] Split `extension.ts` → `commands/`, `providers/`, `services/`
- [x] Split `renderer_v2.ts` into modular components (`renderer/components/`, `renderer/features/`)
- [x] Split `tables.ts` (51KB) → `operations.ts`, `scripts.ts`, `maintenance.ts`

### Service Layer ✅ COMPLETE
- [x] Hybrid connection pooling (`pg.Pool` for ephemeral, `pg.Client` for sessions)
- [x] Command pattern for CRUD operations
- [x] Query history service
- [x] Centralized error handling (`ErrorService`)
- [x] Strict typing (removed `any` from core services)
- [x] Legacy code removal (`getConnection` deprecated)

### Performance Optimizations ✅ COMPLETE
- [x] Backend result truncation (10k row limit)
- [x] Frontend infinite scrolling (200 rows/chunk)
- [x] Connection leak prevention (try/finally patterns)
- [x] Query result streaming (cursor-based batching)
- [x] Distributed tracing (TelemetryService)

---

## 📚 Phase 4: Documentation ✅ COMPLETE

- [x] `ARCHITECTURE.md` with system diagrams
- [x] `CONTRIBUTING.md` with code style guide
- [x] Troubleshooting section in README
- [x] Feature comparison vs pgAdmin/DBeaver/TablePlus

---

## 🛡️ Phase 5: Safety & Confidence ✅ COMPLETE

### Safety & Trust ✅ COMPLETE
- [x] **Prod-aware write query confirmation**
  - Implementation: QueryAnalyzer service detects dangerous operations (DROP, TRUNCATE, DELETE/UPDATE without WHERE, ALTER, INSERT, CREATE) with risk scoring based on environment. Shows modal warnings with "Execute", "Execute in Transaction", or Cancel options.
- [x] **Read-only / Safe mode per connection**
  - Implementation: `readOnlyMode` boolean field enforces `SET default_transaction_read_only = ON` on connection. Blocks all write operations at query execution level.
- [x] **Missing `WHERE` / large-table warnings**
  - Implementation: QueryAnalyzer uses regex detection to identify DELETE/UPDATE without WHERE clause. Flagged as critical/high severity with confirmation required on production.

### Context & Navigation ✅ COMPLETE
- [x] **Actionable breadcrumbs (click to switch)**
- [x] **Status-bar risk indicator**
  - Implementation: Third status bar item shows color-coded environment badges (🔴 PROD, 🟡 STAGING, 🟢 DEV, 🔒 READ-ONLY) with appropriate background colors. Clickable to show connection safety details.
- [x] **Reveal current object in explorer**
  - Implementation: `revealItem()` method in DatabaseTreeProvider with `revealInExplorer` command. Uses VS Code Tree View API to focus and expand tree items.

---

## 🧠 Phase 6: Data Intelligence & Productivity

### Query Productivity
- [ ] **Query history with rerun & diff**
- [ ] **Auto `LIMIT` / sampling for SELECT**
  - Implementation: Automatically append `LIMIT 100` if not present when in browsing mode.
- [ ] **One-click `EXPLAIN` / `EXPLAIN ANALYZE`**
  - Implementation: CodeLens or button to wrap current query in `EXPLAIN ANALYZE` and visualize output.

### Table Intelligence
- [ ] **Table profile**
  - Implementation: Fetch row count, approximate size, null %, distinction stats.
- [ ] **Quick stats & recent activity**
  - Implementation: Show recent tuples inserted/updated/deleted from `pg_stat_user_tables`.
- [ ] **Open definition / indexes / constraints**
  - Implementation: Quick view for DDL, indexes list, and foreign key constraints.

---

## ⚡ Phase 7: Advanced Power User & AI

### AI Upgrades
- [x] **Inject schema + breadcrumb into AI context**
- [ ] **“Explain this result” / “Why slow?”**
  - Implementation: Feed query execution plan or result summary to AI for analysis.
- [ ] **Safer AI suggestions on prod connections**
  - Implementation: Prompt engineering to warn AI about production contexts.

### Power-User Extras
- [ ] **Connection profiles**
  - Implementation: Profiles for "Read-Only Analyst", "DB Admin", etc., with preset safety settings.
- [ ] **Saved queries**
  - Implementation: VS Code level storage for snippet library, distinct from DB views.
- [ ] **Lightweight schema diff**
  - Implementation: Compare structure of two schemas/DBs and generate diff script.

---

## ❌ Intentionally Not Now

- [ ] Visual query builder
- [ ] ER diagrams
- [ ] Full plan visualizers
- [ ] Cloud sync / accounts

---

### Guiding rule (tattoo this mentally):

> **Reduce fear. Increase speed. Everything else waits.**
