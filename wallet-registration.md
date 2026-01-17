```

---

## Summary of All Files

| File | Status | Layer | Description |
|------|--------|-------|-------------|
| `src/repositories/wallets.repo.ts` | **NEW** | Repository | Wallet table SQL |
| `src/repositories/orgWallets.repo.ts` | **NEW** | Repository | Org-wallet link SQL |
| `src/repositories/cursor.repo.ts` | **NEW** | Repository | Cursor SQL |
| `src/repositories/jobs.repo.ts` | **NEW** | Repository | Jobs SQL |
| `src/repositories/index.ts` | **NEW** | Repository | Exports |
| `src/services/wallets.registration.service.ts` | **NEW** | Service | Business logic |
| `src/api/v1/wallets.registration.controller.ts` | **NEW** | Controller | HTTP handling |
| `src/api/v1/index.ts` | **MODIFY** | Controller | Add routes |
| `src/workers/queue/enqueue.ts` | **MODIFY** | Worker | Use repo |
| `src/workers/queue/runtime.ts` | **MODIFY** | Worker | Use repo |
| `src/workers/scheduler/walletScheduler.ts` | **MODIFY** | Worker | Use repo |

---

## Layer Rules Summary
```
┌─────────────────────────────────────────────────────────────┐
│                      LAYER RULES                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Controller (HTTP)                                          │
│  ├── CAN import: services                                   │
│  ├── CANNOT import: repositories, pool                      │
│  └── Responsibility: Request parsing, response formatting   │
│                                                             │
│  Service (Business Logic)                                   │
│  ├── CAN import: repositories, other services               │
│  ├── CANNOT import: pool directly (use repos)               │
│  └── Responsibility: Orchestration, validation, transactions│
│                                                             │
│  Repository (Data Access)                                   │
│  ├── CAN import: pool                                       │
│  ├── CANNOT import: services                                │
│  └── Responsibility: SQL queries, data mapping              │
│                                                             │
└─────────────────────────────────────────────────────────────┘