/** How sure Tidybee is that a finding is a real problem. */
export type Confidence = "high" | "medium" | "low";

export type Severity = "error" | "warning" | "info";

/** One thing wrong, or worth knowing, in an instruction file. Lines and columns start at 1. */
export interface Finding {
  rule: string;
  severity: Severity;
  confidence: Confidence;
  /** Path of the instruction file, relative to the repository root, with forward slashes. */
  file: string;
  line: number;
  column: number;
  message: string;
  /** What was looked at, such as the path or the command, so a reader can search for it. */
  subject?: string;
  /** What to do about it, when that is clear. */
  suggestion?: string;
}
