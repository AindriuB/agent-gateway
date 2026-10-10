# Tool categories and default policy

Every tool must declare its real category. Policy, rate limits, approvals and
audit depend on it. Registration refuses missing or unknown categories;
dispatch fails closed for an unknown category. A misleading category is an
author's breach of trust: the core cannot infer arbitrary handler side effects.

| Category      | Use for                                                           | Default player-agent world policy | Default GM-agent world policy |
| ------------- | ----------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| `read`        | Read permitted data or calculate without changing the world       | Allow                             | Allow                         |
| `write`       | Create or update world data                                       | Ask owner                         | Ask owner                     |
| `destructive` | Delete data or perform an operation with destructive consequences | Ask GM                            | Ask owner                     |
| `code`        | Execute software code, including generated macros                 | Ask GM                            | Ask owner                     |

These defaults come from `module/src/policy/matrix.ts`. World policy is the
ceiling; owner policy may tighten it. The default owner matrix allows read,
write and destructive calls within that ceiling and asks the owner for code.
A stricter policy can deny any category. `code` is never automatically allowed;
matrices containing `code: allow` are invalid. Approval in an AI client does
not replace Foundry's approval stage or the document's own permission checks.

`hello-dice_odds` is `read` because it only calculates probabilities.
`hello-journal_stamp` is `write` because it changes journal page content.
Do not label a mutating tool `read` to avoid an approval prompt.
