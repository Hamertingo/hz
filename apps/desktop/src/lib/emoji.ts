/// The emoji the picker offers, in the groups it lists them under. Short on
/// purpose: a reaction is a quick answer, and a full keyboard is the system's.
export const EMOJI_GROUPS: readonly { label: string; items: readonly string[] }[] = [
  { label: "Quick", items: ["👍", "❤️", "🎉", "😂", "👀", "✅", "🙏", "🔥"] },
  {
    label: "Faces",
    items: ["😀", "😄", "😅", "🙂", "😉", "😊", "😍", "🤔", "😮", "😢", "😭", "😡", "🥳", "😎", "🤝", "🙌"],
  },
  { label: "Work", items: ["✨", "🚀", "🐛", "🔧", "📌", "📎", "📝", "📊", "💡", "⚠️", "❌", "⏳"] },
];

