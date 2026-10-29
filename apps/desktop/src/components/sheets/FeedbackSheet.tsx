import { useEffect, useState } from "react";

import { Chip } from "@/components/kit/kit";
import Modal, { Hint } from "@/components/sheets/Modal";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const KINDS = ["Idea", "Bug", "Other"] as const;
export type FeedbackKind = (typeof KINDS)[number];

/// A note to the people who make hz. Nothing is attached but what is typed, and sending is the caller's:
/// the sheet hands back the kind and the text.
export default function FeedbackSheet({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (note: { kind: FeedbackKind; text: string }) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<FeedbackKind>("Idea");
  useEffect(() => {
    if (open) {
      setText("");
      setKind("Idea");
    }
  }, [open]);
  const ready = text.trim().length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Send feedback"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="solid"
            disabled={!ready}
            onClick={() => {
              onSend({ kind, text: text.trim() });
              onOpenChange(false);
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <label className="mt-0.5 mb-[7px] block px-0.5 text-xs font-medium text-ink3" htmlFor="fb-text">
        What would make hz better?
      </label>
      <textarea
        id="fb-text"
        autoFocus
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="An idea, something that broke, anything"
        className={cn(fieldClassName, "resize-none leading-[1.55]")}
      />
      <div className="mt-2.5 flex gap-1.5">
        {KINDS.map((k) => (
          <Chip key={k} onClick={() => setKind(k)} className={cn(k === kind && "bg-s3 text-ink shadow-[inset_0_0_0_1px_var(--line3)]")}>
            {k}
          </Chip>
        ))}
      </div>
      <Hint>We read every note. Nothing from your chats is attached unless you paste it.</Hint>
    </Modal>
  );
}
