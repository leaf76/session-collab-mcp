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

1. **宣告**：開始改動前，宣告要處理哪些檔案及意圖
2. **查詢**：改動前檢查是否有其他 session 正在處理
3. **通知**：session 間可以留言溝通
4. **釋放**：完成或放棄時釋放宣告

```
┌─────────────────────────────────────────────────────────────┐
│                    session-collab-mcp                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Session A ──┐                                             │
│   Session B ──┼──► WIP Registry (SQLite) ◄── File Watcher   │
│   Session C ──┘         │                                   │
│                         ▼                                   │
│                   Message Queue                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 架構設計

### 存儲位置

```
~/.config/session-collab-mcp/
├── registry.db          # SQLite 主資料庫
├── config.json          # 設定檔
└── logs/
    └── collab.log       # 操作日誌
```

**選擇 SQLite 的理由**：
- 輕量，無需額外服務
- 支援並發讀寫（WAL mode）
- 本地即可運作，符合單機多 session 情境

### 資料結構

```sql
-- Session 註冊表
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- UUID
    name TEXT,                      -- 用戶自訂名稱，如 "frontend-work"
    project_root TEXT NOT NULL,     -- 專案路徑
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP,       -- 用於檢測 session 是否還活著
    status TEXT DEFAULT 'active'    -- active / inactive / terminated
);

-- WIP 宣告
CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    files TEXT NOT NULL,            -- JSON array of file paths
    intent TEXT NOT NULL,           -- 改動意圖描述
    scope TEXT DEFAULT 'medium',    -- small / medium / large
    status TEXT DEFAULT 'active',   -- active / completed / abandoned
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_summary TEXT,         -- 完成時的摘要
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Session 間訊息
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT,             -- NULL = broadcast to all
    content TEXT NOT NULL,
    read_at TIMESTAMP,              -- NULL = unread
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_session_id) REFERENCES sessions(id)
);

-- 決策記錄（可選，用於長期記憶）
CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    category TEXT,                  -- architecture / naming / api / etc
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

---

## MCP Tools 定義

### 1. Session 管理

#### `collab_session_start`

註冊新的 session，獲取 session ID。

```typescript
{
  name: "collab_session_start",
  description: "註冊一個新的協作 session。應在開始工作前呼叫。",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Session 名稱，如 'frontend-refactor'"
      },
      project_root: {
        type: "string",
        description: "專案根目錄路徑"
      }
    },
    required: ["project_root"]
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false
  }
}

// Response
{
  session_id: "abc-123",
  name: "frontend-refactor",
  message: "Session 已註冊。目前有 2 個活躍 session。"
}
```

#### `collab_session_end`

結束 session，釋放所有宣告。

```typescript
{
  name: "collab_session_end",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      release_claims: {
        type: "string",
        enum: ["complete", "abandon"],
        description: "如何處理未釋放的 claims"
      }
    },
    required: ["session_id"]
  }
}
```

#### `collab_session_list`

列出所有活躍的 session。

```typescript
{
  name: "collab_session_list",
  inputSchema: {
    type: "object",
    properties: {
      include_inactive: { type: "boolean", default: false }
    }
  },
  annotations: { readOnlyHint: true }
}

// Response
{
  sessions: [
    {
      id: "abc-123",
      name: "frontend-refactor",
      status: "active",
      active_claims: 2,
      last_heartbeat: "2025-12-29T10:30:00Z"
    }
  ]
}
```

---

### 2. WIP 宣告管理

#### `collab_claim`

宣告即將處理的檔案範圍。

