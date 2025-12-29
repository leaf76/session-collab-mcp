# Session Collaboration MCP 設計文件

> 解決多個 Claude Code session 之間改動衝突的問題

## 問題陳述

在使用 parallel-dev workflow 或多個 Claude Code session 同時工作時，常發生：

- Session A 正在重構某段程式碼
- Session B 不知道 A 在處理，認為該段程式碼「有問題」就刪除或還原
- Session A 的工作成果消失

**根本原因**：Session 之間缺乏「改動意圖」的同步機制。

---

## 解決方案概述

建立一個 **Work-in-Progress (WIP) Registry**，讓所有 session 可以：

1. **宣告**：開始改動前，宣告要處理哪些檔案/符號及意圖
2. **查詢**：改動前檢查是否有其他 session 正在處理
3. **通知**：session 間可以留言溝通
4. **釋放**：完成或放棄時釋放宣告

```
┌─────────────────────────────────────────────────────────────┐
│                    session-collab-mcp                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Session A ──┐                                             │
│   Session B ──┼──► WIP Registry (SQLite WAL)                │
│   Session C ──┘         │                                   │
│                         ▼                                   │
│              Message Queue + Symbol Claims                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 架構設計

### 存儲位置

```
~/.claude/session-collab/
└── collab.db          # SQLite 主資料庫 (WAL mode)
```

**選擇 SQLite 的理由**：
- 輕量，無需額外服務
- 支援並發讀寫（WAL mode）
- 本地即可運作，符合單機多 session 情境

### 資料結構

```sql
-- Session 註冊表
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    project_root TEXT NOT NULL,
    machine_id TEXT,
    user_id TEXT,
    current_task TEXT,
    todos TEXT,                     -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP,
    status TEXT DEFAULT 'active'
);

-- Session 設定
CREATE TABLE session_config (
    session_id TEXT PRIMARY KEY,
    mode TEXT DEFAULT 'smart',      -- strict / smart / bypass
    stale_threshold_hours INTEGER DEFAULT 2,
    auto_release_stale INTEGER DEFAULT 0,
    allow_release_others INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- WIP 宣告
CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    files TEXT NOT NULL,            -- JSON array
    intent TEXT NOT NULL,
    scope TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_summary TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Symbol-level 宣告
CREATE TABLE symbol_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT DEFAULT 'function',  -- function/class/method/variable/block/other
    FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
);

-- Symbol 參照追蹤
CREATE TABLE symbol_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_symbol TEXT NOT NULL,
    ref_file TEXT NOT NULL,
    ref_line INTEGER NOT NULL,
    ref_context TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Session 間訊息
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT,
    content TEXT NOT NULL,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_session_id) REFERENCES sessions(id)
);

-- 決策記錄
CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    category TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

---

## 核心功能

### 1. Symbol-Level Claims

傳統 file-level claim 太粗糙，多個 session 無法同時修改同一檔案的不同函數。

**解法**：支援 symbol-level claim

```
Session A claims: validateToken() in auth.ts
Session B wants: refreshToken() in auth.ts
Result: No conflict! Different symbols in same file.
```

### 2. Conflict Handling Modes

透過 `collab_config` 設定衝突處理模式：

| Mode | 行為 |
|------|------|
| `strict` | 總是詢問使用者，不自動繞過 |
| `smart` (default) | 安全內容自動處理，衝突才詢問 |
| `bypass` | 忽略衝突（僅警告） |

### 3. LSP 整合

結合 Claude Code 的 LSP 工具：

1. `collab_validate_symbols`：驗證 symbol 名稱是否正確
2. `collab_analyze_symbols`：分析 symbol 衝突狀態
3. `collab_store_references`：儲存 symbol 參照資料
4. `collab_impact_analysis`：分析修改影響範圍

---

## MCP Tools 定義

### Session 管理

| Tool | 說明 |
|------|------|
| `collab_session_start` | 註冊新 session |
| `collab_session_end` | 結束 session |
| `collab_session_list` | 列出所有 session |
| `collab_session_heartbeat` | 更新心跳 |
| `collab_status_update` | 更新工作狀態 |
| `collab_config` | 設定衝突處理模式 |

