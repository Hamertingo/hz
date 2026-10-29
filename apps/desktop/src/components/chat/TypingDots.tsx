/// Three dots stepping in turn: the agent has the floor and has not said
/// anything yet.
export default function TypingDots() {
  return (
    <span aria-label="typing" className="inline-flex h-[22px] items-center gap-1">
      {[0, 0.2, 0.4].map((delay) => (
        <i
          key={delay}
          className="size-[5px] animate-[typing-dot_1.2s_steps(1)_infinite] rounded-full bg-ink3"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}
