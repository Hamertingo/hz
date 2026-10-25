# UI reference: an agent workspace in the Slack mould

Four screenshots the reader shared on 2026-10-23, of another product (a workspace
where each agent is a teammate in a chat). They are the target look for hz's agent
chat. Ideas and layout only; nothing here is code to copy. The files:

1. [agentes-chat-1.webp](agentes-chat-1.webp) — a finished reply, Portuguese UI.
2. [agentes-chat-2.webp](agentes-chat-2.webp) — the same agent mid-task.
3. [agentes-chat-3.webp](agentes-chat-3.webp) — English UI, a reply that made a file.
4. [agentes-chat-4.webp](agentes-chat-4.webp) — an agent's profile page.

## What is in them

**Sidebar (1, 3).** A workspace card on top (name, "1 member · 4 agents", a chevron
and a search button). Under it a "Go to… ⌘K" field and a collapse toggle. Then plain
nav rows: Approvals, Threads or Issues, Tasks or Routines, Calendar, Forum, Wiki,
Drive, Members, with the rare ones folded under "More". Two sections: **Channels**
(`# general`, with a + on the heading) and **Agents**. An agent row is a face, the
name, and its **role in muted text at the right edge** (Dev, Marketing, PM, QA). The
open one has a filled row. A **Create agent** button closes the list. At the very
bottom, the person: avatar, name, a thin usage bar or "US$ 0.38 this month", and a
settings icon.

**Chat (1, 3).** Not bubbles. Every message, the reader's and the agent's, is a row:
a face on the left, **name in bold and the time** on one line, the text under it,
all left-aligned in one wide column. Replies are real Markdown (numbered lists, bold,
tables). A seen mark sits at the far right of the reader's own line. Hovering a
message shows a small floating bar at its right: emoji, reply, thumbs up, thumbs
down, edit, more. Under an agent's reply is a quiet chip, **"See what it did"**,
which opens the tool trace. Files the agent made are a card: title, "File · made by
Rick", a version tag (`v1`) and the attachment with its size.

**Header (1, 3).** The agent's face and name, then one muted line: role, who it
answers to, the CLI and model, and the machine ("Dev · answers to Wesley · Claude
Haiku 5.5"). A **View profile** button at the right.

**Working (2).** The agent's line reads "Leo · in progress" with the time. Under it a
checklist of steps, finished ones ticked ("Used the browser" three times) and the
live one animated ("Using the browser…"). When it is driving a browser, an embedded
card shows the page, the list of actions ("Opened a page", "Read the page",
"Clicked", "Filled a field") and two controls: **Take over** and stop. In the sidebar
the agent's row swaps its role for a **"working" pill**. Above the composer, a
floating pill: "Leo is working… · In the browser" with a stop button.

**Composer (1, 3).** A single card. Placeholder "Message Leo". Along its bottom: a
**chip with the recipient** (Leo), then a formatting row: bold, italic, strike,
code, code block, link, bullet list, numbered list, quote, emoji, attach; send at the
right. A small line under the card states the safety rule that applies ("Rick reads
this channel. Merge, deploy and rollback always ask for your approval.").

**Profile page (4).** A banner of dithered pixel art in the agent's colour, the big
face overlapping its lower edge, the name, and "Dev · model · Owner: Wesley". Buttons:
**Chat**, **Appearance**, and a more menu. Under it a list of sections, each with a
heading, a sentence about what it holds and an **Edit** link:

- *How Rick works* — the instructions, with the note that the workspace context goes
  before them in every conversation.
- *What Rick knows* — its knowledge and memory.
- *Model and key* — the model and which key it uses.
- *Owner* — who gets the budget alerts and approves sensitive actions.
- *Who can talk to Rick* — everyone, or a list; people not on it get no reply; who
  may change it.
- *What Rick can do* — its permissions.

## What it asks of hz, in order

1. Sidebar: workspace block, "Go to…" field, role label on each agent row, a
   "working" pill, a Create agent button, a person card with usage.
2. Chat as message rows with a face, name and time for both sides; a hover bar; a
   "See what it did" chip; file cards for what the agent wrote.
3. Composer: recipient chip, formatting row, a line for the safety rule.
4. Profile page: banner, face, section list with explanations. hz keeps editing in
   place and saving by itself instead of an Edit link per section.
5. Later: a live "in progress" checklist, an agent's own browser card with Take
   over, a floating "is working… · where" pill, an Approvals entry, a Members entry.

What hz has already, so it is not repeated: persistent agents, the agent pane with
settings, memory and team, messages between agents drawn as one line, a greeting on
creation, hidden tool trace under "Worked for".
