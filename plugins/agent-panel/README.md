<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/lockup-on-dark.svg">
  <img src="assets/lockup.svg" alt="Agent Panel" width="330">
</picture>

Agent Panel is a Claude Code plugin. It sends one question or one task to a group of Claude subagents. Each subagent uses the model and the effort level that you select. Claude then examines their answers and writes one result on a web page.

```
/panel opus:xhigh sonnet:high opus:high:contrarian -- Why is the feed query slow?
/pingpong opus:xhigh sonnet:high rounds=2 -- Plan the billing migration
/panel review brief=bughunt -- the retry changes on this branch
```

## Terms

| Term | Meaning |
| --- | --- |
| Run | One panel or one ping-pong, from the start to the result. |
| Panel | A run that you start with `/panel`. All seats answer the same question. |
| Ping-pong | A run that you start with `/pingpong`. Two seats make a plan together. |
| Seat | One subagent in a run. A seat has a model, an effort level and, optionally, skills. |
| Round | One step in which each seat writes an answer. |
| Synthesis | The one answer that Claude makes from the answers of all seats. |
| Verdict | The result that Claude records on the page: the synthesis of a panel, or the summary of a plan. |
| Preset | A set of seats and options, saved with a name. |
| Brief | Review instructions that all seats in a panel use. |
| Pane | The live view of runs in the Claude Code terminal. |
| Page | The HTML file that shows a run and its verdict. |

## Install

Do these steps in a Claude Code terminal session:

1. Type this command:

   ```
   /plugin install agent-panel --marketplace koomai/claude-kit
   ```

2. Type `y` to add the marketplace.
3. Select a scope.

The plugin needs only Claude Code.

## Instructions for Claude

This section is for Claude. If a user asks you to install this plugin or to explain it, do the steps in this section.

### Install the plugin

1. Run this command in the shell:

   ```
   claude plugin install agent-panel --marketplace koomai/claude-kit --scope user
   ```

   For one project only, use `--scope project`. The command adds the marketplace if it is not added yet.
2. Make sure that the command shows no error. If it shows an error, stop and give the error to the user.
3. Tell the user to restart Claude Code. The commands and tools are available only after the restart.

### Learn the commands

1. Read the sections of this README from "How a run works" to "Presets".
2. Tell the user to type `/panel help`. The help output comes into your context. It shows the current options, the presets and the briefs of this user, which can be different from this README.
3. Explain the commands to the user. Start with these three examples, and change them to the work of the user:

   ```
   /panel -- <a question about their code>
   /panel review brief=bughunt -- <the changes on their branch>
   /pingpong -- <a task that needs a plan>
   ```

4. Tell the user that seats are read-only, and that each round runs all seats again.

### Start a run for the user

You cannot type slash commands. To start a run, use the tools of the plugin:

| Tool | Required field | Optional fields |
| --- | --- | --- |
| `panel` | `question` | `seats`, `preset`, `rounds`, `brief` |
| `pingpong` | `task` | `seats` (two), `preset`, `rounds` |

Write the question or the task so that a seat can understand it without this conversation. Include the file paths and the facts that the seats need. Set `rounds` above 1 only when the user asks for a discussion.

The tool returns at once. The answers come later as a new message. That message tells you what to do next: examine the claims, then record the verdict with the `verdict` tool. For a ping-pong, merge the two plans first and give the merged plan to `pingpong_merge`.

## How a run works

1. You start a run with `/panel` or `/pingpong`. You can also ask Claude in plain English, for example "get an agent panel on this".
2. Each seat starts as a subagent in the background. To see the progress of each seat, type `/panel-view`.
3. When all seats are done, their answers come into the session as a new message.
4. Claude examines the claims in the answers against the code.
5. For a panel, Claude writes the synthesis. For a ping-pong, Claude merges the two plans and starts the challenge rounds.
6. Claude records the verdict on the page of the run. Then Claude gives you a link to the page.

Seats are read-only. A seat can use only these tools: Read, Grep, Glob, WebFetch, WebSearch and a git tool. The git tool can only do `status`, `diff`, `log`, `show` and `blame`. A seat cannot change files or run commands.

