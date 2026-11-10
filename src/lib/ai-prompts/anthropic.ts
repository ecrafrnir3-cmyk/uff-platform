// Models, effort and reply reading shared by every AI call site (the 2026-11-10 model swap; the
// measurements behind each choice are in docs/model-eval-2026-11-10.md). One place to change a model,
// the effort, or how a reply is read.

// Claude Haiku 5.5 is the default for UFF's advisory text: the most accurate and best-voiced of the three
// models measured on ten of the twelve sites, at under a quarter of Haiku 4.5's cost per call.
export const MODEL_HAIKU = "claude-haiku-5-5";
// Claude Sonnet 5.5 for the two long, number-heavy write-ups (power rankings, the newsletter), where
// Haiku 5.5 misread rankings and invented game flow; both run at most a few times a week.
export const MODEL_SONNET = "claude-sonnet-5-5";

// Effort "low": short advisory text gains nothing from long thinking, and thinking counts against
// max_tokens. No temperature, top_p or top_k anywhere: the 5.x models reject non-default sampling values.
export const OUTPUT_LOW = { effort: "low" } as const;

// Every text block of a Messages API reply, joined. The 5.x models can put a thinking block first, and
// the old `content?.[0]?.text` then read nothing from a reply whose text sat in the second block.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function replyText(resData: any): string {
  const blocks: unknown[] = Array.isArray(resData?.content) ? resData.content : [];
  return blocks
    .filter((b): b is { type: "text"; text: string } =>
      !!b && typeof b === "object" &&
      (b as { type?: unknown }).type === "text" &&
      typeof (b as { text?: unknown }).text === "string")
    .map((b) => b.text)
    .join("");
}