```typescript
{
  name: "collab_claim",
  description: "宣告要處理的檔案。其他 session 在修改這些檔案前會看到警告。",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      files: {
        type: "array",
        items: { type: "string" },
        description: "檔案路徑列表，支援 glob pattern 如 'src/api/*'"
      },
      intent: {
        type: "string",
        description: "改動意圖，讓其他 session 理解你在做什麼"
      },
      scope: {
        type: "string",
        enum: ["small", "medium", "large"],
        default: "medium",
        description: "預估改動範圍：small(<30min), medium(30min-2hr), large(>2hr)"
      }
    },
    required: ["session_id", "files", "intent"]
  }
}

// Response
{
  claim_id: "claim-456",
  status: "created",
  conflicts: []  // 或顯示衝突
}

// 如果有衝突
{
  claim_id: "claim-456",
  status: "created_with_conflicts",
  conflicts: [
    {
      claim_id: "claim-123",
      session: "backend-work",
      files: ["src/api/auth.py"],
      intent: "重構登入邏輯",
      overlap: ["src/api/auth.py"]
    }
  ],
  warning: "⚠️ 有 1 個檔案與其他 session 重疊，請協調"
}
```

#### `collab_check`

檢查檔案是否有其他 session 正在處理（建議在刪除/大改前呼叫）。

```typescript
{
  name: "collab_check",
  description: "檢查指定檔案是否有其他 session 正在處理。建議在刪除或大幅修改前呼叫。",
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["files"]
  },
  annotations: { readOnlyHint: true }
}

// Response - 無衝突
{
  safe: true,
  message: "這些檔案目前沒有其他 session 在處理"
}

// Response - 有衝突
{
  safe: false,
  conflicts: [
    {
      file: "src/api/auth.py",
      session: "frontend-refactor",
      session_id: "abc-123",
      intent: "重構登入邏輯，改用 JWT",
      scope: "medium",
      started_at: "2025-12-29T09:00:00Z"
    }
  ],
  warning: "⚠️ src/api/auth.py 正由 'frontend-refactor' 處理中（意圖：重構登入邏輯，改用 JWT）。建議先協調再修改。"
}
```

#### `collab_release`

釋放 WIP 宣告。

```typescript
{
  name: "collab_release",
  inputSchema: {
    type: "object",
    properties: {
      claim_id: { type: "string" },
      status: {
        type: "string",
        enum: ["completed", "abandoned"]
      },
      summary: {
        type: "string",
        description: "完成時的摘要，供其他 session 參考"
      }
    },
    required: ["claim_id", "status"]
  }
}
```

#### `collab_claims_list`

列出所有 WIP 宣告。

```typescript
{
  name: "collab_claims_list",
  inputSchema: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "篩選特定 session，不填則列出全部"
      },
      status: {
        type: "string",
        enum: ["active", "completed", "abandoned", "all"],
        default: "active"
      },
      path_filter: {
        type: "string",
        description: "篩選路徑 pattern，如 'src/api/*'"
      }
    }
  },
  annotations: { readOnlyHint: true }
}
```

---

### 3. Session 間通訊

#### `collab_message_send`

發送訊息給其他 session。

```typescript
{
  name: "collab_message_send",
  inputSchema: {
    type: "object",
    properties: {
      from_session_id: { type: "string" },
      to_session_id: {
        type: "string",
        description: "目標 session ID，不填則廣播給所有 session"
      },
      content: { type: "string" }
    },
    required: ["from_session_id", "content"]
  }
}
```

#### `collab_message_list`

讀取訊息。

```typescript
{
  name: "collab_message_list",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      unread_only: { type: "boolean", default: true },
      mark_as_read: { type: "boolean", default: true }
    },
    required: ["session_id"]
  },
  annotations: { readOnlyHint: false }  // 因為會 mark as read
}
```

---

### 4. 決策記錄（可選）

#### `collab_decision_add`

記錄架構/設計決策。

```typescript
{
  name: "collab_decision_add",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      category: {
        type: "string",
        enum: ["architecture", "naming", "api", "database", "ui", "other"]
      },
      title: { type: "string" },
      description: { type: "string" }
    },
    required: ["session_id", "title", "description"]
  }
}
```

#### `collab_decision_list`

列出決策記錄。

