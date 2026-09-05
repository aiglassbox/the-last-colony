import type { SupportedLang } from "./types";

import DATA from "./ui-strings.data.json";

/**
 * The page chrome — sidebar, composer, footer, history, settings — in the
 * reader's language.
 *
 * The card already follows the reply's language (`card-strings.ts`, the
 * localized record store); everything around it stayed English, so a Bengali
 * answer sat inside an English page. This is the same pattern one level up: a
 * flat English table, translated once per language by `localize:ui` into
 * `ui-strings.data.json` (committed, reviewed data), resolved per key with the
 * English value as the fallback.
 *
 * Which language is decided by the latest finished reply in the thread, not by
 * a setting — the page follows the conversation. `{n}` and `{title}` are
 * placeholders the translation must keep; `fill` substitutes them.
 */

export const EN_UI_STRINGS = {
  // Sidebar
  newChat: "New Chat",
  features: "Features",
  chat: "Chat",
  addRecipe: "Add Recipe",
  history: "History",
  recent: "Recent",
  recentConversations: "Recent conversations",
  recentEmpty: "Nothing yet. Name a dish to begin.",
  others: "Others",
  setting: "Setting",
  expandSidebar: "Expand sidebar",
  collapseSidebar: "Collapse sidebar",
  closeMenu: "Close menu",
  deleteConversation: "Delete conversation: {title}",

  // Shell
  skipToContent: "Skip to content",
  openMenu: "Open menu",
  followUp: "Ask a follow-up…",
  unverifiedNote: "Unverified citations are labelled on the card.",
  requestFailed: "Request failed.",
  lostConnection: "Lost the connection. Try again.",

  // Composer
  nameADish: "Name a dish",
  dictate: "Dictate a dish",
  stopDictation: "Stop dictation",
  stopGenerating: "Stop generating",
  send: "Send",

  // Prose turn
  copy: "Copy",
  copied: "Copied",
  copyReply: "Copy reply",

  // History view
  nothingRestored: "Nothing restored yet.",
  restorationsOne: "1 restoration, kept on this device.",
  restorationsOther: "{n} restorations, kept on this device.",
  newRestoration: "New restoration",
  historyEmpty:
    "Name a dish and the thread will be saved here. Nothing leaves the browser, so " +
    "clearing site data clears the history with it.",
  noAnswerYet: "No answer yet.",
  messagesOne: "1 message",
  messagesOther: "{n} messages",

  // Settings
  settingsTitle: "Settings",
  close: "Close",
  clearHistory: "Clear history",
  clearConfirm: "Delete every conversation, confirm",
  clearNote: "Clearing history removes all the chat on this device and there is no undo.",

  // Restoration card: the fixed lines the record store does not carry
  cardModernNote:
    "There is no older version of this, and we are not going to invent one. Here is what " +
    "is actually in it, and which of those ingredients only reached India in the last few " +
    "centuries.",
  cardSilences: "This source lists the ingredients with {silences}.",
  cardNoQuantities: "no quantities",
  cardNoFunction: "no note on what each ingredient was doing",
  cardAnd: "and",
  cardKeepHeading: "Keep these as the record has them",
  cardNotX: "not {x}",
  cardModernKitchen: "Doing it in a modern kitchen",
  cardKeepX: "Keep {x}",
  cardQuantitiesYours: "The record gives a method but not amounts, so quantities are yours to judge.",

  // Source drawer
  sourceTitle: "Source",
  sourceAuthor: "Author",
  sourcePeriod: "Period",
  sourceRegion: "Region",
  sourceLocus: "Locus",
  sourceEdition: "Edition",
  sourcePage: "Page",
  sourceOriginal: "Original",
  sourceTransliteration: "Transliteration",
  sourceTranslation: "Translation",
  sourceCheckedBy: "Checked by",
  sourceUnverified: "Citation not yet verified",
  sourceUnverifiedNote:
    "Until an editor has read the printed edition, this record shows no verse number, no " +
    "page and no original-language text. What you see above is the text and period only.",
  sourceContested: "Where scholarship is contested",
  sourceConfidence: "Confidence",
  sourceIdentification: "identification",
  sourceIngredients: "ingredients",
  sourceMethod: "method",

  // Indianisation (fusion) card
  fusionPill: "Our own recipe · not a historical one",
  fusionNote:
    "What follows is ours: a dish built out of Indian ingredients, worked out here rather " +
    "than taken from any text.",
  fusionRebuild: "The rebuild",
  fusionCook: "Cook it",

  // Community card: a reader's own family recipe, no corpus record behind it
  communityHeader: "A reader of this site submitted this recipe.",
  communityAttribution: "{name} · {relation} · {place}",
  communityTranslated: "Machine-translated from the original.",
  communityShowOriginal: "Show original",
  communityShowTranslation: "Show translation",
  communityIngredients: "Ingredients",
  communityMethod: "Method",
  communityOtherStates: "Readers have also sent this recipe in from {states}.",
  communityNotRestored: "This is a reader's family recipe, not a restored historical record.",
  communityPhotoAlt: "{dish}, a family recipe from {state}",
};

export type UiStrings = Record<keyof typeof EN_UI_STRINGS, string>;

const TABLE = DATA as Partial<Record<SupportedLang, Partial<UiStrings>>>;

/**
 * The chrome for a language, English per key where a translation is missing.
 * English and an unknown language both get the English table itself.
 */
export function uiStrings(lang: SupportedLang | undefined): UiStrings {
  const t = lang && lang !== "en" ? TABLE[lang] : undefined;
  return t ? { ...EN_UI_STRINGS, ...t } : EN_UI_STRINGS;
}

/** Substitute `{name}` placeholders; an unknown placeholder is left as typed. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
