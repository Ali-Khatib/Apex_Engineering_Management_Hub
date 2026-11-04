# GitHub webhook ingestion: queue, workers and delivery guarantees

Date: 4 November 2026
Status: **specification. Nothing here is built.**

Read that line literally. This repository is a React + Vite frontend with a
`localStorage`-backed store. It has no backend, no database, no queue and no
worker, so there is nothing running to receive a webhook. This document is the
architecture and the backend changes the work would need, written after an
audit of what exists. It is not production-ready, because it is not deployed,
and no failure or recovery scenario in §7 has been exercised.

---

## 1. The audit the brief asks for first

> *"First inspect the existing backend, webhook implementation, deployment
> setup and dependencies. Determine whether Redis or an existing queue
> mechanism is already present. Reuse what is suitable rather than introducing
> duplicate infrastructure."*

| Question | Answer |
|---|---|
| Existing backend in this repository | None |
| Existing backend in apex-erp-mvp | FastAPI, 13 files, 1,095 lines |
| Existing webhook implementation | `apex-erp/backend/app/api.py:388` → `github.py:process_event` |
| Existing queue | **None in either project** |
| Existing Redis | **None in either project.** `events.py` carries the comment *"Swap for Redis pub/sub when running >1 worker"*, which is intent, not infrastructure |
| Deployment | apex-erp-mvp: Docker Compose with `app` and `db` (Postgres 16). No cache, no broker, no worker service |

So Redis is new infrastructure, not duplicate infrastructure. Introducing it is
justified by a defect that exists today, set out next, not by preference.

### 1.1 What is wrong with the current path

Taking `apex-erp-mvp` as the baseline, since this repository has nothing:

1. **Processing runs inside the request.** The handler verifies the signature,
   parses, writes rows, sends notifications and commits before it responds. A
   burst of deliveries goes straight at Postgres, and GitHub's 10-second
   delivery timeout is held open for the duration.
2. **Duplicate protection is advisory.** `GitHubEvent.delivery_id` is indexed
   but **not unique** (`models.py:122`). The check is a `SELECT` followed by an
   `INSERT`, so two concurrent deliveries of one ID both pass.
3. **Push deliveries are only partly covered.** `delivery_id` is written to the
   first commit row of a push and `None` for the rest
   (`github.py:48`), so a redelivered push is not reliably caught.
4. **There is no acknowledgement contract.** Every outcome returns 200,
   including *"ignored: unknown repository"*. There is no 202 and no 503, so
   GitHub's redelivery mechanism can never be asked to help.
5. **A failure after the response is lost.** Nothing retries, nothing is parked.

---

## 2. Architecture

```
GitHub ──▶ POST /api/github/webhook
             │
             │  1. read raw body (never the parsed form)
             │  2. verify X-Hub-Signature-256  ──────────── 401 on mismatch
             │  3. check required headers       ──────────── 400 if absent
             │  4. claim X-GitHub-Delivery in Redis ─────── 200 if already claimed
             │  5. validate + normalise payload  ────────── 400 malformed / 200 unsupported
             │  6. XADD to the stream, fsync-backed ─────── 503 if Redis will not take it
             │
             └──▶ 202 Accepted ── only after step 6 returns

 Redis Stream  webhooks:events   (consumer group: processors)
             │
   worker 1 ─┤  XREADGROUP → handle → write to Postgres → XACK
   worker 2 ─┤  failure → XCLAIM after visibility timeout → retry with backoff
   worker n ─┘  retries exhausted → XADD webhooks:dead → XACK
```

Two Redis keyspaces, with different jobs:

| Key | Type | Purpose | Retention |
|---|---|---|---|
| `webhooks:events` | Stream | the work queue | `MAXLEN ~ 100000`, trimmed after acknowledgement |
| `webhooks:dead` | Stream | events that exhausted their retries | 30 days, never auto-trimmed |
| `webhooks:delivery:{id}` | String | idempotency claim | `SETNX` with a 7-day TTL, matching GitHub's redelivery window |

A Stream rather than a List, because a consumer group gives at-least-once
delivery with per-message acknowledgement and a pending-entries list that
survives a worker dying mid-message. `LPUSH`/`BRPOP` loses an in-flight message
when the worker crashes between pop and commit.

---

## 3. Acknowledgement contract

This is the part that must not be got wrong: **never acknowledge before the
event is durably in the queue.** A 202 tells GitHub the delivery succeeded, and
GitHub will not send it again.

