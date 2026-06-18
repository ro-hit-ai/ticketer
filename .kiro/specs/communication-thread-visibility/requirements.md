# Requirements Document

## Introduction

The Node.js communication monitoring system controls access to email threads that carry workflow metadata (applicationId, componentKey, ownerRole) as labels. Two distinct caller types exist: **Communication Operators** — Node users identified by a MongoDB ObjectId — and **Workflow Principals** — PHP workflow participants identified by a PHP integer user ID, authenticated via a workflow JWT. The current authorization merge logic unconditionally returns PHP's decision when shadow mode is off, causing PHP's `unsupported_role` response (returned whenever the caller has no PHP identity) to silently drop threads that Node has already granted access to. This feature corrects that gap by making Node scope the authoritative access gate for Communication Operators while preserving PHP enforcement for Workflow Principals.

---

## Glossary

- **Thread_Access_Service**: The authorization layer in `src/controllers/threads.js` responsible for filtering and granting access to communication threads.
- **PHP_Authorization_Client**: The service in `src/lib/services/phpAuthorizationClient.service.js` that calls PHP's workflow lane, message, and attachment authorization endpoints.
- **Node_Scope_Check**: The access decision produced by `ensureNodeThreadAccess()` / `buildThreadAccessQuery()`, based on `fetchAssignedApplications()` returning a set of `applicationIds` the caller may view.
- **PHP_Lane_Check**: The access decision produced by calling `workflow_lane_authorize.php` via `authorizeLane()`.
- **mergeAuthorizationDecision**: The function in `PHP_Authorization_Client` that combines `nodeDecision` and `phpDecision` into a single final decision.
- **filterAuthorizedThreads**: The function in `Thread_Access_Service` that filters a list of threads by running `authorizeLane()` and `mergeAuthorizationDecision()` for each thread.
- **Communication_Operator**: A Node user identified by a MongoDB ObjectId string (e.g., `69eb02f3c9a52762732be667`). Has no PHP integer user ID and no lane assignment in PHP's user table.
- **Workflow_Principal**: A caller authenticated via a workflow JWT (`isWorkflowPrincipal = true`, `phpUserId` set to a positive integer). Represents a PHP workflow participant (e.g., verifier, QA, client admin) with a lane assignment in PHP.
- **applicationIds**: The set of `sourceCaseId` values (uppercase strings such as `APP-20260603140030312`) that PHP returns for a given session via `my_assigned_applications.php`.
- **unsupported_role**: The `reason` value PHP returns in its authorization response when it cannot resolve a role for the provided `userId` — typically because the userId is a MongoDB ObjectId rather than a PHP integer.
- **owner_role_mismatch**: The `reason` value PHP returns when it successfully resolves the caller but finds the caller's role does not match the thread's required lane role.
- **Shadow_Mode**: An operational flag (`PHP_AUTHORIZATION_SHADOW_MODE=true`) that causes `mergeAuthorizationDecision` to return `nodeDecision` regardless of `phpDecision`. Used during migration and testing.

---

## Requirements

### Requirement 1: Communication Operator Thread Listing

**User Story:** As a Communication Operator, I want GET /api/v1/threads to return all threads whose `sourceCaseId` is in my PHP-assigned application scope, so that I can view and manage the email correspondence I am responsible for.

#### Acceptance Criteria

1. WHEN a Communication_Operator calls `GET /api/v1/threads` and `fetchAssignedApplications` returns a non-empty `applicationIds` list, THE Thread_Access_Service SHALL include all threads whose `sourceCaseId` is in `applicationIds` in the response.
2. WHEN a Communication_Operator calls `GET /api/v1/threads` and PHP returns `unsupported_role` for one or more threads, THE Thread_Access_Service SHALL not drop those threads from the response solely because of the `unsupported_role` PHP decision.
3. WHEN a Communication_Operator calls `GET /api/v1/threads` and `fetchAssignedApplications` returns an empty `applicationIds` list, THE Thread_Access_Service SHALL return an empty thread list.
4. WHEN a privileged admin user calls `GET /api/v1/threads`, THE Thread_Access_Service SHALL return all threads without applying scope filtering.

---

### Requirement 2: Communication Operator Single-Thread Access

**User Story:** As a Communication Operator, I want to access a specific thread by ID or by `sourceCaseId` when that application is in my scope, so that I can read messages and manage the thread.

#### Acceptance Criteria

1. WHEN a Communication_Operator requests a thread whose `sourceCaseId` is in `applicationIds`, THE Thread_Access_Service SHALL grant access regardless of the PHP_Lane_Check result.
2. WHEN a Communication_Operator requests a thread whose `sourceCaseId` is not in `applicationIds`, THE Thread_Access_Service SHALL deny access with HTTP 403.
3. WHEN a Communication_Operator requests a thread and `fetchAssignedApplications` returns an empty list, THE Thread_Access_Service SHALL deny access with HTTP 403.
4. IF `fetchAssignedApplications` returns an error or times out, THEN THE Thread_Access_Service SHALL deny access to the requested thread with HTTP 403.

---

### Requirement 3: Workflow Principal Thread Access

**User Story:** As a Workflow Principal (verifier, QA, client admin), I want thread access to be enforced by PHP's lane authorization, so that only principals with a valid lane assignment in the PHP workflow system can read workflow-sensitive threads.

#### Acceptance Criteria

