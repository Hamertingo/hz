import { Folder, History, Phone, Pin } from "lucide-react";
import type { ReactNode } from "react";

import Dither from "@/components/Dither";
import { Group, Row } from "@/components/kit/kit";
import Modal from "@/components/sheets/Modal";
import { Button } from "@/components/ui/button";

const ITEMS: { icon: ReactNode; title: string; sub: string }[] = [
  { icon: <Phone />, title: "Call your agents", sub: "Talk it through out loud. A summary lands in the chat when you hang up." },
  { icon: <Pin />, title: "Pins on top", sub: "Up to four conversations sit above the list, one click away." },
  { icon: <Folder />, title: "Folders", sub: "Group conversations and collapse what you don't need today." },
  { icon: <History />, title: "Versions", sub: "Every change to an agent's instructions is saved and can be restored." },
];

/// The release notes as a short list under a pixel field. `version` is the app's, for example "0.21".
export default function WhatsNewSheet({ open, onOpenChange, version }: { open: boolean; onOpenChange: (open: boolean) => void; version: string }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`What's new in hz ${version}`}
      width={480}
      banner={
        <div className="relative h-[110px] shrink-0">
          <Dither color="#a58bfa" seed="whats-new" cols={140} rows={34} />
        </div>
      }
      footer={
        <Button variant="solid" onClick={() => onOpenChange(false)}>
          Got it
        </Button>
      }
    >
      <Group>
        {ITEMS.map((i) => (
          <Row key={i.title} lead={i.icon} title={i.title} sub={i.sub} />
        ))}
      </Group>
    </Modal>
  );
}
