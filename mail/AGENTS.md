# Mail

- Self-contained mail module over `himalaya` CLI (`server.ts`, `ui.tsx`, `package.json`, `pnpm-lock.yaml`). Config lives under `modules.mail`.
- Provides capability `'mail'` (`MailCapability`), registered in `module.ts` `create` before returning when `modules.mail` is configured. When unconfigured, `create` returns an empty router, no poller starts, and no capability is published.
- Uses `linkedom` as a per-module npm dependency for HTML-to-text conversion (`himalaya.ts`).
- Every call runs `himalaya --json -a <account> ...` through `run` with 20 s timeout. Reading never passes `--seen`; sending (`compose`, `reply`), `replyDraft`, `archive`, `unarchive`, `list`, `search`, `searchRecords`, `read`, `threads` stay loopback-only; sending and archiving set `pageOnly: true` so MCP/palette cannot invoke them.
- A paired device gets only `accounts` (anonymized `#1`, `#2`, empty labels), `state`/`onState` (unread counts, `latest: []`), `refresh`, and `setSeen`/`setFlagged`.
- Web `ui.tsx` exports `useAvailable`, `widgets` (`MailWidget`), `deck` (`MailTile` at `desk` index 8), `sections` (`PostaSection` in `messages`, `fill: true`), `todayItems` (`useMailTodayLines`), and `records` (`mailMessages`). Italian copy lives in `copy.ts`.

- `live.ts` keeps the full 100-row listing in internal `MailSnapshot.window` for notification identity checks; `router.ts` strips it for both PC and paired clients. Never restore a sender-date watermark: future or delayed mail must not suppress new IDs.