1. WHEN a Workflow_Principal requests a thread and PHP_Lane_Check returns `allowed: true`, THE Thread_Access_Service SHALL grant access.
2. WHEN a Workflow_Principal requests a thread and PHP_Lane_Check returns `allowed: false` for any reason, THE Thread_Access_Service SHALL deny access with HTTP 403.
3. WHEN a Workflow_Principal requests a thread and `phpUserId` is absent or not a positive integer, THE Thread_Access_Service SHALL deny access with HTTP 403 and reason `MISSING_PHP_USER_ID` without calling `workflow_lane_authorize.php`.
4. WHILE `isWorkflowPrincipal` is `true`, THE Thread_Access_Service SHALL use the PHP integer `phpUserId` as the `userId` sent to `workflow_lane_authorize.php`.

---

### Requirement 4: Authorization Decision Merge — `unsupported_role` Override

**User Story:** As a system architect, I want `mergeAuthorizationDecision` to return Node's positive decision when PHP signals `unsupported_role`, so that Communication Operators are not silently denied access due to a PHP identity mismatch.

#### Acceptance Criteria

1. WHEN `nodeDecision.allowed` is `true` and `phpDecision.reason` is `unsupported_role`, THE PHP_Authorization_Client SHALL return `nodeDecision` as the merged decision.
2. WHEN `nodeDecision.allowed` is `false` and `phpDecision.reason` is `unsupported_role`, THE PHP_Authorization_Client SHALL return `phpDecision` (denied) as the merged decision.
3. WHEN `phpDecision.reason` is `owner_role_mismatch` and `nodeDecision.allowed` is `true`, THE PHP_Authorization_Client SHALL return `phpDecision` (denied) as the merged decision.
4. WHEN `phpDecision.reason` is `owner_role_mismatch` and `nodeDecision.allowed` is `false`, THE PHP_Authorization_Client SHALL return `phpDecision` (denied) as the merged decision.
5. WHEN `Shadow_Mode` is enabled, THE PHP_Authorization_Client SHALL return `nodeDecision` regardless of `phpDecision`.
6. WHEN `Shadow_Mode` is disabled and `phpDecision.reason` is neither `unsupported_role` nor any other override condition, THE PHP_Authorization_Client SHALL return `phpDecision` as the merged decision.

---

### Requirement 5: filterAuthorizedThreads Preserves Node-Granted Threads

**User Story:** As a system operator, I want `filterAuthorizedThreads` to preserve threads that passed the Node scope check even when PHP cannot identify the caller, so that the communication inbox is not silently emptied by a PHP identity mismatch.

#### Acceptance Criteria

1. WHEN `filterAuthorizedThreads` is called with a non-empty thread list and `nodeDecision.allowed` is `true`, and PHP returns `unsupported_role` for every thread, THE Thread_Access_Service SHALL include all those threads in the authorized output.
2. WHEN `filterAuthorizedThreads` is called with a thread list and PHP returns `owner_role_mismatch` for a thread, THE Thread_Access_Service SHALL exclude that thread from the authorized output regardless of `nodeDecision`.
3. WHEN `filterAuthorizedThreads` is called with a thread list and PHP returns `allowed: true` for a thread, THE Thread_Access_Service SHALL include that thread in the authorized output.
4. WHEN `filterAuthorizedThreads` is called with an empty thread list, THE Thread_Access_Service SHALL return an empty authorized list.

---

### Requirement 6: No Regression — PHP Enforcement for Explicit Denials

**User Story:** As a security engineer, I want PHP's explicit denials (`owner_role_mismatch` and other non-`unsupported_role` reasons) to always deny access, so that the fix to `unsupported_role` handling does not weaken PHP enforcement for callers PHP can identify.

#### Acceptance Criteria

1. WHEN PHP_Lane_Check returns `allowed: false` with `reason` set to `owner_role_mismatch`, THE PHP_Authorization_Client SHALL produce a merged decision of `allowed: false`, regardless of `nodeDecision`.
2. WHEN PHP_Lane_Check returns `allowed: false` with any reason other than `unsupported_role`, THE PHP_Authorization_Client SHALL produce a merged decision of `allowed: false`.
3. WHEN PHP_Lane_Check returns `allowed: false` with reason `PHP_AUTH_TIMEOUT` or `PHP_AUTH_UNAVAILABLE`, THE PHP_Authorization_Client SHALL produce a merged decision of `allowed: false` when the caller is a Workflow_Principal.
4. IF PHP_Lane_Check returns `allowed: false` with reason `PHP_AUTH_TIMEOUT` or `PHP_AUTH_UNAVAILABLE` and the caller is a Communication_Operator, THEN THE PHP_Authorization_Client SHALL fall back to `nodeDecision` because a connectivity failure is not an identity mismatch.

---

### Requirement 7: Caller Identity Classification

**User Story:** As a system engineer, I want the authorization layer to correctly classify every caller as either a Communication Operator or a Workflow Principal before any authorization decision is made, so that the correct access gate is applied.

#### Acceptance Criteria

1. WHEN a request carries a workflow JWT with `isWorkflowPrincipal: true` and a valid positive-integer `phpUserId`, THE Thread_Access_Service SHALL classify the caller as a Workflow_Principal.
2. WHEN a request carries a standard Node session JWT and the resolved user has a MongoDB ObjectId `_id` with no `phpUserId`, THE Thread_Access_Service SHALL classify the caller as a Communication_Operator.
3. WHEN a request carries a workflow JWT and `phpUserId` is absent, zero, or non-integer, THE Thread_Access_Service SHALL deny all thread access with HTTP 403 and reason `MISSING_PHP_USER_ID`.
4. WHEN a request carries no valid JWT of any kind, THE Thread_Access_Service SHALL deny all thread access with HTTP 401.
