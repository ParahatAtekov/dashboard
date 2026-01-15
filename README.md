* **Project idea**

  * **Internal SaaS dashboard** for a **HyperLiquid-based DeFi platform**
  * Purpose:

    * Track **user / wallet activity**
    * Compute **reliable metrics** (DAU, volumes, rankings, retention)
    * Support **10k+ wallets** with **auditability and correctness**
  * Core principle:

    * **Numbers must be correct, rebuildable, and explainable**
    * **UI is presentation only**
    * **Backend is the single source of truth**

---

* **High-level architecture**

  * **Workers → Database → Backend → UI**
  * **Unidirectional data flow**
  * **No side effects downstream**

---

* **Dataflow idea (conceptual)**

  * **Workers**

    * Pull raw data from **HyperLiquid Info endpoint**
    * Handle **rate limits**, retries, overlap windows
    * Insert **immutable raw facts**
  * **Database**

    * Stores **truth** (append-only)
    * Stores **derived state** (aggregates, cursors, jobs)
    * Enforces **correctness via constraints**
  * **Backend**

    * Reads **precomputed metrics only**
    * Exposes **read-only, cacheable APIs**
  * **UI**

    * Fetches numbers
    * Renders charts/tables
    * No business logic, no DB access

---

* **Core technical assumptions (DB)**

  * **Append-only raw data**

    * Table: **`hl_fills_raw`**
    * No updates, no deletes
    * Reason:

      * Auditability
      * Backfills
      * Deterministic recomputation

  * **Idempotency at DB level**

    * **Unique constraints** on raw events
    * Overlap windows allowed safely
    * Retries never corrupt data

  * **Time-based partitioning**

    * Monthly partitions on raw fills
    * Reason:

      * Millions of rows/day
      * Predictable query performance
      * Cheap retention management

  * **Derived aggregates**

    * `wallet_day_metrics`
    * `global_day_metrics`
    * Fully **rebuildable** from raw data
    * Never increment blindly

  * **State tables**

    * **`hl_ingest_cursor`**: ingestion progress per wallet
    * **`jobs`**: execution, retries, backoff, leasing

  * **Multi-tenant structurally**

    * Tables include `org_id`
    * Single-tenant operationally today
    * Zero-cost future SaaS expansion

  * **DB-enforced security**

    * **RLS** for per-user, per-org isolation
    * Backend uses **service role**
    * UI cannot write or leak data

---

* **Core technical assumptions (backend)**

  * **Single authority**

    * Backend is the only system that:

      * Talks to DB
      * Talks to HL
      * Runs computations

  * **Strict layering**

    * **Controller**: HTTP only
    * **Service**: orchestration
    * **Repository**: SQL only

  * **Read-only API**

    * `GET` only
    * No writes from UI
    * Cacheable responses

  * **Auth model**

    * Supabase JWT
    * User → org → role resolution
    * RBAC enforced before data access

  * **No ORM**

    * Explicit SQL
    * Predictable performance
    * Clear ownership of queries

---

* **Core technical assumptions (workers)**

  * **Job-driven execution**

    * No “loop all wallets”
    * Work claimed via DB leases

  * **Rate-limit aware**

    * Global token bucket
    * Bounded concurrency
    * Adaptive scheduling (hot / cold wallets)

  * **Cursor + overlap ingestion**

    * Always re-fetch recent window
    * DB dedupe guarantees correctness

  * **Chained jobs**

    * `ingest_wallet`
    * → `rollup_wallet_day`
    * → `rollup_global_day`

  * **Crash-safe**

    * Leases expire
    * Jobs retry with backoff
    * No stuck state

---

* **Core technical assumptions (data correctness)**

  * **No trust in upstream guarantees**

    * Late fills possible
    * Out-of-order data possible
  * **Correctness strategy**

    * Overlap + dedupe
    * Recompute from raw truth
  * **If metrics are wrong**

    * Drop aggregates
    * Rebuild from raw data

---

* **Core technical assumptions (scalability)**

  * **HL limits are real**

    * Cannot poll all wallets uniformly
  * **Design response**

    * Adaptive scheduling
    * Prioritize active wallets
    * Accept eventual consistency
  * **DB scale**

    * Postgres + partitioning handles tens of millions/day
  * **API scale**

    * CDN + cache headers
    * Precomputed metrics only

---

* **Non-goals (explicit)**

  * No real-time trading UI
  * No client-side computation
  * No frontend → DB access
  * No “best-effort” metrics

---

* **Mental model**

  * **Raw data = facts**
  * **Aggregates = views**
  * **Backend = accountant**
  * **UI = window**
