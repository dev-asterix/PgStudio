# PgStudio Gap Analysis & Technical Review

> **Date:** February 2026
> **Scope:** Full Codebase Review (v0.8.2)

## 1. Security & Stability (CRITICAL)

### 🚨 SQL Injection Risks in Generic Handlers
**Location:** `src/providers/NotebookKernel.ts` (handleSaveChanges, handleDeleteRows)
**Issue:**
The current implementation of `handleSaveChanges` and `handleDeleteRows` constructs SQL queries using string interpolation for values in some cases, rather than consistently using parameterized queries.
- `handleSaveChanges` manually escapes strings (`replace(/'/g, "''")`) and injects them into the query string.
- This is error-prone and a classic SQL injection vector if the manual escaping is bypassed or flawed.
**Recommendation:** Refactor to use parameterized queries (`$1`, `$2`, etc.) for ALL value inputs in `UPDATE` and `DELETE` operations.

### ⚠️ Missing Transaction Safety for Batch Operations
**Location:** `src/providers/NotebookKernel.ts`
**Issue:**
Batch updates and deletes are executed sequentially. If one fails, previous successes are committed (unless auto-commit is off, but that's connection-dependent).
**Recommendation:** Wrap all batch operations (e.g., "Save Changes" for 50 rows) in an explicit `BEGIN ... COMMIT/ROLLBACK` block to ensure atomicity.

## 2. Architecture & Patterns

### 📉 Missing "Why Slow?" Persistence
**Location:** `src/services/QueryAnalyzer.ts`, `src/services/QueryHistoryService.ts`
**Issue:**
The `QueryAnalyzer` has logic to compare against a baseline (`analyzePerformanceAgainstBaseline`), but there is no persistence layer to store these baselines across sessions.
- `QueryHistoryService` stores strictly chronological history, not aggregated performance stats per query hash.
**Gap:** The "Why is this slow?" feature cannot track performance degradation over time without a persistent baseline store.

### 🍝 Message Handling Bloat
**Location:** `src/extension.ts` (activate function), `src/providers/NotebookKernel.ts` (handleMessage)
**Issue:**
The `activate` function in `extension.ts` contains a massive `rendererMessaging.onDidReceiveMessage` block with mixed responsibilities (UI logic, database calls, error handling).
- Similarly, `NotebookKernel.ts` has a growing `handleMessage` switch statement.
**Recommendation:** Refactor into a `MessageHandler` registry or Command Pattern to decouple message routing from the entry points.

## 3. Product Features (Missing vs Market)

### 📊 Visualizations
- **Gap:** No "Explain Plan" visualizer. Currently shows JSON or text.
- **Goal:** Implement a React-based flowchart or tree visualizer for `EXPLAIN (FORMAT JSON)` results.

### 🤖 AI Capabilities
- **Gap:** Context window management is basic. Large schemas will truncate or overflow.
- **Goal:** Implement RAG (Retrieval-Augmented Generation) or smarter schema pruning to fit relevant table definitions into context.

## 4. Testing & QA

### 🧪 Test Coverage
- **Unit Tests:** Exist for `ConnectionManager`, `QueryAnalyzer`, etc.
- **Integration Tests:** Basic connection tests exist.
- **Gap:** No end-to-end (E2E) tests for the UI (Playwright/Selenium) to verify the Notebook -> Renderer interaction.

## 5. Roadmap Updates (Draft)
Based on this analysis, the following items should be added to the roadmap:

- **[P0] Security:** Parameterize all usage of `handleSaveChanges` / `execute_update`.
- **[P1] Architecture:** Extract `MessageHandler` pattern.
- **[P1] Feature:** Implement `QueryPerformanceService` for persistent baselines.
- **[P2] UX:** Visual Explain Plan.
