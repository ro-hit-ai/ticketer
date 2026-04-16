# Engineering Ownership: MintLeaf and VATI

## Purpose

This note defines the system boundary between MintLeaf and VATI so product and engineering decisions stay consistent as the integration grows.

The guiding principle is:

- MintLeaf is the communication engine.
- VATI is the workflow engine.

If something answers "what is happening to the case?", it belongs in VATI.
If something answers "how are we communicating about the case?", it belongs in MintLeaf.

## System Roles

### VATI owns workflow truth

VATI is the system of record for:

- case creation and lifecycle
- assignment and ownership rules
- workflow stage and status transitions
- candidate progress through the process
- SLA/TAT definitions and calculations
- workflow permissions and business validations
- deep-link destinations for workflow pages

### MintLeaf owns communication truth

MintLeaf is the system of record for:

- inboxes, threads, and messages
- agent replies and outbound email delivery
- mailbox routing and queue behavior
- communication history and audit context
- transport metadata such as email headers
- communication notifications and webhook consumption
- agent-facing conversation visibility around a case

## Shared Contract

The integration between both systems should stay intentionally small and stable.

Shared contract elements:

- `applicationId` is the primary cross-system identifier
- shared APIs return normalized JSON only
- authentication is either user session/cookie or service-to-service token
- webhook payloads include stable event names, `eventId`, timestamps, and signatures
- deep-link fields point to the correct VATI workflow page
- outbound email headers preserve traceability with `X-Application-Id` and `X-SourceCaseId`

## Ownership Rules

Put functionality in VATI when it:

- changes workflow state
- decides assignment, stage, or status
- computes SLA/TAT or deadline logic
- enforces business rules
- determines who should act next in the case

Put functionality in MintLeaf when it:

- sends, receives, or displays messages
- groups communication into threads or inbox views
- stores communication metadata or delivery events
- manages mailbox identity, routing, or queue behavior
- exposes communication activity to agents

## What MintLeaf Should Not Become

MintLeaf should not:

- reimplement workflow state machines
- become a second source of truth for case status
- own assignment logic
- calculate SLA/TAT independently
- embed VATI-specific business rules beyond lightweight integration helpers

## Recommended Data Flow

1. VATI creates or updates workflow state.
2. VATI emits relevant events or exposes shared API data.
3. MintLeaf consumes that data using the shared contract.
4. MintLeaf organizes communication around the same `applicationId`.
5. Agents work in MintLeaf for communication tasks while relying on VATI for workflow truth.

## Decision Checklist

Before adding any new integration behavior, ask:

1. Is this changing workflow truth or only communication behavior?
2. Which system should remain the source of record after this change?
3. Does this require a new shared contract field, or can it reuse the existing one?
4. Will this duplicate logic already owned by the other system?

If the answer is unclear, prefer:

- VATI for workflow decisions
- MintLeaf for communication actions

## Target Outcome

The final platform should feel unified to users while remaining clean internally:

- VATI drives the case
- MintLeaf drives the conversation
- `applicationId` ties the systems together
- each system stays maintainable because it has one clear job
