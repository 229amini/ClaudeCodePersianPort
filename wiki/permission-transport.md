# Permission transport — SOLVED 2026-08-05

**Verdict: use `--permission-prompt-tool stdio` + inbound `can_use_tool` control requests.**
Verified end to end (allow *and* deny) against `claude` 2.1.221. This replaces the dead
`--settings` PreToolUse hook documented in [permission-hook-broken.md](permission-hook-broken.md).

## The mechanism

Add **one spawn flag**:

```
--permission-prompt-tool stdio
```

The flag is **hidden from `claude --help`** (0 hits across all 234 lines) but is present in the
arg parser — the binary's own help string reads *"MCP tool to use for permission prompts (only
works with --print)"*. Internally `Jpe()` returns `Ft.permissionPromptToolName`; the value
`"stdio"` is what routes permission prompts to the stream-json control protocol instead of to an
MCP tool. **Do not drop this flag** — without it the CLI silently auto-denies in `default` mode and
auto-approves in `auto` mode, with no prompt of any kind.

With the flag set, the CLI sends an **inbound** control request (CLI → client) on stdout whenever a
tool needs approval:

```json
{"type":"control_request","request_id":"08760c7b-…","request":{
  "subtype":"can_use_tool",
  "tool_name":"Write",
  "display_name":"Write",
  "input":{"file_path":"C:\\…\\t.txt","content":"hi\n"},
  "description":"t.txt",
  "permission_suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}],
  "tool_use_id":"toolu_017AXdSwvpe5CwgnQ14KRWhi"}}
```

Answer by writing a `control_response` back on **stdin**, echoing `request_id`:

```json
// allow
{"type":"control_response","response":{"subtype":"success","request_id":"…",
 "response":{"behavior":"allow","updatedInput":{…}}}}

// deny
{"type":"control_response","response":{"subtype":"success","request_id":"…",
 "response":{"behavior":"deny","message":"کاربر اجازه نداد","interrupt":false}}}
```

Both verified. On allow the file was written; on deny it was not, and the assistant reported the
denial in its reply. The Persian `message` survives the round trip.

`updatedInput` is how a client edits the call before allowing (the CLI re-reads it) — echo
`request.input` unchanged when not editing.

## Why this is strictly better than the hook it replaces

It **deletes** the project's single most-documented footgun class:

- `permission_hook.py` — gone. No grandchild process.
- `space_safe()` / the 8.3 short-name conversion (server.py:98–124) — gone. A space in the
  username or install path can no longer silently disable approvals.
- The HTTP callback (`/api/permission/request`), `PCG_ENDPOINT`/`PCG_TOKEN` env plumbing, and the
  110 s-under-120 s timeout dance — all gone.
- The `--settings` file only needs to exist if we want to layer non-hook settings.

Everything happens in-band on the pipe that is already open, ordered with the rest of the stream.

## Payload details worth building on

- **`permission_suggestions`** — the CLI tells us what to offer, e.g.
  `{"type":"setMode","mode":"acceptEdits","destination":"session"}`. This is the honest source for
  a "don't ask again this session" affordance; it replaces the wrapper's hand-rolled
  `session_allow` guesswork with the CLI's own suggestion.
- **`display_name`** and **`description`** — human-facing strings supplied per call
  (`description` was `"t.txt"` for a Write). Use them for the dialog title instead of deriving one.
- **`tool_use_id`** — same id as the stream's `tool_use` block, so the dialog still annotates the
  matching tool card exactly as it does today (app.js:389–393).

## Implementation notes

- The response must go on **stdin**, so the writer must be thread-safe against normal `user`
  message writes — take the same lock `_write_line` uses (server.py:748).
- Requests arrive with a CLI-generated UUID `request_id`; echo it verbatim. Do not reuse the
  wrapper's own `pcg-N` counter for these.
- `_read_stdout` must now distinguish **inbound `control_request`** (answer it) from
  **`control_response`** (resolve our own pending waiter). Two different branches.
- Keep defaulting to **deny** on timeout/error — same policy as the hook had.
- Feature-detect by spawning with the flag and checking the process survives; an unknown flag makes
  the CLI exit immediately, which is easy to detect at startup.

## Still true from the old design

`PermissionBroker`'s shape stays: `AUTO_ALLOW` (server.py:51) as policy rung one, a session-scoped
remember set, SSE publish to the UI, blocking wait for the answer. Only the transport changes.
`bypassPermissions` remains refused by the engine ("disabled by settings") and `auto` is gated, so
the approval pill must still map to wrapper-owned policy rather than to those modes.

## AskUserQuestion rides this same pipe — and is not a permission (2026-08-07)

Measured on claude **2.1.223**, through the running wrapper. When the model calls
`AskUserQuestion`, the CLI does **not** invent a new channel: it sends an ordinary inbound
`can_use_tool` control request with `tool_name: "AskUserQuestion"` and
`input.questions: [{header, question, multiSelect, options:[{label, description}]}]`. So it
arrives in the GUI as `wrapper/permission_request` like any other tool, and before this was
handled the colleague saw a permission dialog full of JSON.

**The answer travels back in the allow reply's `updatedInput`,** under a key the tool schema
documents as *"User answers collected by the permission component"*:

```jsonc
{"behavior": "allow",
 "updatedInput": {"questions": [...],            // echoed unchanged
                  "answers": {"<question text>": "<option label>"}}}
```

The CLI's own validator (read out of the bundle) fixes the shape exactly:

- keyed by the **question text**, not by index and not by header;
- a single choice is the option **label** as a string;
- a multiSelect answer is an **array of labels**, or one string joined with `", "`;
- free text is accepted — it just selects a softer wording of the tool_result
  (*"The user answered: …"* instead of *"Your questions have been answered: …"*). Either way the
  answer reaches the model, so an "other" box is safe to offer.

What comes back is a `user` event whose `tool_use_result` is `{questions, answers}` — note that
this sits on the **event**, not on the `tool_result` part. `part.content` holds only the
model-facing English sentence, so rendering that instead is how a replayed question ends up
showing English prose to a Persian user.

### Three ways this fails silently, all now guarded in `server.py`

1. **Allowing with the input unchanged answers nothing.** `answers` absent (or `{}`) comes back as
   *"The user did not answer the questions."* — cheerful, no error. That is what the first probe
   did, and it is indistinguishable from the user walking away.
2. **The auto-approve posture ate the question.** «خودکار», and any tool remembered through
   «دوباره نپرس», would approve `AskUserQuestion` without ever showing it — the model would then be
   told nobody answered. `ASK_TOOL` is excluded from both silent paths, at the one place in
   `PermissionBroker.request()` they are computed.
3. **`PERMISSION_TIMEOUT` was the only thing killing questions.** The CLI's own
   `askUserQuestionTimeout` setting defaults to **`"never"`**, so it waits forever; 110 s is not
   long enough to read a question and decide. `ASK_TIMEOUT` is 900 s, and on expiry the broker
   **allows with no answers** rather than denying — allow-with-nothing is what the CLI's own Skip
   button sends, where a deny returns an `is_error` tool_result that reads to the model as a
   tool failure.

Verified end to end through the UI on 2026-08-07: a Persian question with three options (two
Persian labels, one Latin) rendered in the dialog, «قهوه» was clicked, and the model replied
«پاسخ شما «قهوه» بود.» Gate coverage is in `spec-test.html` (five `ask:` checks) and
`test_units.py` (four `PermissionBroker` checks).
