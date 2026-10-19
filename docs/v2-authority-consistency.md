# V2 authority and transaction consistency

This note describes the V2 host's implemented local transaction boundary. It is not a production identity or multi-process guarantee.

## Authoritative records

With V2 enabled, the host uses its configured SQLite database for the campaign lock (`v2_campaign_locks`), campaign membership and credentials (`members`), actor grants (`actor_grants`), V2 entity ownership and descriptors (`v2_extension_entities`), entity visibility and state (`v2_effect_entities`), workflows, pending commands, reactions, events, and receipts. The host adapter and extension/effect/reaction kernels receive the same `DatabaseSync` connection. The lock is immutable after pinning; a request must prove its exact lock digest. The HTTP principal is derived from the bearer credential and current membership row, never from a command body.

## Authority epoch and commit protocol

`v2_authority_versions` stores one monotonically increasing integer per configured campaign. SQLite triggers advance it for lock pinning, membership insertion/update/deletion (including credential rotation and revocation), campaign-scoped grant changes, entity owner/descriptor/capability changes, and entity visibility/type/campaign changes. These triggers execute in the same SQLite transaction as the authoritative write.

Every V2 mutation enters `BEGIN IMMEDIATE`, reads the epoch, authenticates and authorizes against the current records, validates the exact campaign lock, applies resolver output/effects, writes events and receipts, rechecks current command authority and the epoch, then commits. Any failure rolls back entity writes, cross-entity effects, random transcript commitments, reaction/workflow transitions, events, and receipts together. The host-generated random transcript exists in memory until the transaction commits; rejected requests do not leave a transcript receipt. Existing rejection/audit paths may record terminal conflicts where the durable reaction protocol explicitly requires it.

Pending commands persist the epoch captured at suspension. On continuation, the host requires the same epoch and lock, reauthorizes the initiating member, source command and every recorded reaction responder, and checks expected entity revisions before applying resumed effects. If authority changed while suspended, the continuation becomes a terminal conflict without parent effects. Old pending records created before epoch support carry the migration default `-1` and fail closed. Exact command retries authenticate and authorize before receipt lookup; a former recipient cannot use a receipt to initiate a fresh privileged request after revocation. For a still-authorized principal, an exact retry returns its committed receipt without rerunning the resolver, random source, or effects; changed payload reuse conflicts.

The epoch is intentionally campaign-wide and conservative: an unrelated membership, grant, owner, or visibility change invalidates a pending continuation. It avoids a false claim that independently versioned authorization fragments are atomically bound. It may be narrowed only with an equally complete version vector and tests.

## Guarantees and limits

Supported: the default-off loopback host, one configured campaign, one host process, and one local SQLite database containing the records above. `BEGIN IMMEDIATE` gives a serial write order against another SQLite writer using that same database: a competing authority write commits before the command (so the command observes it) or after the command (so the next request observes it). A deterministic worker test proves this ordering and restart persistence for the tested SQLite/runtime configuration. In-transaction authority mutations are additionally caught by the epoch recheck and rolled back.

Not claimed: linearizability across multiple host processes, network/shared filesystems, multiple databases, alternate SQLite connections bypassing the shared file's locking discipline, power-loss durability beyond the configured SQLite settings, production identity/role lifecycle, backup/restore or authority migration, or recovery when trusted module code itself is malicious. SQLite serialization is not a substitute for operational single-writer deployment controls. V1 campaign behavior and its storage semantics are unchanged.