## Commands

| Command | What it does |
| --- | --- |
| `/panel` | Starts a panel. All seats answer the same question without seeing the other answers. Then Claude writes the synthesis. With `rounds=N`, the seats also read and reply to the other answers before the synthesis. |
| `/pingpong` | Starts a ping-pong. Two seats each write a plan, and Claude merges the two plans. Then, in each round, seat A challenges the plan and seat B changes it. |
| `/panel-preset` | Saves, lists, shows and deletes presets. It also lists the skills in your skill folders. |
| `/panel-stop` | Stops a run after the current round. Without a run ID, it stops the newest run. To stop a different run, type `/panel-stop <run id>`. |
| `/panel-view` | Opens the pane. |
| `/panel-design` | Shows which design files the page uses. `/panel-design copy` makes a copy that you can change. |

To see all options, presets and briefs, type `/panel help`, `/pingpong help` or `/panel-preset help`.

### Options

Put the seats and options before `--`. Put the question or the task after `--`. Without `--`, the plugin starts nothing and shows the help. Thus a typo, for example `/panel hep`, cannot start a run.

| Option | Commands | What it does |
| --- | --- | --- |
| `rounds=N` | both | Sets the number of rounds, from 1 to 5. The default is 1. For a panel, the number includes the first round. For a ping-pong, it is the number of challenge rounds. |
| `brief=name` | `/panel` | All seats use this brief. |
| `skills=dir[,dir]` | both | The plugin looks for `+skill` names in these folders first. |
| `as=name` | both | Saves the seats and options of this run as a preset with this name. |

## Seats

Write a seat as `model:effort[:contrarian][+skill]`. The parts in square brackets are optional.