| Situation | Response | Why |
|---|---|---|
| Valid event, enqueued | **202 Accepted** | Received and durable, processing has not happened yet |
| Delivery ID already claimed | **200 OK** | Safe duplicate, nothing to do |
| Signature invalid or absent | **401 Unauthorized** | Not from GitHub, or the secret is wrong |
| Required headers absent | **400 Bad Request** | Not a GitHub delivery |
| Body is not valid JSON, or fails schema | **400 Bad Request** | Malformed; redelivery will not help |
| Event type we do not track | **200 OK** | Well-formed and deliberately ignored, not an error |
| Repository unknown to us | **200 OK** | Well-formed; a redelivery would not change it |
| Redis unavailable, or the write fails | **503 Service Unavailable** | Not durable. GitHub's redelivery is the recovery path |
| Processing fails after the 202 | *(no response to give)* | Retry internally, then dead-letter. GitHub is never asked again |

Two of these are easy to get backwards. An unsupported event is a **200**, not
a 400: it is a valid delivery we have chosen not to handle, and a 400 would
make GitHub's dashboard show failures for normal traffic. A Redis outage is a
**503**, not a 500: 503 is the signal that invites redelivery.

### 3.1 Why 202 is not enough on its own

`XADD` returning an ID means Redis accepted the entry in memory. It does not
mean the entry survives the process being killed. The acknowledgement is only
as durable as the Redis configuration behind it, so the deployment must run:

- `appendonly yes` with `appendfsync everysec` — an fsync at most one second
  behind, so a crash loses at most one second of accepted events;
- replication with at least one replica, and `WAIT 1 100` after `XADD` when the
  deployment is multi-node, so the entry is on a replica before the 202;
- `maxmemory-policy noeviction` on the queue instance. The default
  `allkeys-lru` will silently evict queued events under pressure, which is the
  worst failure available here: a 202 was sent and the event is gone.

If `WAIT` times out, the correct response is **503**, not 202.

---

## 4. Idempotency

Three layers, because one is not enough.

1. **The claim.** `SET webhooks:delivery:{id} 1 NX EX 604800` before enqueueing.
   `NX` makes the claim atomic, which the current read-then-write check is not.
   A failed claim is a duplicate: return 200 and stop.
2. **The constraint.** `UNIQUE` on `github_events.delivery_id`, which the
   current schema lacks. This is the layer that actually holds, because Redis
   can lose a key and the claim TTL eventually expires. A worker inserting a row
   catches the unique violation, treats it as already-processed, and `XACK`s.
3. **Natural keys.** Every handler upserts on `(repo_id, kind, ref_id)` — the
   commit SHA, the PR number, the run ID — so reprocessing the same event
   converges rather than duplicating. This already works in `github.py:_upsert`.

Layer 1 is the fast path, layer 2 is the guarantee, layer 3 makes a retry safe
even when both are bypassed.

**The push-event defect must not be carried over.** Writing the delivery ID to
only the first commit row makes layer 2 unenforceable for pushes. One queue
entry carries the whole push; the worker writes its commit rows in one
transaction, and the delivery ID belongs to a separate `webhook_deliveries`
row, not to a commit row.

---

## 5. Workers

```
while running:
    msgs = XREADGROUP(group="processors", consumer=name,
                      streams={"webhooks:events": ">"}, count=10, block=5000)
    for msg in msgs:
        try:
            with db.begin():          # one transaction per event
                process(msg)          # upserts, notifications, audit rows
            XACK(stream, group, msg.id)
        except Transient as e:        # database unavailable, lock timeout
            schedule_retry(msg, e)    # leave unacked; XCLAIM picks it up
        except Permanent as e:        # schema violation, unknown shape
            dead_letter(msg, e); XACK(stream, group, msg.id)
```

- **One transaction per event.** Database writes commit or do not; there is no
  half-processed event.
- **Acknowledge after the commit**, never before.
- **Crash recovery** is the pending-entries list. A worker that dies leaves its
  messages unacknowledged; a janitor runs `XAUTOCLAIM` for entries idle longer
  than the visibility timeout (60s) and hands them to a live worker.
- **Retries**: 5 attempts, exponential backoff with jitter —
  1s, 4s, 16s, 64s, 256s. The attempt count lives in the stream entry, so it
  survives a restart.
- **Dead letter** after the fifth failure: `XADD webhooks:dead` with the
  original payload, the delivery ID, the error and the attempt history, then
  `XACK` so the entry leaves the pending list. Dead-lettered events are
  replayable by hand; they are never dropped.
- **Poison-message guard**: an entry that has been claimed more than 10 times
  goes straight to the dead letter regardless of the error, so one bad payload
  cannot occupy a worker forever.

### 5.1 Ordering

