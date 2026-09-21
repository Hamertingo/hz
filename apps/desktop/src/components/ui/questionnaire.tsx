import type * as React from "react"
import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire"

import { cn } from "@/lib/utils"
import { buttonVariants, type Button } from "@/components/ui/button"
import { CheckIcon } from "lucide-react"

/// The question card's own primitives, dressed in this app's language.
///
/// **Restated rather than inherited.** These are shadcn's stock wrappers, and
/// their defaults speak a vocabulary this app does not have — `border-input`,
/// `bg-primary`, `ring-ring`, a 44px touch floor and a radius of their own. One
/// card drawn in that language beside a transcript drawn in this one reads as a
/// component from somewhere else, which is what a reader sees before they see
/// anything it says. So every class here is a token from [DESIGN.md](../../DESIGN.md):
/// the same radius rungs, the same `--border`, the same `--sidebar-accent` hover
/// the sidebar's own rows take.
///
/// Nothing structural changed — the data slots, the parts and the shortcuts are
/// the primitive's, and the behaviour that reads them is untouched.

function Questionnaire({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
  return (
    <QuestionnairePrimitive.Root
      data-slot="questionnaire"
      className={cn("flex w-full min-w-0 flex-col gap-2.5", className)}
      {...props}
    />
  )
}

function QuestionnaireProgress({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      className={cn(
        "min-h-[1lh] w-fit text-xs font-medium text-muted-foreground tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function QuestionnaireItem({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
  return (
    <QuestionnairePrimitive.Item
      data-slot="questionnaire-item"
      className={cn("flex min-w-0 flex-col gap-1 border-0 p-0 outline-none", className)}
      {...props}
    />
  )
}

function QuestionnaireTitle({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
  return (
    <QuestionnairePrimitive.Title
      data-slot="questionnaire-title"
      // `text-ui` rather than a heading size: this card sits against the
      // composer it is answered into, and a heading here is the loudest thing in
      // a column that is otherwise the reader's own words at that size.
      className={cn("px-2 text-ui leading-snug font-medium text-pretty", className)}
      {...props}
    />
  )
}

function QuestionnaireChoices({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
  return (
    <QuestionnairePrimitive.Choices
      data-slot="questionnaire-choices"
      // `gap-px` rather than a gap between boxes: these are rows of one list —
      // the shape the sidebar's own rows take — not a stack of cards.
      className={cn("group/questionnaire-choices grid min-w-0 gap-px", className)}
      {...props}
    />
  )
}

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/questionnaire-choice relative flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-ui text-start transition-colors outline-none select-none",
        // The one hover and the one focus ring every row in this app takes.
        "hover:bg-sidebar-accent/50 data-checked:bg-sidebar-accent/50 has-[>input:focus-visible]:bg-sidebar-accent/50 has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-sidebar-ring",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <QuestionnairePrimitive.ChoiceInput
        data-slot="questionnaire-choice-input"
        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        data-slot="questionnaire-choice-indicator"
        // The mark is neutral until it is picked, then it is the foreground —
        // not an accent. A colour here would say the *app* has an opinion about
        // the answer, which is the one thing a question must not say.
        className="pointer-events-none relative flex size-3.5 shrink-0 translate-y-[--spacing(0.4)] items-center justify-center rounded-[3px] border border-border group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-foreground group-data-checked/questionnaire-choice:bg-foreground group-data-checked/questionnaire-choice:text-background"
      >
        <span
          data-slot="questionnaire-choice-indicator-dot"
          className="hidden size-1.5 rounded-full bg-background group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
        />
        <CheckIcon
          data-slot="questionnaire-choice-indicator-check"
          className="hidden size-2.5 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
        />
      </span>
      <QuestionnairePrimitive.ChoiceLabel
        data-slot="questionnaire-choice-label"
        className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug"
      >
        {children}
      </QuestionnairePrimitive.ChoiceLabel>
      <QuestionnairePrimitive.ChoiceShortcut
        data-slot="questionnaire-choice-shortcut"
        className="pointer-events-none ms-auto hidden size-4 shrink-0 translate-y-[--spacing(0.4)] items-center justify-center rounded-sm border border-border bg-background font-mono text-[0.625rem] leading-none font-medium text-muted-foreground group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[shortcut]/questionnaire-choice:inline-flex"
      />
    </QuestionnairePrimitive.Choice>
  )
}

function QuestionnaireChoiceDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="questionnaire-choice-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0"
    >
      <QuestionnairePrimitive.Input
        data-slot="questionnaire-input"
        className={cn(
          "w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1.5 text-ui transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function QuestionnaireActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="questionnaire-actions"
      // A plain row. The stock part is a three-column grid sized by its tracks,
      // which is a fixed height for a set of buttons mostly hidden — only ever
      // two of Previous, Next, Skip and Send are up at once.
      className={cn("flex w-full min-w-0 items-center justify-end gap-1.5", className)}
      {...props}
    />
  )
}

function QuestionnairePrevious({
  children,
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Previous
      data-slot="questionnaire-previous"
      data-size={size}
      data-variant={variant}
      className={cn(buttonVariants({ size, variant }), "me-auto", className)}
      {...props}
    >
      {children ?? "Back"}
    </QuestionnairePrimitive.Previous>
  )
}

function QuestionnaireSkip({
  children,
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Skip
      data-slot="questionnaire-skip"
      data-size={size}
      data-variant={variant}
      className={cn(buttonVariants({ size, variant }), className)}
      {...props}
    >
      {children ?? "Skip"}
    </QuestionnairePrimitive.Skip>
  )
}

function QuestionnaireNext({
  children,
  className,
  size = "sm",
  variant = "secondary",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Next
      data-slot="questionnaire-next"
      data-size={size}
      data-variant={variant}
      className={cn(buttonVariants({ size, variant }), className)}
      {...props}
    >
      {children ?? "Next"}
    </QuestionnairePrimitive.Next>
  )
}

function QuestionnaireSubmit({
  children,
  className,
  size = "sm",
  variant = "secondary",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return (
    <QuestionnairePrimitive.Submit
      data-slot="questionnaire-submit"
      data-size={size}
      data-variant={variant}
      className={cn(buttonVariants({ size, variant }), className)}
      {...props}
    >
      {children ?? "Submit"}
    </QuestionnairePrimitive.Submit>
  )
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
}