| Part | Values | What it does |
| --- | --- | --- |
| `model` | `opus`, `sonnet`, `haiku`, `fable` | The Claude model of the seat. |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max` | How much the seat thinks before it answers. |
| `:contrarian` | none | The seat argues against the obvious answer, or it answers PASS. In a discussion, it attacks the position that the other seats agree on. |
| `+skill` | a skill name | The seat gets the full instructions of the skill before it starts. To add more skills, add more `+skill` parts. |

If you do not give seats, `/panel` uses the `quick` preset and `/pingpong` uses the `duo` preset.

### Skills

The plugin looks for a `+name` skill in these places, in this order:

1. The folders in `skills=<folder>[,<folder>]` on the command, or the folders in the preset.
2. The folders in the "Default skill folders" setting.
3. The skills of the session, by the name that `/skills` shows. Examples: `+laravel-php-standards`, `+plugin:skill`.

A skill folder must directly contain `<name>/SKILL.md`. Thus, give the folder above the skills. For example, for `~/skills/marketing/ads/SKILL.md`, give `~/skills/marketing`. To see the skills in your folders, type `/panel-preset skills [filter]`.

The plugin reads the skill file and removes its frontmatter. Then the plugin gives the text to the seat, together with the base folder of the skill. Thus, the seat can open the `references/` files of the skill.

A seat with a skill is still read-only:

- If the skill tells the seat to ask the user, the seat writes its assumption.
- If the skill tells the seat to change files or run commands, the seat recommends the change.
- The plugin does not apply frontmatter such as `allowed-tools` and `context` to skills from folders. `/panel-preset skills` marks the skills that have this frontmatter.

If the plugin cannot find a skill, the start message shows a warning and the nearest names. The run continues.

## Briefs

A brief gives all seats the same review instructions and the same answer format. Add `brief=<name>` to `/panel`. After `--`, tell the seats what to review.

The plugin has four briefs: [`bughunt`, `security`, `regression` and `contracts`](briefs). A brief is a Markdown file. The first line of the file tells what the brief looks for.

The plugin uses the first brief that it finds, in this order:

1. `.claude/agent-panel/briefs/<name>.md` in the project.
2. `~/.claude/agent-panel/briefs/<name>.md`.
3. The briefs of the plugin.

## Discussion rounds

```
/panel content-council rounds=2 -- Critique the home page redesign
```

In the first round, each seat answers without seeing the other answers. Each round after the first is a reply round. Thus, `rounds=2` gives one reply round.

In a reply round, each seat reads the latest answers of the other seats. The plugin identifies the other seats by number and skills, never by model. Each seat then writes these parts:

- What it changes, and what it examined.
- What it still does not agree with.
- What all the answers missed.
- Its full position.

A seat must change its position only because of evidence. The number of seats that agree is not evidence.

The plugin continues each seat with its earlier work. If the plugin cannot continue a seat, it starts the seat again. The new seat gets the question, its last answer and the answers of the other seats.

If a seat has nothing to change, it answers `NO CHANGE`. If no seat changes anything in a round, the discussion stops. The discussion also stops after the current round in these conditions:

- You type `/panel-stop`.
- You interrupt a seat.

The synthesis includes all rounds. It tells which seat changed its position, because of which argument, and if the evidence is correct.

Each reply round runs all seats again. The start message shows the maximum number of seat runs.

## Ping-pong planning

```
/pingpong opus:xhigh sonnet:high rounds=2 -- Plan the billing migration
```

A ping-pong has two seats:

- Seat A is the challenger. It is the first seat on the command.
- Seat B is the integrator. It is the second seat on the command.

A ping-pong has these steps:

1. Seat A and seat B each write a plan. Each seat does not see the other plan.
2. Claude merges the two plans into one plan.
3. In each round, seat A challenges the plan. Then seat B changes the plan for each correction that the evidence supports. Seat B also tells which corrections it rejected, and why.
4. If seat A has no important correction, it answers PASS. The rounds then stop.
5. Claude examines the final plan and records a summary. The summary gives the plan in brief, the changes from the rounds and the decisions that are still open.

The plugin continues each seat with its earlier work: seat A challenges with what it learned while it wrote its plan, and seat B changes the plan with what it learned while it wrote its own. If the plugin cannot continue a seat, it starts the seat again with the full plan and the challenge.

The default is 1 round. The maximum is 5 rounds.

## The pane

To open the pane, type `/panel-view`. The pane shows one card for each run. A card shows the current step of the run. For each seat, the card shows:

- Its status.
- Its time.
- The number of tokens that it used, under its time. The number grows while the seat works.
- The text that it writes now.

The card of the newest run has a link to its page: "Open the discussion page" or "Open the plan page". Each earlier run is a row. Click a row to open the page of that run.

The `≡ text` control at the top of the pane sets the number of lines of live text for each seat.

## The discussion page

Each `/panel` run also writes a page, `discussion.html`, in its run folder. The plugin writes the page again each time a seat replies. If the page is open during the run, it loads again when a new reply arrives.

The page shows these parts, in this order:

1. The question.
2. The headline of the verdict, after Claude records it.
3. What each seat did in each round.
4. The discussion, round by round. The page divides each reply into its labelled parts. Each reply links to the seats that it answers.

Two controls change how the discussion shows:

- "Positions only" hides the evidence and the risks. To show them for one reply, click its "Show …" button.
- "Side by side" shows one column for each seat.

When you scroll an answer, the round and the name of the seat stay on the screen. In a wide window, an outline of the page stays on the right. The outline marks your position on the page.

### The plan page

A `/pingpong` run writes the same file as a plan page. The page starts with the current plan. When the run ends, this plan is the final plan. Below the plan, the page shows how the plan was made:

1. The two first plans.
2. The merged plan.
3. For each round, the challenge and the corrections that seat B rejected.

The first plans and the old plans are closed. Click one to open it.

### The verdict

When the run ends, Claude records the verdict on the page with the `verdict` tool. Then Claude gives you the link in the chat.

Claude can add up to two figures below the headline. Claude adds a figure only when a picture shows something better than text, for example a sequence of steps.

The page does not need an internet connection. To get a claude.ai link, tell Claude to publish the page of the run. For this purpose, the plugin keeps a copy of the page, `discussion.artifact.html`, in the run folder.

### History

Each page shows a history of the saved runs of the project. In a wide window, the history is a column on the left. In a narrow window, it is a list below the page. Each entry shows the question of a run and, when available, its headline. Click an entry to open the page of that run.

The plugin makes the history on the first run in a project. At that time, it also makes a page for each earlier run that has no page. It makes these pages from the saved answers.

## Page design

One file controls how the page looks and how Claude writes on it: [`page/design.md`](page/design.md). The file has these parts:

| Part | What it controls |
| --- | --- |
| Frontmatter | The design tokens: colours, the two font stacks, text sizes and column widths. Each token becomes a CSS variable on the page. `webfonts` is the URL of the font stylesheet. |
| "Writing" | The writing rules that Claude gets when it records a verdict. |
| "Illustrations" | When Claude draws a figure, and how. Make this section empty to stop all figures. |
| "Styles" | CSS that the plugin adds after its own stylesheet. |

To change the design, do these steps:

1. Type `/panel-design copy`. This command writes a copy of the file to `~/.claude/agent-panel/design.md`. For a copy in this project only, type `/panel-design copy project`.
2. Edit the copy.
3. Delete the parts that you do not change. These parts then continue to use the design of the plugin.
4. Start a run, or open a page from the pane. The plugin then draws all saved pages again with the new design.

The plugin reads the design files in this order: its own file, your file, then the project file. A later file replaces only the keys and sections that it contains. Thus, this short file is a complete design file:

```markdown
---
accent: #8a3b12
sheet: #fbf7ef
---
```

Claude writes each figure as an SVG. The plugin keeps only the drawing elements and attributes. Thus, a figure cannot run a script, load a file or link to a different page.

The design file cannot change the layout or the behaviour of the page. These stay in the plugin: `hooks/page.ts`, `page/page.css` and `page/page.js`.

## Saved answers and settings

The plugin saves the answer of each seat when it arrives. It also saves the question. For a ping-pong, it also saves each first plan, the merged plan, each challenge and each changed plan. The file names of a discussion include the round, for example `round-2-seat-1-…`. The file `discussion.json` contains the full run and the verdict.

To change a setting, type `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| Runs folder | `~/.claude/agent-panel/runs` | The folder for saved files. It has one folder for each project. Each project folder has one folder for each run. Leave it empty to use the default. |
| Default skill folders | none | Folders that contain `<skill>/SKILL.md`, for example `~/Code/my-skills`. Separate the folders with commas. `+skill` looks in these folders. |

