import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek.svg?raw";
import grokIcon from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import hunyuanIcon from "@lobehub/icons-static-svg/icons/hunyuan.svg?raw";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import longcatIcon from "@lobehub/icons-static-svg/icons/longcat.svg?raw";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax.svg?raw";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen.svg?raw";
import xiaomiMimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu.svg?raw";

import { modelLabel, modelSlug } from "@/lib/model";

/// Every `d` in an icon file, in order.
///
/// **The path rather than the file**, and both halves of that matter. Read out of
/// the SVG at build time (`?raw`) instead of inlined as markup, so nothing here
/// is `dangerouslySetInnerHTML` around an asset; and only the geometry, because
/// the mark has to take the colour of the row it sits on — these files are
/// already `fill="currentColor"`, and a mark that carried its own colour would
/// be the one thing on the row that ignored the theme.
///
/// One or two paths per icon, none of them carrying anything but `<path>`: that
/// is what [`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons)
/// ships, and a shape that used a `<circle>` would need the whole file instead.
const pathsOf = (svg: string): string[] =>
  [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1]);

/// A vendor's mark, and what to draw where there is none.
///
/// **Real marks, from the one icon set that has them for models.**
/// [LobeHub's icons](https://github.com/lobehub/lobe-icons) are MIT and drawn
/// for exactly this list — DeepSeek, Kimi, Qwen, Zhipu, Grok, OpenAI, Hunyuan,
/// LongCat — where a general brand set carries almost none of them (Simple Icons
/// has no OpenAI, no Grok, no Zhipu, and no Hunyuan at all). The marks belong to
/// their owners: naming the model you are about to run is what a picker does with
/// them.
///
/// **And a letter where there is none**, which is not a fallback so much as the
/// other half of one rule: a tile in the same place at the same size on every
/// row, carrying a mark where one exists and the vendor's own initial where it
/// does not. Half a list of logos with holes between them reads as missing
/// images; a consistent tile reads as a system.
export type ModelBrand = {
  /// The vendor's own path data, or an empty list — draw
  /// [`initial`](Self::initial) then.
  paths: string[];
  /// What the paths are, for tests and for a reader of a debugger: the icon
  /// file's own name.
  slug: string;
  /// One capital, from the vendor's own name. Empty where there is a mark.
  initial: string;
};

/// Which vendors have a mark, keyed by the prefix their models are named with.
///
/// Matched on the model's *own* name and not on the provider, because the
/// provider here is a gateway: `custom_provider:opencode-go` serves DeepSeek, GLM,
/// Kimi, Qwen and MiniMax through one entry, and every row would then wear the
/// gateway's mark.
///
/// `name` is the vendor's own spelling, which is a different fact from the mark:
/// an id is lowercase (`deepseek-v4.1-flash`, `glm-5.3`) and a label that only
/// capitalises it reads `Deepseek` and `Glm`.
///
/// **`hy`, `muse` and `omen` are absent on purpose.** Nothing here or in the
/// agent's own list says who makes them — the ids are `hy3`,
/// `muse-spark-1.3-contributor` and `omen-alpha`, and the display names repeat
/// them — and a mark is a claim about who serves the model. A letter claims
/// nothing, so that is what those get until somebody can name the vendor.
const BRANDS: { prefix: string; name: string; slug: string; paths: string[] }[] = [
  { prefix: "deepseek", name: "DeepSeek", slug: "deepseek", paths: pathsOf(deepseekIcon) },
  { prefix: "minimax", name: "MiniMax", slug: "minimax", paths: pathsOf(minimaxIcon) },
  { prefix: "kimi", name: "Kimi", slug: "kimi", paths: pathsOf(kimiIcon) },
  { prefix: "qwen", name: "Qwen", slug: "qwen", paths: pathsOf(qwenIcon) },
  // GLM is Zhipu AI's, so the mark is Zhipu's.
  { prefix: "glm", name: "GLM", slug: "zhipu", paths: pathsOf(zhipuIcon) },
  { prefix: "zhipu", name: "GLM", slug: "zhipu", paths: pathsOf(zhipuIcon) },
  { prefix: "grok", name: "Grok", slug: "grok", paths: pathsOf(grokIcon) },
  { prefix: "gpt", name: "GPT", slug: "openai", paths: pathsOf(openaiIcon) },
  { prefix: "longcat", name: "LongCat", slug: "longcat", paths: pathsOf(longcatIcon) },
  // Xiaomi MiMo, which is one icon in the set and spelled `xiaomimimo` — a
  // search for the model's own prefix or for the vendor both miss it.
  { prefix: "mimo", name: "MiMo", slug: "xiaomimimo", paths: pathsOf(xiaomiMimoIcon) },
  // Tencent's, and carried under the id the gateway uses for it.
  { prefix: "hunyuan", name: "Hunyuan", slug: "hunyuan", paths: pathsOf(hunyuanIcon) },
];

/// The mark a model is drawn by.
///
/// Takes whichever the app has — the agent's label or the wire id — and reads the
/// vendor off the model's own name, so a model the agent labels
/// `MiniMax-M2.7 · thinking` and one it spells only as a ref land on the same
/// tile.
export function modelBrand(raw: string): ModelBrand {
  const name = modelSlug(raw).toLowerCase();

  const known = BRANDS.find((brand) => name.startsWith(brand.prefix));
  if (known) return { paths: known.paths, slug: known.slug, initial: "" };

  // The vendor's name is the leading run of letters — `glm-5.3` is GLM, `hy3` is
  // HY, `longcat-2.0` is LongCat. A name that opens with a digit or a capital has
  // no vendor to read, so its own first character stands in rather than nothing.
  const lead = /^[a-z]+/.exec(name)?.[0];
  const initial = (lead ?? name).charAt(0);

  return { paths: [], slug: "", initial: initial ? initial.toUpperCase() : "?" };
}

/// The model's name with its vendor spelled the way the vendor does.
///
/// [`modelLabel`](../lib/model.ts) is the generic one — capitalise each word and
/// stop — and it is what every other caller wants. This adds the one thing it
/// cannot know: `deepseek-v4.1-flash` is DeepSeek's, `glm-5.3` is GLM's, and a
/// vendor's own casing is not something a rule can derive from an id.
export function modelDisplayName(raw: string): string {
  const name = modelSlug(raw);
  const lower = name.toLowerCase();
  const vendor = BRANDS.find((brand) => lower.startsWith(brand.prefix));

  // The vendor's own words plus the rest of the id, prettified: the prefix is
  // consumed rather than left in place, or `DeepSeek v4.1 flash` would still be
  // carrying the id's spelling after the vendor name.
  return vendor
    ? modelLabel(`${vendor.name}${name.slice(vendor.prefix.length)}`)
    : modelLabel(name);
}
