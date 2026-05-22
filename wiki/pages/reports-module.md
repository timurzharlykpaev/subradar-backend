---
title: Модуль отчётов (Reports)
tags: [module, reports, pdf, csv, bullmq, pdfkit, team-reports]
sources:
  - src/reports/reports.controller.ts
  - src/reports/reports.service.ts
  - src/reports/reports.processor.ts
  - src/reports/reports.module.ts
  - src/reports/entities/report.entity.ts
  - src/reports/pdf-fonts.ts
  - src/reports/pdf-i18n.ts
updated: 2026-05-22
---

# Модуль отчётов

Async-генерация PDF (и CSV) отчётов по подпискам пользователя за период. Personal и Team (workspace-scoped) форматы.

## Сущности

### Report (`reports`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `userId` | UUID | Кто заказал (CASCADE → users) |
| `workspaceId` | UUID | nullable — если есть, это team report (агрегирует данные members) |
| `type` | enum | `SUMMARY` / `DETAILED` / `TAX` / `AUDIT` |
| `from`, `to` | string (ISO date) | Период |
| `fileUrl` | string | (legacy, не используется сейчас — PDF лежит в Redis) |
| `status` | enum | `PENDING` / `GENERATING` / `READY` / `FAILED` |
| `error` | text | nullable |
| `createdAt` | timestamp | |

## API эндпоинты

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| `POST` | `/reports/generate` | JWT | Async enqueue PDF (202 Accepted) |
| `GET` | `/reports` | JWT | Список своих отчётов |
| `GET` | `/reports/:id` | JWT | Один отчёт (со статусом) |
| `GET` | `/reports/:id/download` | JWT | Скачать PDF (если READY) |

**Body `/reports/generate`** (всё optional кроме `type`):
```json
{
  "type": "SUMMARY",
  "from": "2026-04-01",     // или startDate (alias)
  "to": "2026-04-30",       // или endDate (alias)
  "format": "pdf",          // ignored, всегда PDF
  "locale": "ru",           // default user.locale → en
  "displayCurrency": "KZT"  // ISO 4217, fallback user.displayCurrency
}
```

Team reports создаются отдельным методом `ReportsService.generateTeam()` — вызывается только из [[workspace-module]] (`POST /workspace/me/reports/generate`).

## Биллинг-ограничения

- **Free план:** 1 report / месяц (`ForbiddenException` после первого в текущем календарном месяце)
- **Pro/Organization:** unlimited
- **Team reports:** не разрешены для `free` (defense-in-depth — Pro/Team workspace owner всегда не free)

## Pipeline (BullMQ queue `reports`)

1. `POST /reports/generate` → INSERT Report (PENDING) → `reportQueue.add('generate-pdf', { reportId, userId, locale, displayCurrency })`
2. `ReportsProcessor` → `buildAndStorePdf()`:
   - UPDATE status = GENERATING, error = null
   - `buildPdf()` через PDFKit (см. ниже)
   - SET в Redis `report:pdf:{id}` (base64, TTL 1 час)
   - UPDATE status = READY
   - На исключении: UPDATE status = FAILED, error = first 500 chars

3. `GET /reports/:id/download` → читает `report:pdf:{id}` из Redis → `Buffer.from(base64)` → отдаёт как `application/pdf` с `Content-Disposition: attachment`

**TTL PDF** — 1 час. После — `Report.status` остаётся READY, но скачивание упирается в 404 «PDF expired, regenerate». Клиент должен повторно вызвать `/reports/generate`.

## PDF rendering (PDFKit)

- **Шрифты:** Roboto Regular/Bold (bundled в `fonts/`) — покрывают Latin, Latin Extended, Cyrillic, Greek, валютные символы
- **i18n** через `pdf-i18n.ts` (`pdfL(locale, key)`) — RU/EN/etc.
- **Sanitize:** `safeText()` стрипает emoji, CJK, private-use chars (`U+1F000-1FAFF`, `U+3000-9FFF`, `U+E000-F8FF`, ZWJ) — иначе PDF получает `.notdef` боксы
- **Категории:** маппинг на бренд-цвета (`STREAMING` → Netflix red, `MUSIC` → Spotify green, `AI_SERVICES` → OpenAI teal, etc.)
- **Layout:** A4 portrait (595×842 pt), margins 50/50/50/60

## Team reports

Если `report.workspaceId !== null`:
- `loadTeamScope(workspaceId, from, to)` — все подписки всех active members + cards
- **Hard caps** против OOM на 512MB worker:
  - `TEAM_MEMBER_CAP = 50`
  - `TEAM_SUB_CAP = 5000` (50×100 ≈ безопасно для PDFKit)
- Усечения логируются + флагом в PDF
- Owner verification дублируется в service и controller (symmetric — partial code change не может расширить доступ)
- Audit log `workspace.team_report_generated` с `{ reportId, type, from, to }`

## Recent fix `f0d2d2b` — no freeze on interrupted PDF generation

Если worker крашится в середине `buildPdf` (OOM, OOMK, crash), раньше status оставался GENERATING вечно → клиент бесконечно polling показывал spinner. Теперь:
- На любой exception → UPDATE Report SET status = FAILED, error = ... (catch в `buildAndStorePdf`)
- Cron (если есть stuck > 1h в GENERATING) переводит в FAILED — добавить в [[cron-jobs]] если ещё нет
- Mobile UI показывает retry CTA при FAILED вместо вечной загрузки

## Связанные модули

- [[workspace-module]] — team reports
- [[fx-module]] — конвертация в displayCurrency
- [[billing-module]] — Free-plan rate-limit
- [[subscriptions-module]] — источник данных
