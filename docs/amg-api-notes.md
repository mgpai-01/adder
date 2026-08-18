# AMG Time Universal API — integration notes

Swagger UI: https://amgwebtime.com/swagger/ui/index — spec at /swagger/docs/v1.
Account: Manufacturing Green Products (ID 22050).

## Auth
Cookie-based. `POST /JsonApi/TimeCard/Login?userName=<login>` with the password
as a JSON string body. Keep every Set-Cookie and send them on all later calls.
Credentials live in Vercel env vars `AMG_USERNAME` / `AMG_PASSWORD`
(`AMG_HOST` optional, defaults to https://amgwebtime.com).

## Endpoints used (see lib/amgTime.ts)
- `POST /JsonApi/Employee/GetAllEmployeesShort` — body `null`. Returns
  `[{ Id, Code, Name, FullName, LastName, Badge, Active }]`. `Code` is the
  timecard report's employee code (e.g. "00137") and is what we remember on
  roster records as `timeclockCode`.
- `POST /JsonApi/TimeCard/GetTimecards?startDate=YYYY-MM-DDT00:00:00&endDate=...&showAbsences=false`
  — body = array of employee Ids. Returns per employee
  `{ EmployeeId, Timecards: [{ Date, Reg, OT1, OT2, OT3, Unpaid, IsMissing, MiscEntry, ... }] }`.
  Daily paid hours = Reg + OT1 + OT2 + OT3 over lines WITHOUT `MiscEntry`.
  Lines with `MiscEntry` are bonuses/pay adjustments, not worked time — the
  Lite variant (`GetTimecardsLite`) folds them into the totals with no way to
  tell them apart, which is why the full feed is used.

## Other endpoints of note (not used yet)
- `GetTimecardsWithWage`, `Wage/GetEmployeeWages` — wage figures.
- `MiscEntry/GetMiscTransactions` — the "Bonus" rows (Amount) live here.
- `TimeCard/GetPunchAnalysis` — scheduled vs actual in/out per day.

## Flows
- Manual: Payroll → "Sync Hours from AMG" → `POST /api/hours-sync`
  {startDate, endDate} → preview modal (same as file import) → Apply.
- Automatic: Vercel Cron hits `GET /api/hours-sync/cron` daily at 10:00 UTC
  (3am PT); requires `CRON_SECRET` env var; covers the last 4 days; writes
  hours to entries matched by roster `timeclockCode`; skips unknown codes
  (match them once via the manual sync preview).