```typescript
{
  name: "collab_decision_list",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      limit: { type: "number", default: 20 }
    }
  },
  annotations: { readOnlyHint: true }
}
```

---

## 使用流程

### 情境 1：正常工作流程

```
Session A 開始工作：
1. collab_session_start → 獲得 session_id
2. collab_claims_list → 看看有沒有其他人在做什麼
3. collab_claim(files: ["src/api/auth.py"], intent: "重構登入") → 宣告
4. ... 開始工作 ...
5. collab_release(status: "completed", summary: "已改用 JWT") → 釋放
```

### 情境 2：避免衝突

```
Session B 想刪除某段程式碼：
1. collab_check(files: ["src/api/auth.py"])
   → ⚠️ Session A 正在處理，意圖：重構登入
2. 決定：
   a. 等 A 完成
   b. 發訊息給 A 討論
   c. 確認後仍要覆蓋（使用者決定）
```

### 情境 3：Session 間溝通

```
Session B 發現問題：
1. collab_message_send(to: "session_A", content: "auth.py 第 50 行有 bug，你重構時順便修一下？")

Session A 收到：
1. collab_message_list → 看到 B 的訊息
2. 處理後回覆
```

---

## Claude Code 整合建議

### 自動行為

在 Claude Code 的 system prompt 或 CLAUDE.md 中加入：

```markdown
## Session 協作規範

1. **Session 開始時**：自動呼叫 `collab_session_start`
2. **修改檔案前**：呼叫 `collab_claim` 宣告意圖
3. **刪除/大幅重寫前**：必須先 `collab_check`
   - 如有衝突，詢問使用者是否繼續
4. **工作完成時**：`collab_release` 釋放宣告
5. **定期檢查**：`collab_message_list` 看有無新訊息
```

### Heartbeat 機制

Session 應定期（如每 5 分鐘）更新 heartbeat，讓系統知道 session 還活著。
超過 30 分鐘沒有 heartbeat 的 session 可標記為 inactive。

```typescript
collab_session_heartbeat({ session_id: "abc-123" })
```

---

## 技術實作筆記

### Transport

使用 **stdio**，因為：
- 本地單機使用
- 每個 Claude Code session 獨立啟動 MCP server
- 透過 SQLite 共享狀態（而非透過 MCP server 本身）

### 專案結構

```
session-collab-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── db/
│   │   ├── schema.ts     # Drizzle or raw SQL schema
│   │   └── client.ts     # SQLite connection (WAL mode)
│   ├── tools/
│   │   ├── session.ts    # session_* tools
│   │   ├── claim.ts      # claim_* tools
│   │   ├── message.ts    # message_* tools
│   │   └── decision.ts   # decision_* tools
│   └── utils/
│       ├── glob.ts       # File pattern matching
│       └── conflict.ts   # Conflict detection logic
└── README.md
```

### 依賴

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0",
    "minimatch": "^10.0.0",
    "uuid": "^10.0.0"
  }
}
```

---

## 未來擴展

1. **Git 整合**：自動從 git diff 偵測正在修改的檔案
2. **VS Code 通知**：透過 extension 顯示衝突警告
3. **Web Dashboard**：視覺化顯示所有 session 狀態
4. **自動 claim**：根據 file watcher 自動宣告正在編輯的檔案

---

## 附錄：錯誤處理

| 錯誤碼 | 說明 | 建議動作 |
|--------|------|----------|
| SESSION_NOT_FOUND | Session ID 不存在 | 重新 `collab_session_start` |
| SESSION_INACTIVE | Session 已過期 | 重新 `collab_session_start` |
| CLAIM_NOT_FOUND | Claim ID 不存在 | 檢查是否已被釋放 |
| CLAIM_CONFLICT | 檔案已被其他 session 宣告 | 顯示衝突詳情，讓使用者決定 |
| DB_ERROR | 資料庫錯誤 | 檢查 ~/.config/session-collab-mcp/ 權限 |
