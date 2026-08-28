import type { Locator, Page } from "playwright";
import { config } from "../config/index.js";

export type ElementKind =
  | "link"
  | "button"
  | "input"
  | "textarea"
  | "select"
  | "tab"
  | "menuitem"
  | "checkbox"
  | "radio";

export interface ElementEntry {
  ref: number;
  kind: ElementKind;
  label: string;
  locator: Locator;
  meta?: Record<string, string>;
}

export interface PageSnapshot {
  text: string;
  entries: ElementEntry[];
}

const INTERACTIVE_ROLES: Array<{ role: Parameters<Page["getByRole"]>[0]; kind: ElementKind }> = [
  { role: "link", kind: "link" },
  { role: "button", kind: "button" },
  { role: "tab", kind: "tab" },
  { role: "menuitem", kind: "menuitem" },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

async function isVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  if (count === 0) {
    return false;
  }

  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

async function describeInput(locator: Locator): Promise<{ label: string; meta: Record<string, string> }> {
  const element = locator.first();
  const tagName = await element.evaluate((node) => node.tagName.toLowerCase());
  const type = (await element.getAttribute("type")) ?? tagName;
  const name = (await element.getAttribute("name")) ?? "";
  const placeholder = (await element.getAttribute("placeholder")) ?? "";
  const ariaLabel = (await element.getAttribute("aria-label")) ?? "";

  let associatedLabel = "";
  try {
    associatedLabel = normalizeWhitespace(await element.evaluate((node) => {
      const htmlInput = node as HTMLInputElement;
      if (htmlInput.labels && htmlInput.labels.length > 0) {
        return htmlInput.labels[0]?.innerText ?? "";
      }

      const id = htmlInput.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        return label?.textContent ?? "";
      }

      return "";
    }));
  } catch {
    associatedLabel = "";
  }

  const label =
    associatedLabel ||
    ariaLabel ||
    placeholder ||
    name ||
    `${tagName} field`;

  return {
    label,
    meta: {
      type,
      ...(placeholder ? { placeholder } : {}),
      ...(name ? { name } : {}),
    },
  };
}