Streams are ordered, but several workers process concurrently, so ordering
across events is not guaranteed. This is acceptable because every handler is an
upsert on a natural key, and the two cases where ordering would matter are
handled by the data: a PR's state is taken from the payload rather than
inferred from a sequence, and a workflow run's conclusion is likewise absolute.
Where strict per-repository ordering is ever needed, partition by
`repository.id` across consumer groups rather than serialising everything.

---

## 6. Configuration and deployment

Everything from the environment. No credential is ever written to the
repository, to a log line, to an audit record or to a blocker.

```
REDIS_URL=redis://:<password>@host:6379/0   # credentials from the secret store
REDIS_STREAM=webhooks:events
REDIS_DEAD_STREAM=webhooks:dead
REDIS_GROUP=processors
WEBHOOK_MAX_ATTEMPTS=5
WEBHOOK_VISIBILITY_TIMEOUT=60
WEBHOOK_DELIVERY_TTL=604800
GITHUB_WEBHOOK_SECRET=...                   # secret store only
GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY      # replaces the bare PAT
```

The compose file in apex-erp-mvp carries literal defaults
(`JWT_SECRET: change-me-for-anything-beyond-a-demo`,
`GITHUB_WEBHOOK_SECRET: demo-webhook-secret`). Those are demo values. They are
not reproduced here and must not reach any deployed environment.

Services to add alongside `app` and `db`: `redis` (appendonly, noeviction) and
`worker` (the same image, a different entrypoint, scaled independently of the
API). Resource shape: Redis is small — the queue holds normalised events, not
payload archives, so 256 MB is generous. Workers are database-bound; scale on
the pending-entries depth, not on CPU.

### 6.1 Health and monitoring

Expose, and alert on:

- stream length and **pending-entries count** — the real backlog signal;
- oldest pending entry age — the one to page on;
- dead-letter stream length — any growth needs a person;
- events processed and failed per minute, by event type;
- 503 rate on the webhook endpoint — Redis is unreachable;
- 401 rate — a secret rotation has gone wrong.

---

## 7. Tests the brief requires, and their status

Every row is **not run**, because none of this exists.

| Test | What it asserts | Status |
|---|---|---|
| Valid delivery | 202 after the entry is in the stream | Not run |
| Duplicate delivery | 200, one row, one processing | Not run |
| Concurrent duplicates | Two simultaneous deliveries of one ID produce one row | Not run |
| Invalid signature | 401, nothing enqueued | Not run |
| Absent headers | 400 | Not run |
| Malformed JSON | 400 | Not run |
| Unsupported event | 200, nothing enqueued | Not run |
| Unknown repository | 200 | Not run |
| Redis down | 503, nothing lost, redelivery succeeds once Redis returns | Not run |
| Redis evicts under pressure | With `noeviction`, `XADD` fails and returns 503 rather than accepting and dropping | Not run |
| Burst | 1,000 deliveries in 10s all return under 200ms and all are processed exactly once | Not run |
| Worker killed mid-message | The entry is reclaimed and processed exactly once | Not run |
| Redis restarted with AOF | Entries accepted before the restart are still processed | Not run |
| Retry backoff | Five attempts at the stated intervals, then dead-letter | Not run |
| Dead letter replay | A replayed entry produces no duplicate row | Not run |
| Poison message | Ten claims, then dead-lettered | Not run |

**Until these pass, the integration is not production-ready, and it should not
be described as such.**

---

## 8. Which failures GitHub retries, and which we handle

| Failure | Who recovers |
|---|---|
| 401, 400 | Nobody. The delivery is rejected on purpose |
| 503 | **GitHub.** Its redelivery is the recovery path |
| 5xx from a crash before the 202 | **GitHub**, same path |
| Worker crash after the 202 | **Us**, via the pending-entries list and `XAUTOCLAIM` |
| Transient database failure | **Us**, via retry with backoff |
| Permanent processing failure | **Us**, via the dead letter and a person |

The division matters: anything before the 202 is GitHub's to retry, anything
after it is ours, and nothing may fall between the two. That is the whole
reason the 202 is sent at the point it is sent and not a line earlier.

---

## 9. Order of work, if this is built

1. Stand up a backend at all. Nothing below is possible without one, and that
   decision has not been taken.
2. `webhook_deliveries` table with a `UNIQUE` delivery ID; backfill the missing
   constraint on `github_events`.
3. The receiver: verify, claim, validate, enqueue, 202. No processing.
4. Redis with `appendonly yes`, `noeviction`, one replica.
5. The worker loop, one transaction per event, acknowledge after commit.
6. `XAUTOCLAIM` janitor, retries, dead letter, poison guard.
7. The tests in §7. All of them.
8. GitHub App authentication, replacing the PAT.
9. Health metrics and alerts.
10. Only then describe any of it as connected.
