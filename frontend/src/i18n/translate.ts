import { Fragment, createElement, type ReactNode } from "react";
import type { Locale } from "@/types";
import { localeMeta } from "./config";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

type Dict = { [key: string]: string | Dict };
const dictionaries: Record<Locale, Dict> = { fr, en, ar };

export type Vars = Record<string, string | number>;

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const numberFormats = new Map<Locale, Intl.NumberFormat>();

/**
 * Resolves a key, with plurals chosen by Intl.PluralRules: `votes` with
 * { count } looks up `votes_one`, `votes_few`... then `votes_other`. Arabic
 * uses all six CLDR categories (zero, one, two, few, many, other).
 * Missing keys fall back to French, then to the key itself (visible in dev).
 */
function resolve(locale: Locale, key: string, vars?: Vars): string {
  const dict = dictionaries[locale];
  if (vars && typeof vars.count === "number") {
    if (!pluralRules.has(locale)) pluralRules.set(locale, new Intl.PluralRules(localeMeta[locale].intl));
    const category = pluralRules.get(locale)!.select(vars.count);
    const hit = lookup(dict, `${key}_${category}`) ?? lookup(dict, `${key}_other`);
    if (hit) return hit;
  }
  return lookup(dict, key) ?? lookup(dictionaries.fr, key) ?? lookup(dictionaries.fr, `${key}_other`) ?? key;
}

/**
 * Text values are wrapped in Unicode isolates (FSI … PDI): a French question
 * inside an Arabic sentence, or an Arabic name inside an English one, keeps its
 * own direction without reordering the punctuation around it.
 */
const isolate = (s: string) => `\u2068${s}\u2069`;

function formatVar(locale: Locale, value: string | number) {
  if (typeof value !== "number") return isolate(value);
  if (!numberFormats.has(locale)) numberFormats.set(locale, new Intl.NumberFormat(localeMeta[locale].intl));
  return numberFormats.get(locale)!.format(value);
}

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const text = resolve(locale, key, vars);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(formatVar(locale, vars[name])) : m));
}

/**
 * Same as translate, but placeholders can be React nodes
 * (e.g. "By {author}" with a styled username).
 */
export function translateRich(locale: Locale, key: string, vars: Record<string, ReactNode>, count?: number): ReactNode {
  const text = resolve(locale, key, count === undefined ? undefined : { count });
  const parts = text.split(/(\{\w+\})/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (name === "count" && count !== undefined) return formatVar(locale, count);
      return name && name in vars ? createElement(Fragment, { key: i }, vars[name]) : part;
    }),
  );
}

export function hasKey(locale: Locale, key: string) {
  return lookup(dictionaries[locale], key) !== undefined;
}
