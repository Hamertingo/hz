import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import QuestionRequest from "@/components/chat/QuestionRequest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { QuestionAnswer } from "@/lib/questionnaire";
import type { Question } from "@/types/events";
import "./App.css";

/// The card the agent blocks on, with the harness faked out.
///
/// It exists to answer the shapes a live agent will not produce on demand: the
/// `Other` row beside options, a step the agent refuses to skip, a question that
/// is nothing but a box, and enough steps for the chip strip to draw. Delete the
/// page once it has answered.
const CASES: { title: string; questions: Question[] }[] = [
  {
    title: "One required question with an Other row — Skip is absent",
    questions: [
      {
        id: "package_manager",
        question: "Which package manager should the release script call?",
        header: null,
        required: true,
        multiSelect: false,
        options: [
          { value: "pnpm", label: "pnpm", description: "What the repo already uses.", preview: null },
          { value: "npm", label: "npm", description: null, preview: null },
        ],
        freeText: true,
        otherPlaceholder: "Another package manager",
      },
    ],
  },
  {
    title: "Three steps — the chips, a multi-select, and a required closed list",
    questions: [
      {
        id: "checks",
        question: "Which checks should run on push?",
        header: null,
        required: false,
        multiSelect: true,
        options: [
          { value: "cargo-test", label: "cargo test", description: "Rust tests.", preview: null },
          { value: "tsc", label: "tsc", description: "Type check.", preview: null },
          { value: "vitest", label: "vitest", description: null, preview: null },
        ],
        freeText: true,
        otherPlaceholder: "Something CI runs that isn't on this list",
      },
      {
        // No other-field was allocated to this step, which is what puts it in
        // the agent's `required[]` — the one shape the app can be sure about.
        id: "indentation",
        question: "Tabs or spaces?\nThe repo is inconsistent below apps/web.",
        header: null,
        required: true,
        multiSelect: false,
        options: [
          { value: "spaces", label: "Spaces", description: "Two.", preview: "const a = {\n  b: 1,\n}" },
          { value: "tabs", label: "Tabs", description: null, preview: "const a = {\n\tb: 1,\n}" },
        ],
        freeText: false,
        otherPlaceholder: null,
      },
      {
        id: "worktree",
        question: "Name the worktree.",
        header: null,
        required: false,
        multiSelect: false,
        options: [],
        freeText: true,
        otherPlaceholder: "release-scripts",
      },
    ],
  },
];

function Demo() {
  // Remounting on a key is the point: the card is one-shot, so answering it once
  // leaves nothing to look at.
  const [round, setRound] = useState(0);
  const [answers, setAnswers] = useState<QuestionAnswer[] | null>(null);
  const [cancelled, setCancelled] = useState<string | null>(null);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="flex flex-col gap-10">
          {CASES.map((demo) => (
            <section key={demo.title} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">{demo.title}</h2>
              <QuestionRequest
                key={`${demo.title}:${round}`}
                questions={demo.questions}
                onAnswer={setAnswers}
                onCancel={() => setCancelled(demo.title)}
              />
            </section>
          ))}
        </div>

        {/* What the card sends, since that is half of what it does — and the one
            thing that cannot be read off the screen. */}
        <pre className="mt-10 rounded-lg border border-border p-3 font-mono text-xs">
          {answers ? JSON.stringify(answers, null, 2) : "no answer sent yet"}
          {cancelled ? `\ncancelled: ${cancelled}` : ""}
        </pre>

        <button
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm"
          onClick={() => {
            setAnswers(null);
            setCancelled(null);
            setRound((n) => n + 1);
          }}
        >
          Reset cards
        </button>
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
