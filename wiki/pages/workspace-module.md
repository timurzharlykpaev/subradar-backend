---
title: Модуль Workspace (Team plan)
tags: [module, workspace, team, invites, roles, ownership, analytics]
sources:
  - src/workspace/workspace.controller.ts
  - src/workspace/workspace.service.ts
  - src/workspace/workspace.module.ts
  - src/workspace/entities/workspace.entity.ts
  - src/workspace/entities/workspace-member.entity.ts
  - src/workspace/entities/invite-code.entity.ts
  - src/workspace/dto/create-workspace.dto.ts
  - src/workspace/dto/invite-member.dto.ts
  - src/workspace/dto/change-member-role.dto.ts
  - src/workspace/dto/transfer-ownership.dto.ts
updated: 2026-05-22
---

# Модуль Workspace

Реализует Team plan — общая подписка для команды до 5 человек, аналитика и отчёты по всему workspace, AI-анализ дубликатов.

## Сущности

### Workspace (`workspaces`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `name` | string | Название (редактируется owner/admin) |
| `ownerId` | UUID | FK → users — billing source of truth |
| `plan` | varchar(32) | `'TEAM'` (всегда) |
| `maxMembers` | int | Default 5 |
| `lemonSqueezySubscriptionId` | varchar | LS sub id (для веб-биллинга) |
| `expiredAt` | timestamp | Когда RC sub owner истёк — используется `cleanupAbandonedWorkspaces` cron |
| `createdAt` | timestamp | |

### WorkspaceMember (`workspace_members`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `workspaceId` | UUID | FK → workspaces (CASCADE) |
| `userId` | UUID | FK → users (nullable — invite ещё не принят) |
| `role` | enum | `OWNER` / `ADMIN` / `MEMBER` |
| `inviteEmail` | string | Email из invite (если userId NULL) |
| `status` | enum | `PENDING` / `ACTIVE` |
| `joinedAt` | timestamp | |

**Инварианты:**
- `workspace.ownerId` — billing-источник истины (RC purchase привязан к этому user)
- `members[].role = OWNER` — RBAC внутри workspace (invite, role-change, delete)
- Два значения должны быть синхронны (см. `transferOwnership`)

### InviteCode (`invite_codes`)

10-символьный код (charset без `I`/`L`/`O`/`0`/`1`), TTL 48 часов, single-use.

| Поле | Тип | Описание |
|------|-----|----------|
| `code` | varchar(10) | UNIQUE |
| `workspaceId` | UUID | |
| `createdBy` | UUID | Owner/Admin |
| `usedBy` | UUID | Кто join'ил (NULL пока не использован) |
| `usedAt` | timestamp | |
| `expiresAt` | timestamp | |

**Лимит:** не более 5 активных кодов на workspace.

## API эндпоинты