### Claim 管理

| Tool | 說明 |
|------|------|
| `collab_claim` | 宣告檔案/symbol |
| `collab_check` | 檢查衝突 |
| `collab_release` | 釋放宣告 |
| `collab_claims_list` | 列出所有宣告 |

### LSP 整合

| Tool | 說明 |
|------|------|
| `collab_analyze_symbols` | 分析 LSP symbol 衝突 |
| `collab_validate_symbols` | 驗證 symbol 名稱 |
| `collab_store_references` | 儲存參照資料 |
| `collab_impact_analysis` | 分析修改影響 |

### 通訊

| Tool | 說明 |
|------|------|
| `collab_message_send` | 發送訊息 |
| `collab_message_list` | 讀取訊息 |
| `collab_decision_add` | 記錄決策 |
| `collab_decision_list` | 列出決策 |

---

## 使用流程

### 情境 1：正常工作流程

```
Session A 開始工作：
1. collab_session_start → 獲得 session_id
2. collab_claims_list → 看看有沒有其他人在做什麼
3. collab_claim(files: [...], intent: "重構登入") → 宣告
4. ... 開始工作 ...
5. collab_release(status: "completed") → 釋放
```

### 情境 2：Symbol-Level Claim

```
Session A 只修改特定函數：
1. collab_claim(
     symbols: [{ file: "auth.ts", symbols: ["validateToken"] }],
     intent: "重構 token 驗證"
   )
2. Session B 想修改同檔案的 refreshToken
3. collab_check → 無衝突，可以進行
```

### 情境 3：Impact Analysis

```
修改常用函數前：
1. collab_impact_analysis(file: "utils.ts", symbol: "formatDate")
   → risk_level: "high", reference_count: 15
2. 決定是否要先通知其他 session
```

---

## 技術實作

### Transport

使用 **stdio**，因為：
- 本地單機使用
- 每個 Claude Code session 獨立啟動 MCP server
- 透過 SQLite WAL 共享狀態

### 專案結構

```
session-collab-mcp/
├── bin/                    # Executable entry point
├── migrations/             # SQLite migrations
│   ├── 0001_init.sql
│   ├── 0002_auth.sql
│   ├── 0003_config.sql
│   ├── 0004_symbols.sql
│   └── 0005_references.sql
├── src/
│   ├── cli.ts              # Entry point
│   ├── constants.ts        # Version, instructions
│   ├── db/
│   │   ├── queries.ts      # SQL queries
│   │   ├── sqlite-adapter.ts
│   │   └── types.ts
│   ├── mcp/
│   │   ├── protocol.ts     # JSON-RPC
│   │   ├── server.ts       # MCP server
│   │   └── tools/
│   │       ├── session.ts
│   │       ├── claim.ts
│   │       ├── message.ts
│   │       ├── decision.ts
│   │       └── lsp.ts
│   └── utils/
└── package.json
```

### 依賴

```json
{
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "tsx": "^4.19.2",
    "zod": "^3.24.1"
  }
}
```

純 JSON-RPC 實作，不依賴 `@modelcontextprotocol/sdk`。

---

## 錯誤處理

| 錯誤碼 | 說明 | 建議動作 |
|--------|------|----------|
| SESSION_NOT_FOUND | Session ID 不存在 | 重新 `collab_session_start` |
| SESSION_INACTIVE | Session 已過期 | 重新 `collab_session_start` |
| CLAIM_NOT_FOUND | Claim ID 不存在 | 檢查是否已被釋放 |
| CLAIM_CONFLICT | 檔案/symbol 已被其他 session 宣告 | 顯示衝突詳情 |
| DB_ERROR | 資料庫錯誤 | 檢查 ~/.claude/session-collab/ 權限 |

---

## 版本歷史

### v0.5.0

- 新增 Reference tracking 和 Impact analysis
- 新增 Symbol-level claims
- 新增 LSP 整合工具
- 新增 `collab_config` 衝突處理模式
- 修正 SQLite WAL 多程序同步問題

### v0.4.0

- 從 Cloudflare Workers 遷移至本地 npm 套件
- 改用 better-sqlite3
