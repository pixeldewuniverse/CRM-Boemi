/** Client-safe lists for the criteria editor (no Node imports here). */
import type { Operator } from "./core";

/** Fields a rule may use (shown in Master Data). */
export const RULE_FIELDS = [
  { value: "segment", label: "Segment" },
  { value: "city", label: "City" },
  { value: "region", label: "Region / province" },
  { value: "source", label: "Lead source" },
  { value: "marketingConsent", label: "Marketing consent" },
  { value: "contacts.isDecisionMaker", label: "Decision maker reached (accounts)" },
  { value: "interests.expectedVolume", label: "Interest: expected volume (Rp)" },
  { value: "interests.journey.takeHomePreference", label: "Interest: journey take-home product" },
] as const;

export const OPERATORS: Record<Operator, string> = {
  equals: "equals",
  not_equals: "is not",
  in: "is one of",
  gte: "≥",
  lte: "≤",
  contains: "contains",
  exists: "is filled in",
};

