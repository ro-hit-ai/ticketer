# API Permission Matrix

This matrix reflects the current backend authorization model.

## Rules
- All routes require a valid JWT unless explicitly listed as `Public` in `src/main.js`.
- `requirePermission(...)` is enforced only when `Config.roles_active === true`.
- `isAdmin === true` grants wildcard `*` and bypasses permission checks.

## Auth (`/api/v1/auth`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/register` | `user::create` OR `user::manage` |
| POST | `/login` | Public |
| POST | `/user/register/external` | Public |
| POST | `/password-reset` | Public |
| POST | `/password-reset/code` | Public |
| POST | `/password-reset/password` | Public |
| GET | `/check` | Public |
| GET | `/oidc/callback` | Public |
| GET | `/oauth/callback` | Public |
| DELETE | `/user/:id` | `user::delete` OR `user::manage` |
| GET | `/profile` | Authenticated |
| POST | `/reset-password` | Authenticated |
| POST | `/admin/reset-password` | `user::update` OR `user::manage` |
| PUT | `/profile` | Authenticated |
| PUT | `/profile/notifcations/emails` | Authenticated |
| GET | `/user/:id/logout` | Authenticated (self or user manager/admin) |
| PUT | `/user/role` | `user::manage` |
| POST | `/user/:id/first-login` | Authenticated (self or user manager/admin) |
| GET | `/sessions` | Authenticated |
| DELETE | `/sessions/:sessionId` | Authenticated |

## Users (`/api/v1/user`)
| Method | Endpoint | Access |
|---|---|---|
| GET | `/all` | `user::read` |
| POST | `/new` | `user::create` OR `user::manage` |
| PUT | `/reset-password` | `user::update` OR `user::manage` |
| GET | `/notification/:id` | `user::read` OR `issue::read` + owner check |

## Roles (`/api/v1/role`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `role::create` |
| GET | `/all` | `role::read` |
| GET | `/:id` | `role::read` |
| PUT | `/:id/update` | `role::update` |
| DELETE | `/:id/delete` | `role::delete` |
| POST | `/assign` | `role::update` |
| POST | `/remove` | `role::update` |

## Clients (`/api/v1/client`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `client::create` |
| POST | `/update` | `client::update` |
| GET | `/all` | `client::read` |
| DELETE | `/:id/delete-client` | `client::delete` |

## Tickets (`/api/v1/ticket`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `issue::create` |
| POST | `/public/create` | Public |
| GET | `/:id` | `issue::read` |
| GET | `/tickets/open` | `issue::read` |
| POST | `/tickets/search` | `issue::read` |
| GET | `/tickets/all` | `issue::read` |
| GET | `/tickets/user/open` | `issue::read` |
| GET | `/tickets/completed` | `issue::read` |
| GET | `/tickets/unassigned` | `issue::read` |
| PUT | `/ticket/update` | `issue::update` |
| POST | `/ticket/transfer` | `issue::transfer` |
| POST | `/transfer/client` | `issue::transfer` |
| POST | `/ticket/comment` | `issue::comment` |
| POST | `/comment/delete` | `issue::comment` |
| PUT | `/status/update` | `issue::update` |
| PUT | `/status/hide` | `issue::update` |
| PUT | `/status/lock` | `issue::update` |
| POST | `/delete` | `issue::delete` |
| GET | `/tickets/templates` | `email_template::manage` |
| GET | `/template/:id` | `email_template::manage` |
| PUT | `/template/:id` | `email_template::manage` |
| GET | `/user/open/external` | `issue::read` |
| GET | `/user/closed/external` | `issue::read` |
| GET | `/user/external` | `issue::read` |
| GET | `/subscribe/:id` | `issue::read` |
| GET | `/unsubscribe/:id` | `issue::read` |

## Notebook (`/api/v1/notebook`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `document::create` |
| GET | `/all` | `document::read` |
| GET | `/:id` | `document::read` |
| PUT | `/update/:id` | `document::update` |
| DELETE | `/delete/:id` | `document::delete` |

## Webhooks (`/api/v1/webhook`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `webhook::create` |
| GET | `/all` | `webhook::read` |
| DELETE | `/:id/delete` | `webhook::delete` |

## Data (`/api/v1/data`)
| Method | Endpoint | Access |
|---|---|---|
| GET | `/tickets/all` | `issue::read` |
| GET | `/tickets/completed` | `issue::read` |
| GET | `/tickets/open` | `issue::read` |
| GET | `/tickets/unassigned` | `issue::read` |
| GET | `/logs` | `settings::view` OR `settings::manage` |

## Time (`/api/v1/time`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/new` | `time_entry::create` |
| GET | `/` | `time_entry::read` |
| DELETE | `/:id` | `time_entry::delete` |

## Storage (`/api/v1/storage`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/ticket/:id/upload/single` | `issue::update` |
| GET | `/ticket/:id/files` | `issue::read` |
| DELETE | `/file/:fileId/delete` | `issue::update` |
| GET | `/file/:fileId/download` | `issue::read` |
| GET | `/file/:fileId/info` | `issue::read` |

## Queue (`/api/v1/email-queue`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/create` | `integration::manage` |
| GET | `/generate-oauth-url/:mailboxId` | `integration::manage` |
| GET | `/oauth` | Public callback |
| GET | `/all` | `integration::manage` |
| DELETE | `/delete` | `integration::manage` |

## Config (`/api/v1/config/authentication`)
| Method | Endpoint | Access |
|---|---|---|
| GET | `/check` | Public |
| POST | `/oidc/update` | `settings::manage` |
| POST | `/oauth/update` | `settings::manage` |
| DELETE | `/delete` | `settings::manage` |
| GET | `/email` | `settings::view` OR `settings::manage` |
| PUT | `/email` | `settings::manage` |
| GET | `/oauth/gmail` | Public callback |
| DELETE | `/email` | `settings::manage` |
| PATCH | `/toggle-roles` | `settings::manage` + admin session check |

## IMAP (`/api/v1/imap`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/fetch-emails` | `integration::manage` |
| GET | `/emails` | `integration::manage` |
| GET | `/emails/:id` | `integration::manage` |
| POST | `/emails/:id/move` | `integration::manage` |
| POST | `/emails/move` | `integration::manage` |

## SMTP (`/api/v1/smtp`)
| Method | Endpoint | Access |
|---|---|---|
| POST | `/fetch-emails` | `integration::manage` |
| POST | `/send-email` | `email::send` OR `integration::manage` |
| GET | `/emails` | `email::read` OR `integration::manage` |
| POST | `/tickets/:id/reply` | `issue::comment` OR `email::send` |

## PHP Bridge (`/api/v1/php`)
| Method | Endpoint | Access |
|---|---|---|
| All | `/*` | `x-api-key` (`PHP_API_KEY`) required |