The runs folder has this structure:

```
~/.claude/agent-panel/runs/
  <project>/
    history.js                      the history that each page shows
    2026-10-13-2ed564-<question>/
      question.md
      draft-a-opus-high.md          the plans and rounds of a ping-pong,
      round-1-challenge.md          or one file for each seat and round of a panel
      discussion.json               the full run and the verdict
      discussion.html               the page
      discussion.artifact.html      the copy to publish as a claude.ai link
```

## Presets

The plugin has four presets. They are in [`presets.json`](presets.json):

| Preset | Seats | Used when |
| --- | --- | --- |
| `quick` | `sonnet:medium` `sonnet:low` `haiku:high` | `/panel` has no seats (the default) |
| `duo` | `opus:high` `sonnet:high` | `/pingpong` has no seats (the default) |
| `deep` | `opus:xhigh` `opus:high` `sonnet:high` | you name it |
| `review` | `opus:xhigh` `sonnet:high` `opus:high:contrarian` | you name it |

To save a preset, use one of these methods:

- Type `/panel-preset save <name> <seats>`.
- Add `as=<name>` to a `/panel` or `/pingpong` run. The plugin saves the preset only after the run passes all checks.

Examples:

```
/panel-preset save content-council skills=~/skills/marketing sonnet:high+ads+ad-creative sonnet:high+copywriting opus:high:contrarian+cro
/panel-preset save plan-pair opus:high sonnet:high rounds=2
/panel sonnet:high+copywriting sonnet:high+cro as=copy-pair -- Rewrite the pricing page headline
/panel-preset list
/panel-preset show content-council
/panel-preset delete content-council
```

### Where presets go

| Command | File | Who can use the preset |
| --- | --- | --- |
| `/panel-preset save …` | `~/.claude/agent-panel/presets.json` | You, in all projects. |
| `/panel-preset save … scope=project` | `.claude/agent-panel/presets.json` in the project | All users of the repository, after you commit the file. |