| Метод | Путь | Auth/Guard | Throttle | Описание |
|-------|------|------------|----------|----------|
| `POST` | `/workspace` | JWT + `PlanGuard(canCreateOrg)` | 3/min | Создать workspace (Organization plan) |
| `GET` | `/workspace/me` | JWT | — | Текущий workspace пользователя (null если нет) |
| `GET` | `/workspace/me/analytics?displayCurrency=` | JWT | — | Сводная аналитика по workspace (Redis 5 мин) |
| `GET` | `/workspace/me/members?page=&limit=&sort=` | JWT | — | Пагинированный список членов (owner-only) |
| `GET` | `/workspace/me/overlaps` | JWT | — | Дубликаты по командам из последнего AnalysisResult |
| `POST` | `/workspace/me/analysis/run` | JWT | — | Запустить team-analysis (см. [[analysis-module]]) |
| `GET` | `/workspace/me/analysis/latest` | JWT | — | Последний team-analysis результат |
| `POST` | `/workspace/me/reports/generate` | JWT | — | Запустить team PDF/CSV report (см. [[reports-module]]) |
| `GET` | `/workspace/:id` | JWT | — | Один workspace (member-only) |
| `POST` | `/workspace/:id/invite` | JWT + `PlanGuard(canInvite)` | 20/min | Email-invite (pending member) |
| `POST` | `/workspace/:id/invite-code` | JWT | 10/min | Сгенерировать invite-код (owner/admin) |
| `POST` | `/workspace/join/:code` | JWT | 10/min | Join по коду |
| `POST` | `/workspace/:id/leave` | JWT | — | Покинуть workspace (member, не owner) |
| `DELETE` | `/workspace/:id` | JWT | — | Удалить workspace (owner-only) |
| `PATCH` | `/workspace/:id` | JWT | 10/min | Переименовать (owner/admin) |
| `DELETE` | `/workspace/:id/members/:memberId` | JWT | — | Удалить члена (owner-only) |
| `PATCH` | `/workspace/:id/members/:memberId/role` | JWT | 20/min | Сменить роль (owner-only) |
| `POST` | `/workspace/:id/transfer-owner` | JWT | 3/min | Передать владение (требует `confirm: "TRANSFER"`) |
| `GET` | `/workspace/:id/members/:memberId/subscriptions` | JWT | — | Подписки члена (owner/admin) |
| `GET` | `/workspace/me/members/:memberId/subscriptions` | JWT | — | Тот же endpoint, auto-detect workspace |

## Бизнес-правила

### Race-conditions при join
- Redis-lock `workspace:join-lock:{workspaceId}` (TTL 10s, SETNX) предотвращает гонку join'ов:
  - Проверка `maxMembers` capacity
  - Single-use invite code
  - Двойной active-member для одного `userId`

### Передача владения
- Только owner → existing ACTIVE member
- Workspace.ownerId и members[].role обновляются вместе (no transaction — промежуточный state «два OWNER» безвреден)
- Старый owner понижается до ADMIN
- Audit log + outbox event `workspace.ownership_transferred`

### Каскады при изменениях биллинга
- При EXPIRATION RC у owner → каскад на всех ACTIVE members:
  - `userBilling.applyTransition(memberUserId, { type: 'TEAM_OWNER_EXPIRED' })` — каждому grace 7 дней
  - `workspace.expiredAt = now`
- При remove/leave → `TEAM_MEMBER_REMOVED` (grace 7 дней если у юзера нет своей RC sub)

### Workspace analytics (`/workspace/me/analytics`)
- Агрегирует ACTIVE+TRIAL подписки всех ACTIVE members
- FX-конвертация в `displayCurrency` (query > user pref > USD)
- Кеш `ws:{wsId}:analytics:{currency}` 5 минут (SCAN-based invalidate)
- При FX-failure: суммирует raw amounts, кеш НЕ пишется (флаг `fxFailed: true`)
- N+1 не возникает — sub counts через `GROUP BY` (для paginated `/me/members`)

### Team report и analytics-overlaps
- `POST /workspace/me/reports/generate` — owner-only, async PDF aggregator (см. [[reports-module]])
- `GET /workspace/me/overlaps` — читает `latestResult.overlaps` без новых AI-вызовов

## Audit / Outbox

Каждое мутирующее действие:
1. `AuditService.log({ action, resourceType, resourceId, metadata })` → таблица `audit_logs`
2. `OutboxService.enqueue('amplitude.track', { event, userId, properties })` → таблица `outbox_events`

Список actions: `workspace.created`, `workspace.member_invited`, `workspace.member_joined`, `workspace.member_removed`, `workspace.invite_code_generated`, `workspace.deleted`, `workspace.member_role_changed`, `workspace.ownership_transferred`, `workspace.team_report_generated`.

## Связанные модули

- [[billing-module]] — биллинг workspace, переход на Team
- [[effective-access]] — резолвит `isTeamOwner`/`isTeamMember` для `/billing/me`
- [[analysis-module]] — team-аналитика с overlap-детекцией
- [[reports-module]] — team-отчёты
- [[common-cross-cutting]] — Audit, PlanGuard, RequirePlanCapability