async function collectRoleElements(page: Page, nextRef: { value: number }): Promise<ElementEntry[]> {
  const entries: ElementEntry[] = [];
  const seen = new Set<string>();

  for (const { role, kind } of INTERACTIVE_ROLES) {
    const locator = page.getByRole(role);
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await isVisible(candidate))) {
        continue;
      }

      const name = normalizeWhitespace((await candidate.innerText()) || (await candidate.getAttribute("aria-label")) || "");
      if (!name) {
        continue;
      }

      let href = "";
      if (kind === "link") {
        href = (await candidate.getAttribute("href")) ?? "";
      }

      const dedupeKey = `${kind}:${name}:${href}:${index}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const ref = nextRef.value;
      nextRef.value += 1;

      entries.push({
        ref,
        kind,
        label: name,
        locator: candidate,
        meta: href ? { href } : undefined,
      });
    }
  }

  return entries;
}

async function collectInputs(page: Page, nextRef: { value: number }): Promise<ElementEntry[]> {
  const entries: ElementEntry[] = [];
  const selectors = ['input:not([type="hidden"])', "textarea", "select"];
  const locator = page.locator(selectors.join(","));
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await isVisible(candidate))) {
      continue;
    }

    const tagName = await candidate.evaluate((node) => node.tagName.toLowerCase());
    const inputType = (await candidate.getAttribute("type")) ?? tagName;
    if (inputType === "hidden") {
      continue;
    }

    const { label, meta } = await describeInput(candidate);
    const ref = nextRef.value;
    nextRef.value += 1;

    const kind: ElementKind =
      tagName === "textarea"
        ? "textarea"
        : tagName === "select"
          ? "select"
          : inputType === "checkbox"
            ? "checkbox"
            : inputType === "radio"
              ? "radio"
              : "input";

    entries.push({
      ref,
      kind,
      label,
      locator: candidate,
      meta,
    });
  }

  return entries;
}

async function collectHeadings(page: Page): Promise<string[]> {
  const headings = page.locator("h1, h2, h3, h4, h5, h6");
  const count = await headings.count();
  const results: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const heading = headings.nth(index);
    if (!(await isVisible(heading))) {
      continue;
    }

    const text = normalizeWhitespace(await heading.innerText());
    if (text) {
      results.push(text);
    }
  }

  return results;
}

async function collectVisibleText(page: Page): Promise<string> {
  const text = await page.evaluate(() => {
    const body = document.body;
    if (!body) {
      return "";
    }

    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, svg").forEach((node) => node.remove());
    return clone.innerText ?? "";
  });

  return normalizeWhitespace(text);
}

async function collectIframes(page: Page): Promise<Array<{ title: string; src: string }>> {
  const frames = page.locator("iframe");
  const count = await frames.count();
  const results: Array<{ title: string; src: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const frame = frames.nth(index);
    if (!(await isVisible(frame))) {
      continue;
    }

    results.push({
      title: (await frame.getAttribute("title")) ?? `iframe ${index + 1}`,
      src: (await frame.getAttribute("src")) ?? "",
    });
  }

  return results;
}

function formatEntryLine(entry: ElementEntry): string {
  const metaParts: string[] = [];

  if (entry.meta?.href) {
    metaParts.push(`→ ${entry.meta.href}`);
  }

  if (entry.meta?.type) {
    metaParts.push(`(${entry.meta.type})`);
  }

  if (entry.meta?.placeholder) {
    metaParts.push(`placeholder="${entry.meta.placeholder}"`);
  }

  const suffix = metaParts.length > 0 ? ` ${metaParts.join(" ")}` : "";
  return `[${entry.ref}] ${entry.label}${suffix}`;
}

function groupEntries(entries: ElementEntry[]): Record<string, ElementEntry[]> {
  const groups: Record<string, ElementEntry[]> = {
    LINKS: [],
    BUTTONS: [],
    INPUTS: [],
    OTHER: [],
  };

  for (const entry of entries) {
    if (entry.kind === "link") {
      groups.LINKS.push(entry);
    } else if (entry.kind === "button" || entry.kind === "tab" || entry.kind === "menuitem") {
      groups.BUTTONS.push(entry);
    } else if (
      entry.kind === "input" ||
      entry.kind === "textarea" ||
      entry.kind === "select" ||
      entry.kind === "checkbox" ||
      entry.kind === "radio"
    ) {
      groups.INPUTS.push(entry);
    } else {
      groups.OTHER.push(entry);
    }
  }

  return groups;
}

export async function readPage(page: Page): Promise<PageSnapshot> {
  await page.waitForLoadState("domcontentloaded");

  const title = await page.title();
  const url = page.url();
  const headings = await collectHeadings(page);
  const iframes = await collectIframes(page);
  const visibleText = truncate(await collectVisibleText(page), config.maxTextLength);

  const nextRef = { value: 1 };
  const roleEntries = await collectRoleElements(page, nextRef);
  const inputEntries = await collectInputs(page, nextRef);

  const entries = [...roleEntries, ...inputEntries];
  const groups = groupEntries(entries);

  const lines: string[] = [
    `PAGE: ${title || "(untitled)"}`,
    `URL: ${url}`,
    "",
  ];

  if (headings.length > 0) {
    lines.push("HEADINGS:");
    for (const heading of headings.slice(0, 40)) {
      lines.push(`* ${heading}`);
    }
    lines.push("");
  }

  for (const [groupName, groupEntries] of Object.entries(groups)) {
    if (groupEntries.length === 0) {
      continue;
    }

    lines.push(`${groupName}:`);
    for (const entry of groupEntries.slice(0, 80)) {
      lines.push(formatEntryLine(entry));
    }
    lines.push("");
  }

  if (iframes.length > 0) {
    lines.push("IFRAMES:");
    for (const [index, frame] of iframes.entries()) {
      lines.push(`[iframe ${index + 1}] ${frame.title}${frame.src ? ` → ${frame.src}` : ""}`);
    }
    lines.push("");
  }

  lines.push("TEXT:");
  lines.push(visibleText || "(no visible text)");

  return {
    text: lines.join("\n").trim(),
    entries,
  };
}