To replace a preset that has the same name, add `force`.

The plugin looks for a preset in this order:

1. The project file.
2. Your user file.
3. The presets of the plugin.

A project file can come from a cloned repository. Thus, the plugin applies two limits to it:

- A project preset cannot replace a preset of the plugin.
- The plugin ignores the `skillDirs` of a project preset.

### The preset file

A preset is a list of seats, or an object:

```json
{
  "plan-pair": { "seats": ["opus:high", "sonnet:high"], "rounds": 2 },
  "bug-review": { "seats": ["opus:high", "sonnet:high", "opus:high:contrarian"], "brief": "bughunt" },
  "content-council": {
    "description": "Marketers on copy, content and paid",
    "skillDirs": ["~/skills/marketing"],
    "seats": ["sonnet:high+ads+ad-creative", "sonnet:high+copywriting", "opus:high:contrarian+cro"]
  }
}
```

These rules apply:

- `brief` applies only when you use the preset with `/panel`.
- `rounds` applies to both commands. For `/panel`, it is the total number of rounds. For `/pingpong`, it is the number of challenge rounds. Thus, `plan-pair` with `/panel` gives one reply round.
- `brief=`, `rounds=` and `skills=` on the command override the preset.
- You can put more than one preset on a command. The plugin adds their seats together. It uses the brief and the rounds of the first preset that sets them.

`/panel help` shows the entries that the plugin ignored and the files that it cannot read. The plugin never writes over a file that it cannot read.

## Asking in plain English

You can also ask Claude in plain English, for example "get an agent panel on this, two Opus and a contrarian". The plugin gives Claude these tools:

| Tool | What it does |
| --- | --- |
| `panel` | Starts a panel. |
| `pingpong` | Starts a ping-pong. |
| `pingpong_merge` | Gives the merged plan back to the ping-pong, which then starts the rounds. |
| `verdict` | Records the verdict on the page. |

## What the plugin does on your machine

### What it writes

The plugin writes only these files:

| File | When |
| --- | --- |
| The run folder in the runs folder (see [Saved answers and settings](#saved-answers-and-settings)): `question.md`, one Markdown file for each answer, `discussion.json`, `discussion.html`, `discussion.rev.js` and `discussion.artifact.html` | When a run starts, when each seat answers, when Claude records the verdict, and when you open an older run from the pane |
| `history.json` and `history.js` in the project folder of the runs folder | When a run starts or ends, when Claude records the verdict, and when you open a page from the pane |
| `~/.claude/agent-panel/presets.json` | When you save or delete a preset, or add `as=<name>` to a run |
| `.claude/agent-panel/presets.json` in the project | When you save or delete a preset with `scope=project` |
| `~/.claude/agent-panel/design.md` or `.claude/agent-panel/design.md` in the project | Only when you type `/panel-design copy` or `/panel-design copy project`, and only if the file does not exist |

The plugin does not write settings files, instruction files such as `CLAUDE.md`, or build and start-up files. The two `.claude/agent-panel/` files in a project are this plugin's own presets and page design, and nothing else reads them.

### What it reads

- The `HOME` environment variable. The plugin uses it only to find `~/.claude/agent-panel/` and to expand `~` in the runs folder and in skill folders. It reads no other environment variable.
- Its presets, briefs and design files in `~/.claude/agent-panel/` and in `.claude/agent-panel/` in the project.
- The `SKILL.md` files in the skill folders that you name with `skills=` or the "Default skill folders" setting.
- The name of the project folder, for the folder name in the runs folder.
- The list of slash commands, to find the session skills that `+skill` can name.

### Which programs it runs

- `git`, with one of `status`, `diff`, `log`, `show` or `blame` and the arguments that a seat gives. This is the `git` tool of the seats, so they can read the history of the code under review. The plugin refuses every other git command, the `--output` option, which writes a file, and the `--ext-diff` and `--textconv` options, which run other programs. It adds `--no-pager`, and `--no-ext-diff` and `--no-textconv`, so that git does not run a diff tool or a text converter from your git configuration.
- `open` on macOS, or `xdg-open` on Linux, with the path of a saved page. The plugin runs it only when you click a run in the pane, to open its page in your browser.

### What it sends, and where

The plugin itself sends nothing over the network. Its seats are Claude subagents, so their requests go to Claude in the same way as any other subagent of your session. A seat can use WebFetch and WebSearch, which reach the web as they do for Claude.

The plugin sends text to two places in your session:

- To its own seats, with `session.send`, to continue a seat in the next round. This text is the next brief: the question or plan, and the answers or challenge of the other seat.
- To the main chat, as a prompt that Claude answers. The plugin submits a prompt when both ping-pong drafts are in, and when a run finishes or fails. The prompt contains the question or task, the answers of the seats, and the instructions for the merge, the synthesis or the summary.

### What it gives the agents it starts

Each seat is a subagent of a type that the plugin registers for each model and effort. The type has:

- The seat instructions in `hooks/seats.ts`: work read-only, cite the evidence, and answer in the format that the brief asks for.
- The tools Read, Grep, Glob, WebFetch, WebSearch and the plugin's read-only `git` tool. A seat cannot edit files or run shell commands.
- The default permission mode, and no hooks.
- The session skills that the seat names with `+skill`, preloaded. For a skill from a skill folder, the plugin puts the text of its `SKILL.md` in the seat's prompt.

### What its hooks do

| Hook | What it does |
| --- | --- |
| `session.start` | Registers the commands, the tools and the seat agent types. It passes the event on unchanged. |
| `agent.offer` | Hides the seat agent types from Claude, so that Claude cannot start a seat outside a run. It offers a type only while the plugin itself continues one of its seats. |
| `prompt.submit` | Drops only the task notification that the engine posts when the plugin continues one of its own seats. It passes on every other prompt unchanged. |
| `tool.call` | Records what each seat is doing, for the pane, and passes the call on unchanged. Separate hooks answer every call to the plugin's own tools, `panel`, `pingpong`, `pingpong_merge`, `verdict` and `git`, in place of the tool: the plugin registers these tools, and these hooks are how they run. It never answers a call to any other tool. |
| `turn.step` | Reads the text and thinking of each seat as it streams, and the token count of each step, for the pane. It passes every chunk on unchanged. |
| `turn.complete` | Records the answer of each seat and starts the next step of the run. It passes the result on unchanged. |
| `command.run` | Answers the plugin's own commands: `/panel`, `/pingpong`, `/panel-preset`, `/panel-design`, `/panel-stop` and `/panel-view`. |
| `ui.render` | Draws the output of the plugin's own commands in colour, and draws the pane. |

## Credits

- [counselors](https://github.com/aarondfrancis/counselors) by Aaron Francis gave the panel its ideas: one question sent to several read-only agents at once, rounds in which each agent reads the others, and review presets such as bugs, security, regressions and API contracts.
- [Jam Session](https://jamsession.jamon.dev/) by Jamon Holmgren gave ping-pong planning its shape: two independent drafts, one merged plan, then rounds in which one agent challenges the plan and the other keeps only the corrections that the evidence supports.

## Development

Use these commands from the root of the repository:

```
claude --plugin-dir plugins/agent-panel     start a session with this folder loaded
claude plugin validate plugins/agent-panel  examine the manifest and the hooks
claude plugin test plugins/agent-panel      run the tests in tests/
```

| Path | What it contains |
| --- | --- |
| `hooks/register.tsx` | The commands, the tools, the pane, the run state and the saved files. |
| `hooks/seats.ts` | The parser for seats and options, and all prompts for the seats and for Claude. |
| `hooks/pane.ts` | The content of the pane. |
| `hooks/page.ts`, `page/` | The discussion page and the plan page: markup, stylesheet, script and design file. |
| `hooks/design.ts` | The reader for design files, and the order in which they apply. |
| `hooks/history.ts` | The history of saved runs. |
| `hooks/help.ts` | The colours of the help output. |
| `briefs/`, `presets.json` | The briefs and presets of the plugin. |
