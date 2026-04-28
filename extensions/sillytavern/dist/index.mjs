// ../../packages/extension-sdk/dist/logger.js
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
})(LogLevel || (LogLevel = {}));
var _logLevel = LogLevel.INFO;
function createExtensionLogger(extensionName, tag) {
  const scope = tag ? `${extensionName}:${tag}` : extensionName;
  return {
    debug: (...args) => {
      if (_logLevel <= LogLevel.DEBUG)
        console.debug(`[${scope}]`, ...args);
    },
    info: (...args) => {
      if (_logLevel <= LogLevel.INFO)
        console.log(`[${scope}]`, ...args);
    },
    warn: (...args) => {
      if (_logLevel <= LogLevel.WARN)
        console.warn(`[${scope}]`, ...args);
    },
    error: (...args) => {
      if (_logLevel <= LogLevel.ERROR)
        console.error(`[${scope}]`, ...args);
    }
  };
}

// ../../packages/extension-sdk/dist/plugin/context.js
function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}
function definePlugin(plugin) {
  return plugin;
}
// src/index.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";

// node_modules/fast-tavern/dist/index.js
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
function isGeminiMessages(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && ("role" in x) && ("parts" in x) && Array.isArray(x.parts));
}
function toInternalFromGemini(input) {
  return (input || []).map((m) => {
    if (!("parts" in m)) {
      return { role: String(m.role || "user"), parts: [{ text: String(m.content ?? "") }] };
    }
    return {
      role: String(m.role || "user"),
      ...m.name ? { name: m.name } : {},
      ...typeof m.swipeId === "number" ? { swipeId: m.swipeId } : {},
      parts: (m.parts || []).map((p) => ({ ...p })),
      ...Array.isArray(m.swipes) ? { swipes: m.swipes } : {}
    };
  });
}
function fromInternalToGemini(internal) {
  return internal;
}
function isOpenAIChatMessages(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && ("role" in x) && ("content" in x) && typeof x.content === "string");
}
function toInternalFromOpenAI(input) {
  return (input || []).map((m) => ({
    role: String(m.role || "") === "assistant" ? "model" : String(m.role || "user"),
    ...m.name ? { name: m.name } : {},
    ...typeof m.swipeId === "number" ? { swipeId: m.swipeId } : {},
    parts: [{ text: String(("content" in m ? m.content : "") ?? "") }]
  }));
}
function fromInternalToOpenAI(internal) {
  return (internal || []).map((m) => {
    const role = String(m.role || "user") === "model" ? "assistant" : String(m.role || "user");
    const content = "content" in m ? String(m.content ?? "") : (m.parts || []).map((p) => ("text" in p) ? p.text ?? "" : "").join("");
    return {
      role,
      ...m.name ? { name: m.name } : {},
      ...typeof m.swipeId === "number" ? { swipeId: m.swipeId } : {},
      content
    };
  });
}
function isTaggedContents(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && ("tag" in x) && ("target" in x) && ("text" in x));
}
function toInternalFromTagged(input) {
  return (input || []).map((m) => ({
    role: m.role,
    parts: [{ text: m.text ?? "" }]
  }));
}
function fromInternalToTagged(_internal) {
  throw new Error("fromInternalToTagged is not supported: tagged output should be produced by prompt assembly stage.");
}
function isTextInput(v) {
  return typeof v === "string" || Array.isArray(v) && v.every((x) => typeof x === "string");
}
function toInternalFromText(input) {
  const text = Array.isArray(input) ? input.join(`
`) : input ?? "";
  return [{ role: "user", parts: [{ text }] }];
}
function fromInternalToText(internal) {
  return (internal || []).map((m) => {
    if ("content" in m)
      return String(m.content ?? "");
    return (m.parts || []).map((p) => ("text" in p) ? p.text ?? "" : "").join("");
  }).join(`
`);
}
function detectMessageFormat(input) {
  if (isTextInput(input))
    return "text";
  if (isTaggedContents(input))
    return "tagged";
  if (isGeminiMessages(input))
    return "gemini";
  if (isOpenAIChatMessages(input))
    return "openai";
  return "gemini";
}
function convertMessagesOut(internal, format) {
  if (format === "gemini")
    return fromInternalToGemini(internal);
  if (format === "openai")
    return fromInternalToOpenAI(internal);
  if (format === "text")
    return fromInternalToText(internal);
  return internal;
}
function isRegexScriptArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && ("findRegex" in x) && ("replaceRegex" in x));
}
function normalizeView(v) {
  if (v === "user" || v === "model")
    return v;
  if (v === "user_view")
    return "user";
  if (v === "model_view" || v === "assistant_view")
    return "model";
  return null;
}
function normalizeTarget(v) {
  if (v === "userInput" || v === "aiOutput" || v === "slashCommands" || v === "worldBook" || v === "reasoning")
    return v;
  if (v === "user")
    return "userInput";
  if (v === "model" || v === "assistant_response")
    return "aiOutput";
  if (v === "preset")
    return "slashCommands";
  if (v === "world_book")
    return "worldBook";
  return null;
}
function toArray(v) {
  return Array.isArray(v) ? v : [];
}
function normalizeOne(item) {
  if (!item || typeof item !== "object")
    return null;
  if (!("findRegex" in item))
    return null;
  const id = String(item.id ?? "");
  if (!id)
    return null;
  const name = String(item.name ?? "");
  const enabled = item.enabled !== false;
  const findRegex = String(item.findRegex ?? "");
  const replaceRegex = String(item.replaceRegex ?? "");
  const trimRegex = toArray(item.trimRegex).map(String);
  const targets = toArray(item.targets).map(normalizeTarget).filter(Boolean);
  const view = toArray(item.view).map(normalizeView).filter(Boolean);
  const runOnEdit = !!item.runOnEdit;
  const macroModeRaw = String(item.macroMode ?? "none");
  const macroMode = macroModeRaw === "raw" || macroModeRaw === "escaped" || macroModeRaw === "none" ? macroModeRaw : "none";
  const minDepth = item.minDepth === null || typeof item.minDepth === "number" ? item.minDepth : null;
  const maxDepth = item.maxDepth === null || typeof item.maxDepth === "number" ? item.maxDepth : null;
  return {
    id,
    name,
    enabled,
    findRegex,
    replaceRegex,
    trimRegex,
    targets,
    view,
    runOnEdit,
    macroMode,
    minDepth,
    maxDepth
  };
}
function normalizeRegexes(input) {
  if (!input)
    return [];
  const files = [];
  if (Array.isArray(input)) {
    if (isRegexScriptArray(input)) {
      files.push(input);
    } else {
      files.push(...input);
    }
  } else {
    files.push(input);
  }
  const out = [];
  for (const item of files) {
    if (!item)
      continue;
    if (isRegexScriptArray(item)) {
      for (const s of item) {
        const n2 = normalizeOne(s);
        if (n2)
          out.push(n2);
      }
      continue;
    }
    if (typeof item === "object" && item !== null && Array.isArray(item.regexScripts)) {
      for (const s of item.regexScripts) {
        const n2 = normalizeOne(s);
        if (n2)
          out.push(n2);
      }
      continue;
    }
    if (typeof item === "object" && item !== null && Array.isArray(item.scripts)) {
      for (const s of item.scripts) {
        const n2 = normalizeOne(s);
        if (n2)
          out.push(n2);
      }
      continue;
    }
    const n = normalizeOne(item);
    if (n)
      out.push(n);
  }
  return out;
}
function isWorldBookEntryArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && ("content" in x));
}
function toNumber(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toBool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function normalizeOneEntry(e) {
  if (!e || typeof e !== "object")
    return null;
  const position = String(e.position ?? "");
  if (!position)
    return null;
  const index = toNumber(e.index, NaN);
  if (!Number.isFinite(index))
    return null;
  const name = String(e.name ?? "");
  const content = String(e.content ?? "");
  const enabled = toBool(e.enabled, true);
  const activationModeRaw = String(e.activationMode ?? "keyword");
  const activationMode = activationModeRaw === "always" || activationModeRaw === "keyword" || activationModeRaw === "vector" ? activationModeRaw : "keyword";
  const key = Array.isArray(e.key) ? e.key.map(String) : [];
  const secondaryKey = Array.isArray(e.secondaryKey) ? e.secondaryKey.map(String) : [];
  const selectiveLogicRaw = String(e.selectiveLogic ?? "andAny");
  const selectiveLogic = selectiveLogicRaw === "andAny" || selectiveLogicRaw === "andAll" || selectiveLogicRaw === "notAll" || selectiveLogicRaw === "notAny" ? selectiveLogicRaw : "andAny";
  const order = toNumber(e.order, NaN);
  if (!Number.isFinite(order))
    return null;
  const depth = toNumber(e.depth, position === "fixed" ? NaN : 0);
  if (position === "fixed" && !Number.isFinite(depth))
    return null;
  const roleRaw = e.role;
  const role = roleRaw === null ? null : String(roleRaw || "") === "" ? null : String(roleRaw);
  const caseSensitive = e.caseSensitive === null || typeof e.caseSensitive === "boolean" ? e.caseSensitive : null;
  const excludeRecursion = toBool(e.excludeRecursion, false);
  const preventRecursion = toBool(e.preventRecursion, false);
  const probability = toNumber(e.probability, 100);
  const other = e.other && typeof e.other === "object" ? e.other : {};
  return {
    index,
    name,
    content,
    enabled,
    activationMode,
    key,
    secondaryKey,
    selectiveLogic,
    order,
    depth,
    position,
    role,
    caseSensitive,
    excludeRecursion,
    preventRecursion,
    probability,
    other
  };
}
function normalizeOne2(item) {
  if (isWorldBookEntryArray(item)) {
    return item.map(normalizeOneEntry).filter((x) => Boolean(x));
  }
  if (typeof item === "object" && item !== null && Array.isArray(item.entries)) {
    if (item.enabled === false)
      return [];
    return item.entries.map(normalizeOneEntry).filter((x) => Boolean(x));
  }
  return [];
}
function normalizeWorldbooks(input) {
  if (!input)
    return [];
  const files = [];
  if (Array.isArray(input)) {
    if (isWorldBookEntryArray(input)) {
      files.push(input);
    } else {
      files.push(...input);
    }
  } else {
    files.push(input);
  }
  const out = [];
  for (const file of files) {
    if (!file)
      continue;
    out.push(...normalizeOne2(file));
  }
  return out;
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toArray2(v) {
  return Array.isArray(v) ? v : [];
}
function toStr(v, fallback = "") {
  if (v === undefined || v === null)
    return fallback;
  return String(v);
}
function toNum(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function toBool2(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function cloneJson(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}
function readString(v) {
  if (v === undefined || v === null)
    return;
  return typeof v === "string" ? v : String(v);
}
function readNumber(v) {
  if (v === undefined || v === null)
    return;
  if (typeof v === "number" && Number.isFinite(v))
    return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function mergeUtilityPrompts(base, patch) {
  return {
    impersonationPrompt: patch.impersonationPrompt ?? base.impersonationPrompt,
    worldInfoFormat: patch.worldInfoFormat ?? base.worldInfoFormat,
    scenarioFormat: patch.scenarioFormat ?? base.scenarioFormat,
    personalityFormat: patch.personalityFormat ?? base.personalityFormat,
    groupNudgePrompt: patch.groupNudgePrompt ?? base.groupNudgePrompt,
    newChatPrompt: patch.newChatPrompt ?? base.newChatPrompt,
    newGroupChatPrompt: patch.newGroupChatPrompt ?? base.newGroupChatPrompt,
    newExampleChatPrompt: patch.newExampleChatPrompt ?? base.newExampleChatPrompt,
    continueNudgePrompt: patch.continueNudgePrompt ?? base.continueNudgePrompt,
    sendIfEmpty: patch.sendIfEmpty ?? base.sendIfEmpty,
    seed: patch.seed ?? base.seed
  };
}
var UTILITY_PROMPT_KEYS = [
  "impersonation_prompt",
  "wi_format",
  "scenario_format",
  "personality_format",
  "group_nudge_prompt",
  "new_chat_prompt",
  "new_group_chat_prompt",
  "new_example_chat_prompt",
  "continue_nudge_prompt",
  "send_if_empty",
  "seed",
  "impersonationPrompt",
  "wiFormat",
  "worldInfoFormat",
  "scenarioFormat",
  "personalityFormat",
  "groupNudgePrompt",
  "newChatPrompt",
  "newGroupChatPrompt",
  "newExampleChatPrompt",
  "continueNudgePrompt",
  "sendIfEmpty"
];
function extractUtilityPrompts(other) {
  const source = isObject(other) ? other : {};
  const pick = (keys) => {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined)
        return source[k];
    }
    return;
  };
  return {
    impersonationPrompt: readString(pick(["impersonation_prompt", "impersonationPrompt"])),
    worldInfoFormat: readString(pick(["wi_format", "wiFormat", "worldInfoFormat"])),
    scenarioFormat: readString(pick(["scenario_format", "scenarioFormat"])),
    personalityFormat: readString(pick(["personality_format", "personalityFormat"])),
    groupNudgePrompt: readString(pick(["group_nudge_prompt", "groupNudgePrompt"])),
    newChatPrompt: readString(pick(["new_chat_prompt", "newChatPrompt"])),
    newGroupChatPrompt: readString(pick(["new_group_chat_prompt", "newGroupChatPrompt"])),
    newExampleChatPrompt: readString(pick(["new_example_chat_prompt", "newExampleChatPrompt"])),
    continueNudgePrompt: readString(pick(["continue_nudge_prompt", "continueNudgePrompt"])),
    sendIfEmpty: readString(pick(["send_if_empty", "sendIfEmpty"])),
    seed: readNumber(pick(["seed"]))
  };
}
function stripUtilityPrompts(other) {
  for (const k of UTILITY_PROMPT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(other, k)) {
      delete other[k];
    }
  }
}
function normalizeUtilityPrompts(input) {
  if (!isObject(input))
    return {};
  return {
    impersonationPrompt: readString(input.impersonationPrompt),
    worldInfoFormat: readString(input.worldInfoFormat),
    scenarioFormat: readString(input.scenarioFormat),
    personalityFormat: readString(input.personalityFormat),
    groupNudgePrompt: readString(input.groupNudgePrompt),
    newChatPrompt: readString(input.newChatPrompt),
    newGroupChatPrompt: readString(input.newGroupChatPrompt),
    newExampleChatPrompt: readString(input.newExampleChatPrompt),
    continueNudgePrompt: readString(input.continueNudgePrompt),
    sendIfEmpty: readString(input.sendIfEmpty),
    seed: readNumber(input.seed)
  };
}
var REGEX_TARGET_MAP_FROM_ST = {
  1: "userInput",
  2: "aiOutput",
  3: "slashCommands",
  5: "worldBook",
  6: "reasoning"
};
var REGEX_LEGACY_TARGET_MAP = {
  userInput: "userInput",
  aiOutput: "aiOutput",
  slashCommands: "slashCommands",
  worldBook: "worldBook",
  reasoning: "reasoning",
  user: "userInput",
  model: "aiOutput",
  assistant_response: "aiOutput",
  preset: "slashCommands",
  world_book: "worldBook"
};
var REGEX_MACRO_MODE_MAP = {
  0: "none",
  1: "raw",
  2: "escaped"
};
function normalizeRegexTarget(v) {
  if (typeof v === "number")
    return REGEX_TARGET_MAP_FROM_ST[v] ?? null;
  const s = toStr(v).trim();
  if (!s)
    return null;
  return REGEX_LEGACY_TARGET_MAP[s] ?? null;
}
function normalizeRegexView(v) {
  const s = toStr(v).trim();
  if (s === "user" || s === "model")
    return s;
  if (s === "user_view")
    return "user";
  if (s === "model_view" || s === "assistant_view")
    return "model";
  return null;
}
function normalizeRegexMacroMode(v) {
  if (v === "none" || v === "raw" || v === "escaped")
    return v;
  if (typeof v === "number")
    return REGEX_MACRO_MODE_MAP[v] ?? "none";
  return "none";
}
function normalizeDepth(v) {
  if (v === null)
    return null;
  const n = readNumber(v);
  return n === undefined ? null : n;
}
function convertRegexFromSillyTavern(rawRegex) {
  const raw = isObject(rawRegex) ? rawRegex : {};
  const name = toStr(raw.name ?? raw.scriptName ?? "");
  const fallbackIdBase = name || "regex";
  const id = toStr(raw.id ?? "").trim() || `${fallbackIdBase}_${Math.random().toString(36).slice(2, 10)}`;
  const targetsFromTargets = toArray2(raw.targets).map(normalizeRegexTarget).filter(Boolean);
  const placements = Array.isArray(raw.placement) ? raw.placement : raw.placement === undefined || raw.placement === null ? [] : [raw.placement];
  const targetsFromPlacement = placements.map(normalizeRegexTarget).filter(Boolean);
  const targets = (targetsFromTargets.length > 0 ? targetsFromTargets : targetsFromPlacement).filter((x, i, arr) => arr.indexOf(x) === i);
  const viewFromView = toArray2(raw.view).map(normalizeRegexView).filter(Boolean);
  const view = viewFromView.length > 0 ? viewFromView : [
    ...raw.markdownOnly ? ["user"] : [],
    ...raw.promptOnly ? ["model"] : []
  ];
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : typeof raw.disabled === "boolean" ? !raw.disabled : true;
  return {
    id,
    name,
    enabled,
    findRegex: toStr(raw.findRegex ?? ""),
    replaceRegex: toStr(raw.replaceRegex ?? raw.replaceString ?? ""),
    trimRegex: toArray2(raw.trimRegex ?? raw.trimStrings).map((x) => toStr(x)),
    targets,
    view,
    runOnEdit: toBool2(raw.runOnEdit, false),
    macroMode: normalizeRegexMacroMode(raw.macroMode ?? raw.substituteRegex),
    minDepth: normalizeDepth(raw.minDepth),
    maxDepth: normalizeDepth(raw.maxDepth)
  };
}
function collectRegexItems(input, out) {
  if (input === null || input === undefined)
    return;
  if (Array.isArray(input)) {
    for (const item of input)
      collectRegexItems(item, out);
    return;
  }
  if (isObject(input) && Array.isArray(input.regexScripts)) {
    collectRegexItems(input.regexScripts, out);
    return;
  }
  if (isObject(input) && Array.isArray(input.scripts)) {
    collectRegexItems(input.scripts, out);
    return;
  }
  out.push(input);
}
function convertRegexesFromSillyTavern(input) {
  if (input === null || input === undefined)
    return [];
  const rawItems = [];
  collectRegexItems(input, rawItems);
  return normalizeRegexes(rawItems.map((x) => convertRegexFromSillyTavern(x)));
}
var WORLDBOOK_POSITION_MAP_FROM_ST = {
  0: "beforeChar",
  1: "afterChar",
  2: "beforeAn",
  3: "afterAn",
  4: "fixed",
  5: "beforeEm",
  6: "afterEm",
  7: "outlet"
};
var WORLDBOOK_POSITION_MAP_FROM_STR = {
  beforeChar: "beforeChar",
  afterChar: "afterChar",
  beforeAn: "beforeAn",
  afterAn: "afterAn",
  fixed: "fixed",
  beforeEm: "beforeEm",
  afterEm: "afterEm",
  outlet: "outlet",
  before_char: "beforeChar",
  after_char: "afterChar",
  before_an: "beforeAn",
  after_an: "afterAn",
  before_em: "beforeEm",
  after_em: "afterEm"
};
var WORLDBOOK_ROLE_MAP_FROM_ST = {
  0: "system",
  1: "user",
  2: "model"
};
var WORLDBOOK_SELECTIVE_LOGIC_MAP_FROM_ST = {
  0: "andAny",
  1: "notAll",
  2: "notAny",
  3: "andAll"
};
function normalizeWorldBookPosition(position, extPosition) {
  const p = position ?? extPosition;
  if (typeof p === "number")
    return WORLDBOOK_POSITION_MAP_FROM_ST[p] ?? String(p);
  const s = toStr(p).trim();
  if (!s)
    return "beforeChar";
  const maybeNumeric = Number(s);
  if (Number.isFinite(maybeNumeric)) {
    return WORLDBOOK_POSITION_MAP_FROM_ST[maybeNumeric] ?? s;
  }
  return WORLDBOOK_POSITION_MAP_FROM_STR[s] ?? s;
}
function normalizeWorldBookSelectiveLogic(v) {
  if (v === "andAny" || v === "andAll" || v === "notAll" || v === "notAny")
    return v;
  if (typeof v === "number")
    return WORLDBOOK_SELECTIVE_LOGIC_MAP_FROM_ST[v] ?? "andAny";
  return "andAny";
}
function normalizeWorldBookRole(v) {
  if (v === "system" || v === "user" || v === "model")
    return v;
  if (typeof v === "number")
    return WORLDBOOK_ROLE_MAP_FROM_ST[v] ?? "system";
  return "system";
}
function normalizeWorldBookActivationMode(raw, ext) {
  if (raw.activationMode === "always" || raw.activationMode === "keyword" || raw.activationMode === "vector") {
    return raw.activationMode;
  }
  const constant = raw.constant ?? ext.constant;
  const vectorized = raw.vectorized ?? ext.vectorized;
  if (constant)
    return "always";
  if (vectorized)
    return "vector";
  return "keyword";
}
function convertWorldBookEntryFromSillyTavern(rawEntry, fallbackIndex = 0) {
  if (!isObject(rawEntry))
    return null;
  const ext = isObject(rawEntry.extensions) ? rawEntry.extensions : {};
  const index = toNum(rawEntry.index ?? rawEntry.uid ?? rawEntry.id, fallbackIndex);
  const position = normalizeWorldBookPosition(rawEntry.position, ext.position);
  const selectiveLogic = normalizeWorldBookSelectiveLogic(rawEntry.selectiveLogic ?? ext.selectiveLogic ?? ext.selective_logic);
  const role = position === "fixed" ? normalizeWorldBookRole(rawEntry.role ?? ext.role) : null;
  const caseSensitiveRaw = rawEntry.caseSensitive ?? ext.caseSensitive ?? ext.case_sensitive;
  const caseSensitive = caseSensitiveRaw === null || typeof caseSensitiveRaw === "boolean" ? caseSensitiveRaw : null;
  const {
    index: _index,
    uid: _uid,
    id: _id,
    name: _name,
    comment: _comment,
    content: _content,
    enabled: _enabled,
    disable: _disable,
    activationMode: _activationMode,
    constant: _constant,
    vectorized: _vectorized,
    key: _key,
    keys: _keys,
    secondaryKey: _secondaryKey,
    keysecondary: _keysecondary,
    secondary_keys: _secondary_keys,
    selectiveLogic: _selectiveLogic,
    insertion_order: _insertionOrder,
    order: _order,
    depth: _depth,
    position: _position,
    role: _role,
    caseSensitive: _caseSensitive,
    excludeRecursion: _excludeRecursion,
    preventRecursion: _preventRecursion,
    probability: _probability,
    extensions: _extensions,
    other: rawOther,
    ...restRaw
  } = rawEntry;
  const other = {
    ...isObject(rawOther) ? rawOther : {},
    ...restRaw
  };
  if (Object.keys(ext).length > 0 && !Object.prototype.hasOwnProperty.call(other, "extensions")) {
    other.extensions = ext;
  }
  return {
    index,
    name: toStr(rawEntry.name ?? rawEntry.comment ?? ""),
    content: toStr(rawEntry.content ?? ""),
    enabled: typeof rawEntry.enabled === "boolean" ? rawEntry.enabled : typeof rawEntry.disable === "boolean" ? !rawEntry.disable : true,
    activationMode: normalizeWorldBookActivationMode(rawEntry, ext),
    key: toArray2(rawEntry.key ?? rawEntry.keys).map((x) => toStr(x)),
    secondaryKey: toArray2(rawEntry.secondaryKey ?? rawEntry.keysecondary ?? rawEntry.secondary_keys).map((x) => toStr(x)),
    selectiveLogic,
    order: toNum(rawEntry.order ?? rawEntry.insertion_order, 100),
    depth: toNum(rawEntry.depth ?? ext.depth, 4),
    position,
    role,
    caseSensitive,
    excludeRecursion: toBool2(rawEntry.excludeRecursion ?? ext.excludeRecursion ?? ext.exclude_recursion, false),
    preventRecursion: toBool2(rawEntry.preventRecursion ?? ext.preventRecursion ?? ext.prevent_recursion, false),
    probability: toNum(rawEntry.probability ?? ext.probability, 100),
    other
  };
}
function convertWorldBookFromSillyTavern(rawBook, options) {
  const book = rawBook;
  const ownName = isObject(book) ? toStr(book.name, "").trim() : "";
  const fallbackName = toStr(options?.name, "").trim();
  const name = ownName || fallbackName || "WorldBook";
  const entries = [];
  if (Array.isArray(book)) {
    book.forEach((raw, idx) => {
      const converted = convertWorldBookEntryFromSillyTavern(raw, idx);
      if (converted)
        entries.push(converted);
    });
  } else if (isObject(book) && Array.isArray(book.entries)) {
    book.entries.forEach((raw, idx) => {
      const converted = convertWorldBookEntryFromSillyTavern(raw, idx);
      if (converted)
        entries.push(converted);
    });
  } else if (isObject(book) && isObject(book.entries)) {
    Object.entries(book.entries).forEach(([k, raw], idx) => {
      const fallbackIndex = Number.isFinite(Number(k)) ? Number(k) : idx;
      const converted = convertWorldBookEntryFromSillyTavern(raw, fallbackIndex);
      if (converted)
        entries.push(converted);
    });
  } else if (isObject(book)) {
    const converted = convertWorldBookEntryFromSillyTavern(book, 0);
    if (converted)
      entries.push(converted);
  }
  return { name, entries };
}
function getPromptOrderList(rawOrder) {
  if (Array.isArray(rawOrder)) {
    const candidates = rawOrder.filter((x) => isObject(x) && Array.isArray(x.order));
    const last = candidates.length > 0 ? candidates[candidates.length - 1] : null;
    if (!last)
      return [];
    return toArray2(last.order).filter((x) => isObject(x) && typeof x.identifier === "string").map((x) => ({
      identifier: toStr(x.identifier),
      enabled: toBool2(x.enabled, true)
    }));
  }
  if (isObject(rawOrder) && Array.isArray(rawOrder.order)) {
    return toArray2(rawOrder.order).filter((x) => isObject(x) && typeof x.identifier === "string").map((x) => ({
      identifier: toStr(x.identifier),
      enabled: toBool2(x.enabled, true)
    }));
  }
  return [];
}
function convertPromptFromSillyTavern(rawPrompt, orderMap, fallbackIndex) {
  if (!isObject(rawPrompt))
    return null;
  const ST_IDENTIFIER_MAP = {
    worldInfoBefore: "charBefore",
    worldInfoAfter: "charAfter"
  };
  const {
    injection_depth,
    injection_order,
    injection_trigger,
    injection_position,
    system_prompt,
    ...rest
  } = rawPrompt;
  const rawIdentifier = toStr(rest.identifier ?? `prompt_${fallbackIndex}`, "").trim() || `prompt_${fallbackIndex}`;
  const identifier = ST_IDENTIFIER_MAP[rawIdentifier] ?? rawIdentifier;
  const orderItem = orderMap.get(rawIdentifier) ?? orderMap.get(identifier);
  const position = rest.position === "relative" || rest.position === "fixed" ? rest.position : Number(injection_position) === 1 ? "fixed" : "relative";
  const role = toStr(rest.role ?? (system_prompt ? "system" : "system"));
  return {
    ...rest,
    identifier,
    name: toStr(rest.name ?? identifier),
    enabled: orderItem ? orderItem.enabled : orderMap.size > 0 ? false : toBool2(rest.enabled, true),
    ...orderItem ? { index: orderItem.index } : typeof rest.index === "number" ? { index: rest.index } : {},
    role,
    content: toStr(rest.content ?? ""),
    depth: toNum(injection_depth ?? rest.depth, 0),
    order: toNum(injection_order ?? rest.order, 100),
    trigger: Array.isArray(injection_trigger ?? rest.trigger) ? injection_trigger ?? rest.trigger : [],
    position
  };
}
function convertPresetFromSillyTavern(rawPreset, options) {
  const raw = isObject(rawPreset) ? rawPreset : {};
  const otherSource = (() => {
    if (isObject(raw.other))
      return cloneJson(raw.other);
    if (isObject(raw.apiSetting))
      return cloneJson(raw.apiSetting);
    const {
      name: _name,
      prompts: _prompts,
      prompt_order: _promptOrder,
      regexScripts: _regexScripts,
      utilityPrompts: _utilityPrompts,
      other: _other,
      apiSetting: _apiSetting,
      ...rest
    } = raw;
    return cloneJson(rest);
  })();
  delete otherSource.prompts;
  delete otherSource.prompt_order;
  const utilityFromOther = extractUtilityPrompts(otherSource);
  stripUtilityPrompts(otherSource);
  const utilityPrompts = mergeUtilityPrompts(utilityFromOther, normalizeUtilityPrompts(raw.utilityPrompts));
  const hasExplicitRegexScripts = Object.prototype.hasOwnProperty.call(raw, "regexScripts");
  const regexScripts = hasExplicitRegexScripts ? convertRegexesFromSillyTavern(raw.regexScripts) : convertRegexesFromSillyTavern(isObject(otherSource.extensions) && (otherSource.extensions.regex_scripts ?? otherSource.extensions.regexScripts) || []);
  const promptList = toArray2(raw.prompts);
  const orderList = getPromptOrderList(raw.prompt_order ?? raw.apiSetting?.prompt_order ?? raw.other?.prompt_order);
  const orderMap = /* @__PURE__ */ new Map;
  orderList.forEach((item, idx) => {
    orderMap.set(item.identifier, { enabled: item.enabled, index: idx });
  });
  const prompts = promptList.map((p, idx) => convertPromptFromSillyTavern(p, orderMap, idx)).filter((x) => Boolean(x)).map((p, idx) => ({ p, idx })).sort((a, b) => {
    const ai = typeof a.p.index === "number" ? a.p.index : Number.POSITIVE_INFINITY;
    const bi = typeof b.p.index === "number" ? b.p.index : Number.POSITIVE_INFINITY;
    if (ai !== bi)
      return ai - bi;
    return a.idx - b.idx;
  }).map((x) => x.p);
  return {
    name: toStr(options?.name ?? raw.name ?? "Default") || "Default",
    prompts,
    utilityPrompts,
    regexScripts,
    other: otherSource
  };
}
function convertCharacterFromSillyTavern(rawCharacter) {
  const raw = isObject(rawCharacter) ? rawCharacter : {};
  const data = isObject(raw.data) ? raw.data : {};
  const name = toStr(data.name ?? raw.name ?? "");
  const description = toStr(data.description ?? raw.description ?? "");
  const avatar = toStr(raw.avatar ?? raw.avatar_url ?? data.avatar ?? "");
  const message = (() => {
    if (Array.isArray(raw.message)) {
      return raw.message.map((x) => toStr(x));
    }
    const firstMes = data.first_mes ?? raw.first_mes;
    const alternates = toArray2(data.alternate_greetings ?? raw.alternate_greetings).map((x) => toStr(x));
    if (firstMes === undefined && alternates.length === 0)
      return [];
    return [toStr(firstMes ?? ""), ...alternates];
  })();
  const worldBook = (() => {
    if (raw.worldBook === null)
      return null;
    if (isObject(raw.worldBook) || Array.isArray(raw.worldBook)) {
      return convertWorldBookFromSillyTavern(raw.worldBook, { name: toStr(raw.worldBook?.name ?? name) || name });
    }
    if (isObject(data.character_book)) {
      return convertWorldBookFromSillyTavern(data.character_book, { name: toStr(data.character_book.name ?? name) || name });
    }
    return null;
  })();
  const hasExplicitRegexScripts = Object.prototype.hasOwnProperty.call(raw, "regexScripts");
  const regexScripts = hasExplicitRegexScripts ? convertRegexesFromSillyTavern(raw.regexScripts) : convertRegexesFromSillyTavern(isObject(data.extensions) && (data.extensions.regex_scripts ?? data.extensions.regexScripts) || []);
  const other = (() => {
    if (isObject(raw.other))
      return cloneJson(raw.other);
    const copy = cloneJson(raw);
    if (isObject(copy.data?.extensions)) {
      delete copy.data.extensions.regex_scripts;
      delete copy.data.extensions.regexScripts;
    }
    if (isObject(copy.data)) {
      delete copy.data.character_book;
      delete copy.data.first_mes;
      delete copy.data.alternate_greetings;
    }
    delete copy.first_mes;
    delete copy.alternate_greetings;
    delete copy.chat;
    delete copy.create_date;
    return copy;
  })();
  return {
    name,
    description,
    avatar,
    message,
    worldBook,
    regexScripts,
    other,
    chatDate: toStr(raw.chatDate ?? raw.chat ?? ""),
    createDate: toStr(raw.createDate ?? raw.create_date ?? "")
  };
}
function normalizeProbability(p) {
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n))
    return 100;
  return Math.max(0, Math.min(100, n));
}
function normalizeCaseSensitive(entry, defaultCaseSensitive) {
  if (typeof entry.caseSensitive === "boolean")
    return entry.caseSensitive;
  return defaultCaseSensitive;
}
function includesKeyword(text, keyword, caseSensitive) {
  if (!keyword)
    return false;
  if (caseSensitive)
    return text.includes(keyword);
  return text.toLowerCase().includes(keyword.toLowerCase());
}
function anyIncluded(text, keywords, caseSensitive) {
  return (keywords || []).some((k) => includesKeyword(text, k, caseSensitive));
}
function allIncluded(text, keywords, caseSensitive) {
  const list = (keywords || []).filter((k) => k);
  if (list.length === 0)
    return true;
  return list.every((k) => includesKeyword(text, k, caseSensitive));
}
function secondaryLogicPass(logic, text, secondary, caseSensitive) {
  const list = (secondary || []).filter((k) => k);
  if (list.length === 0)
    return true;
  switch (logic) {
    case "andAny":
      return anyIncluded(text, list, caseSensitive);
    case "andAll":
      return allIncluded(text, list, caseSensitive);
    case "notAny":
      return !anyIncluded(text, list, caseSensitive);
    case "notAll":
      return !allIncluded(text, list, caseSensitive);
    default:
      return anyIncluded(text, list, caseSensitive);
  }
}
function keywordTriggered(entry, text, caseSensitive) {
  const primary = (entry.key || []).filter((k) => k);
  const primaryList = primary.length > 0 ? primary : (entry.secondaryKey || []).filter((k) => k);
  if (primaryList.length === 0)
    return false;
  const primaryHit = anyIncluded(text, primaryList, caseSensitive);
  if (!primaryHit)
    return false;
  if ((entry.key || []).length > 0) {
    return secondaryLogicPass(entry.selectiveLogic, text, entry.secondaryKey || [], caseSensitive);
  }
  return true;
}
function asSet(v) {
  if (!v)
    return /* @__PURE__ */ new Set;
  if (v instanceof Set)
    return v;
  return new Set((v || []).filter((x) => typeof x === "number" && Number.isFinite(x)));
}
function getActiveEntries(params) {
  const {
    contextText = "",
    globalEntries = [],
    characterWorldBook,
    options
  } = params;
  const defaultCaseSensitive = options?.defaultCaseSensitive ?? false;
  const recursionLimit = Math.max(0, Math.trunc(options?.recursionLimit ?? 5));
  const rng = options?.rng ?? Math.random;
  const all = [];
  (globalEntries || []).forEach((e, idx) => {
    if (!e)
      return;
    all.push({ entry: e, source: "global", prio: 1, seq: idx });
  });
  if (characterWorldBook) {
    const list = normalizeWorldbooks(characterWorldBook);
    list.forEach((e, idx) => {
      if (!e)
        return;
      all.push({ entry: e, source: "character", prio: 2, seq: idx });
    });
  }
  const vectorHits = (() => {
    if (!options?.vectorSearch)
      return /* @__PURE__ */ new Set;
    const res = options.vectorSearch({ entries: all.map((x) => x.entry), contextText });
    return asSet(res);
  })();
  const byIndex = /* @__PURE__ */ new Map;
  const probFailed = /* @__PURE__ */ new Set;
  let recursionContext = contextText;
  const consider = (entry, iteration) => {
    if (!entry.enabled)
      return false;
    const ctx = iteration > 0 && entry.excludeRecursion ? contextText : recursionContext;
    const caseSensitive = normalizeCaseSensitive(entry, defaultCaseSensitive);
    if (entry.activationMode === "always")
      return true;
    if (entry.activationMode === "keyword")
      return keywordTriggered(entry, ctx, caseSensitive);
    if (entry.activationMode === "vector")
      return vectorHits.has(entry.index);
    return false;
  };
  const passProbability = (entry) => {
    const p = normalizeProbability(entry.probability);
    if (p >= 100)
      return true;
    if (p <= 0)
      return false;
    return rng() * 100 < p;
  };
  for (let iteration = 0;iteration <= recursionLimit; iteration++) {
    let anyNew = false;
    for (const node of all) {
      const entry = node.entry;
      if (!entry)
        continue;
      if (byIndex.has(entry.index))
        continue;
      if (probFailed.has(entry.index))
        continue;
      if (!consider(entry, iteration))
        continue;
      if (!passProbability(entry)) {
        probFailed.add(entry.index);
        continue;
      }
      byIndex.set(entry.index, { entry, prio: node.prio, seq: node.seq });
      anyNew = true;
      if (!entry.preventRecursion && entry.content) {
        recursionContext = recursionContext ? `${recursionContext}
${entry.content}` : entry.content;
      }
    }
    if (!anyNew)
      break;
  }
  const active = Array.from(byIndex.values());
  active.sort((a, b) => {
    const ao = typeof a.entry.order === "number" ? a.entry.order : Number(a.entry.order);
    const bo = typeof b.entry.order === "number" ? b.entry.order : Number(b.entry.order);
    if (ao !== bo)
      return ao - bo;
    if (a.prio !== b.prio)
      return a.prio - b.prio;
    return a.seq - b.seq;
  });
  return active.map((x) => x.entry);
}
function createVariableContext(initialLocal, initialGlobal) {
  return {
    local: { ...initialLocal },
    global: { ...initialGlobal }
  };
}
function getVar(ctx, name) {
  return ctx.local[name] ?? "";
}
function setVar(ctx, name, value) {
  ctx.local[name] = value;
}
function getGlobalVar(ctx, name) {
  return ctx.global[name] ?? "";
}
function setGlobalVar(ctx, name, value) {
  ctx.global[name] = value;
}
function stringifyVariableValue(v) {
  if (v === null || v === undefined)
    return "";
  if (typeof v === "string")
    return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
    return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function processVariableMacros(text, ctx) {
  if (!text)
    return "";
  let result = text;
  result = result.replace(/\{\{\s*setvar\s*::\s*([^:}]+)\s*::\s*([^}]*)\s*\}\}/gi, (_match, name, value) => {
    setVar(ctx, name.trim(), value.trim());
    return "";
  });
  result = result.replace(/\{\{\s*setglobalvar\s*::\s*([^:}]+)\s*::\s*([^}]*)\s*\}\}/gi, (_match, name, value) => {
    setGlobalVar(ctx, name.trim(), value.trim());
    return "";
  });
  result = result.replace(/\{\{\s*getvar\s*::\s*([^}]+)\s*\}\}/gi, (_match, name) => {
    return stringifyVariableValue(getVar(ctx, name.trim()));
  });
  result = result.replace(/\{\{\s*getglobalvar\s*::\s*([^}]+)\s*\}\}/gi, (_match, name) => {
    return stringifyVariableValue(getGlobalVar(ctx, name.trim()));
  });
  result = result.replace(/<<\s*setvar\s*::\s*([^:>]+)\s*::\s*([^>]*)\s*>>/gi, (_match, name, value) => {
    setVar(ctx, name.trim(), value.trim());
    return "";
  });
  result = result.replace(/<<\s*setglobalvar\s*::\s*([^:>]+)\s*::\s*([^>]*)\s*>>/gi, (_match, name, value) => {
    setGlobalVar(ctx, name.trim(), value.trim());
    return "";
  });
  result = result.replace(/<<\s*getvar\s*::\s*([^>]+)\s*>>/gi, (_match, name) => {
    return stringifyVariableValue(getVar(ctx, name.trim()));
  });
  result = result.replace(/<<\s*getglobalvar\s*::\s*([^>]+)\s*>>/gi, (_match, name) => {
    return stringifyVariableValue(getGlobalVar(ctx, name.trim()));
  });
  return result;
}
function replaceMacros(text, options) {
  if (!text)
    return "";
  const opts = options && (("macros" in options) || ("variableContext" in options)) ? options : { macros: options };
  const macros = opts.macros || {};
  let out = text;
  if (opts.variableContext) {
    out = processVariableMacros(out, opts.variableContext);
  }
  out = out.replace(/<<\s*([a-zA-Z0-9_]+)\s*>>/g, (_m, key) => {
    const lowerKey = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(macros, key)) {
      return String(macros[key]);
    }
    if (Object.prototype.hasOwnProperty.call(macros, lowerKey)) {
      return String(macros[lowerKey]);
    }
    return _m;
  });
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const lowerKey = key.toLowerCase();
    if (["getvar", "setvar", "getglobalvar", "setglobalvar"].includes(lowerKey)) {
      return _m;
    }
    if (Object.prototype.hasOwnProperty.call(macros, key)) {
      return String(macros[key]);
    }
    if (Object.prototype.hasOwnProperty.call(macros, lowerKey)) {
      return String(macros[lowerKey]);
    }
    return _m;
  });
  return out;
}
function escapeRegExpLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function replaceMacroTokens(pattern, macros, mode) {
  if (mode === "none") {
    return pattern.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, (m) => escapeRegExpLiteral(m)).replace(/<<\s*[a-zA-Z0-9_]+\s*>>/g, (m) => escapeRegExpLiteral(m));
  }
  const pick = (key) => {
    if (Object.prototype.hasOwnProperty.call(macros, key))
      return String(macros[key]);
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(macros, lower))
      return String(macros[lower]);
    return null;
  };
  const encode = (v) => mode === "escaped" ? escapeRegExpLiteral(v) : v;
  const replacer = (_m, key) => {
    const val = pick(key);
    return val === null ? _m : encode(val);
  };
  return pattern.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, replacer).replace(/<<\s*([a-zA-Z0-9_]+)\s*>>/g, replacer);
}
function parseFindRegex(input) {
  const s = String(input ?? "");
  if (s.startsWith("/")) {
    for (let i = s.length - 1;i > 0; i--) {
      if (s[i] !== "/")
        continue;
      let backslashes = 0;
      for (let j = i - 1;j >= 0 && s[j] === "\\"; j--)
        backslashes++;
      if (backslashes % 2 === 1)
        continue;
      const source = s.slice(1, i);
      const flags = s.slice(i + 1);
      if (/^[gimsuy]*$/.test(flags)) {
        return { source, flags };
      }
      break;
    }
  }
  return { source: s, flags: "" };
}
function applyTrim(match, trims) {
  let out = match;
  for (const t of trims || []) {
    const needle = String(t ?? "");
    if (!needle)
      continue;
    out = out.split(needle).join("");
  }
  return out;
}
function interpolateReplacement(template, matchTrimmed, groups) {
  const raw = String(template ?? "");
  let out = raw.replace(/\{\{\s*match\s*\}\}/gi, matchTrimmed);
  const DOLLAR = "\x00DOLLAR\x00";
  out = out.replace(/\$\$/g, DOLLAR);
  out = out.replace(/\$&/g, matchTrimmed);
  out = out.replace(/\$(\d{1,2})/g, (_m, nStr) => {
    const n = Number(nStr);
    if (!Number.isFinite(n) || n <= 0)
      return "";
    return String(groups[n - 1] ?? "");
  });
  out = out.replace(new RegExp(DOLLAR, "g"), "$");
  return out;
}
function shouldApplyByDepth(script, target, historyDepth) {
  if (target !== "userInput" && target !== "aiOutput")
    return true;
  if (historyDepth === undefined)
    return false;
  const min = script.minDepth === null || script.minDepth === -1 ? null : script.minDepth;
  const max = script.maxDepth === null || script.maxDepth === -1 ? null : script.maxDepth;
  if (min !== null && historyDepth < min)
    return false;
  if (max !== null && historyDepth > max)
    return false;
  return true;
}
function applyRegex(text, params) {
  let result = text ?? "";
  const macros = params.macros || {};
  for (const script of params.scripts || []) {
    if (!script?.enabled)
      continue;
    if (!Array.isArray(script.targets) || script.targets.length === 0)
      continue;
    if (!Array.isArray(script.view) || script.view.length === 0)
      continue;
    if (!script.targets.includes(params.target))
      continue;
    if (!script.view.includes(params.view))
      continue;
    if (!shouldApplyByDepth(script, params.target, params.historyDepth))
      continue;
    const substituted = replaceMacroTokens(String(script.findRegex ?? ""), macros, script.macroMode);
    const { source, flags } = parseFindRegex(substituted);
    let re;
    try {
      re = new RegExp(source, flags);
    } catch {
      continue;
    }
    const replaceTemplate = String(script.replaceRegex ?? "");
    const trims = Array.isArray(script.trimRegex) ? script.trimRegex : [];
    result = result.replace(re, (...args) => {
      let namedGroups = undefined;
      if (args.length >= 3 && typeof args[args.length - 1] === "object" && args[args.length - 1] !== null) {
        namedGroups = args[args.length - 1];
      }
      const match = String(args[0] ?? "");
      const groupsEnd = namedGroups ? args.length - 3 : args.length - 2;
      const groups = args.slice(1, Math.max(1, groupsEnd)).map((g) => String(g ?? ""));
      const matchTrimmed = applyTrim(match, trims);
      const interpolated = interpolateReplacement(replaceTemplate, matchTrimmed, groups);
      return replaceMacros(interpolated, {
        macros,
        variableContext: params.variableContext
      });
    });
  }
  return result;
}
function mergeRegexRules(params) {
  const all = [];
  all.push(...params.globalScripts || []);
  all.push(...params.presetScripts || []);
  all.push(...params.characterScripts || []);
  return all;
}
function normalizeRole(raw, fallback = "system") {
  const r = String(raw ?? "").toLowerCase();
  if (r === "system")
    return "system";
  if (r === "user")
    return "user";
  if (r === "model" || r === "assistant")
    return "model";
  return fallback;
}
function isFixedPrompt(p) {
  return p.position === "fixed";
}
function isFixedWorldBookEntry(e) {
  return String(e.position) === "fixed";
}
function assembleTaggedPromptList(params) {
  const {
    presetPrompts,
    activeEntries,
    chatHistory,
    positionMap = { beforeChar: "charBefore", afterChar: "charAfter" },
    chatHistoryIdentifier = "chatHistory"
  } = params;
  const result = [];
  const enabledPrompts = (presetPrompts || []).filter((p) => p && p.enabled !== false);
  const relativePrompts = enabledPrompts.filter((p) => p.position === "relative");
  for (const prompt of relativePrompts) {
    const slotEntries = (activeEntries || []).filter((e) => {
      if (!e)
        return false;
      if (isFixedWorldBookEntry(e))
        return false;
      const mapped = positionMap[String(e.position)] || String(e.position);
      return mapped === prompt.identifier;
    }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const entry of slotEntries) {
      result.push({
        tag: `Worldbook: ${entry.name}`,
        target: "worldBook",
        role: normalizeRole(entry.role ?? "system", "system"),
        text: entry.content ?? ""
      });
    }
    if (prompt.identifier === chatHistoryIdentifier) {
      let dialogueList = (chatHistory || []).map((node) => ({
        tag: `History: ${node.role}`,
        target: node.role === "user" ? "userInput" : node.role === "model" ? "aiOutput" : "slashCommands",
        role: node.role,
        text: node.text,
        historyDepth: node.historyDepth
      }));
      const presetInjections = enabledPrompts.filter((p) => isFixedPrompt(p) && typeof p.depth === "number" && Number.isFinite(p.depth) && typeof p.order === "number" && Number.isFinite(p.order));
      const worldBookInjections = (activeEntries || []).filter((e) => isFixedWorldBookEntry(e) && typeof e.depth === "number" && Number.isFinite(e.depth) && typeof e.order === "number" && Number.isFinite(e.order));
      const allInjections = [
        ...presetInjections.map((p, idx) => ({
          tag: `Preset: ${p.name}`,
          target: "slashCommands",
          role: normalizeRole(p.role, "system"),
          text: p.content || "",
          depth: p.depth,
          order: p.order,
          idx
        })),
        ...worldBookInjections.map((e, idx) => ({
          tag: `Worldbook: ${e.name}`,
          target: "worldBook",
          role: normalizeRole(e.role ?? "system", "system"),
          text: e.content,
          depth: e.depth,
          order: e.order,
          idx: 1e4 + idx
        }))
      ].sort((a, b) => {
        if (a.depth !== b.depth)
          return a.depth - b.depth;
        if (a.order !== b.order)
          return b.order - a.order;
        return b.idx - a.idx;
      });
      const originalCount = dialogueList.length;
      for (const item of allInjections) {
        const targetIndex = Math.max(0, originalCount - item.depth);
        dialogueList.splice(targetIndex, 0, {
          tag: item.tag,
          target: item.target,
          role: item.role,
          text: item.text
        });
      }
      result.push(...dialogueList);
      continue;
    }
    if (prompt.content) {
      result.push({
        tag: `Preset: ${prompt.name}`,
        target: "slashCommands",
        role: normalizeRole(prompt.role, "system"),
        text: prompt.content
      });
    }
  }
  return result;
}
function processContentStages(text, params) {
  const raw = text ?? "";
  const afterPreRegex = raw;
  const afterMacro = replaceMacros(afterPreRegex, {
    macros: params.macros,
    variableContext: params.variableContext
  });
  const afterPostRegex = applyRegex(afterMacro, {
    scripts: params.scripts,
    target: params.target,
    view: params.view,
    macros: params.macros,
    variableContext: params.variableContext,
    historyDepth: params.historyDepth
  });
  return { raw, afterPreRegex, afterMacro, afterPostRegex };
}
function compileTaggedStages(tagged, params) {
  const perItem = [];
  const raw = (tagged || []).map((i) => ({ ...i }));
  const afterPreRegex = [];
  const afterMacro = [];
  const afterPostRegex = [];
  for (const item of raw) {
    const s = processContentStages(item.text, {
      target: item.target,
      view: params.view,
      scripts: params.scripts,
      macros: params.macros,
      variableContext: params.variableContext,
      historyDepth: item.historyDepth
    });
    perItem.push({
      tag: item.tag,
      role: item.role,
      target: item.target,
      historyDepth: item.historyDepth,
      ...s
    });
    afterPreRegex.push({ ...item, text: s.afterPreRegex });
    afterMacro.push({ ...item, text: s.afterMacro });
    afterPostRegex.push({ ...item, text: s.afterPostRegex });
  }
  return {
    stages: { raw, afterPreRegex, afterMacro, afterPostRegex },
    perItem
  };
}
function normalizeRole2(raw, fallback = "user") {
  const r = String(raw ?? "").toLowerCase();
  if (r === "system")
    return "system";
  if (r === "user")
    return "user";
  if (r === "model" || r === "assistant")
    return "model";
  return fallback;
}
function chatMessageToText(m) {
  if (!m)
    return "";
  if ("content" in m)
    return String(m.content ?? "");
  return (m.parts || []).map((p) => ("text" in p) ? p.text ?? "" : "").join("");
}
function toInternalHistory(messages) {
  return (messages || []).map((m) => {
    const role = normalizeRole2(m.role, "user");
    if ("parts" in m) {
      return {
        role,
        ...m.name ? { name: m.name } : {},
        ...typeof m.swipeId === "number" ? { swipeId: m.swipeId } : {},
        parts: (m.parts || []).map((p) => ({ ...p })),
        ...Array.isArray(m.swipes) ? { swipes: m.swipes } : {}
      };
    }
    return {
      role,
      ...m.name ? { name: m.name } : {},
      ...typeof m.swipeId === "number" ? { swipeId: m.swipeId } : {},
      parts: [{ text: String(m.content ?? "") }]
    };
  });
}
function internalHistoryToChatNodes(internal) {
  const list = (internal || []).map((m) => ({
    role: normalizeRole2(m.role, "user"),
    text: chatMessageToText(m)
  }));
  const n = list.length;
  return list.map((x, idx) => ({ ...x, historyDepth: n - 1 - idx }));
}
function taggedToInternal(tagged) {
  return (tagged || []).map((item) => ({
    role: item.role,
    parts: [{ text: item.text ?? "" }]
  }));
}
function applySystemRolePolicy(internal, policy) {
  if (policy === "keep")
    return internal;
  return (internal || []).map((m) => ({
    ...m,
    role: String(m.role || "") === "system" ? "user" : m.role
  }));
}
function buildMacros(userMacros, character) {
  const out = {};
  if (character?.name) {
    out.char = character.name;
  }
  return { ...out, ...userMacros || {} };
}
function normalizePresetCompat(preset) {
  const raw = preset || {};
  return {
    ...raw,
    other: raw.other ?? raw.apiSetting ?? {},
    utilityPrompts: raw.utilityPrompts ?? {}
  };
}
function buildPrompt(params) {
  const {
    preset,
    character,
    globals,
    history,
    macros,
    variables,
    globalVariables,
    view,
    options
  } = params;
  const normalizedPreset = normalizePresetCompat(preset);
  const finalMacros = buildMacros(macros || {}, character);
  const variableContext = createVariableContext(variables, globalVariables);
  const internalHistory = toInternalHistory(history || []);
  const chatNodes = internalHistoryToChatNodes(internalHistory);
  const recentN = options?.recentHistoryForWorldbook ?? 5;
  const recentHistoryText = chatNodes.slice(-recentN).map((n) => n.text).join(`
`);
  const globalWorldBookEntries = normalizeWorldbooks(globals?.worldBooks);
  const activeEntries = getActiveEntries({
    contextText: recentHistoryText,
    globalEntries: globalWorldBookEntries,
    characterWorldBook: character?.worldBook ?? null,
    options: {
      vectorSearch: options?.vectorSearch,
      recursionLimit: options?.recursionLimit,
      rng: options?.rng,
      defaultCaseSensitive: options?.defaultCaseSensitive
    }
  });
  const tagged = assembleTaggedPromptList({
    presetPrompts: normalizedPreset.prompts,
    activeEntries,
    chatHistory: chatNodes,
    positionMap: options?.positionMap
  });
  const globalScripts = normalizeRegexes(globals?.regexScripts);
  const presetScripts = normalizeRegexes(normalizedPreset.regexScripts);
  const characterScripts = normalizeRegexes(character?.regexScripts);
  const scripts = mergeRegexRules({
    globalScripts,
    presetScripts,
    characterScripts
  });
  const compiled = compileTaggedStages(tagged, {
    view,
    scripts,
    macros: finalMacros,
    variableContext
  });
  const taggedStages = compiled.stages;
  const perItem = compiled.perItem;
  const internalStages = {
    raw: taggedToInternal(taggedStages.raw),
    afterPreRegex: taggedToInternal(taggedStages.afterPreRegex),
    afterMacro: taggedToInternal(taggedStages.afterMacro),
    afterPostRegex: taggedToInternal(taggedStages.afterPostRegex)
  };
  const outputFormat = params.outputFormat ?? "gemini";
  const systemRolePolicy = params.systemRolePolicy ?? "keep";
  const internalAfterPolicy = {
    raw: applySystemRolePolicy(internalStages.raw, systemRolePolicy),
    afterPreRegex: applySystemRolePolicy(internalStages.afterPreRegex, systemRolePolicy),
    afterMacro: applySystemRolePolicy(internalStages.afterMacro, systemRolePolicy),
    afterPostRegex: applySystemRolePolicy(internalStages.afterPostRegex, systemRolePolicy)
  };
  const outputStages = outputFormat === "tagged" ? taggedStages : {
    raw: convertMessagesOut(internalAfterPolicy.raw, outputFormat),
    afterPreRegex: convertMessagesOut(internalAfterPolicy.afterPreRegex, outputFormat),
    afterMacro: convertMessagesOut(internalAfterPolicy.afterMacro, outputFormat),
    afterPostRegex: convertMessagesOut(internalAfterPolicy.afterPostRegex, outputFormat)
  };
  return {
    outputFormat,
    systemRolePolicy,
    activeWorldbookEntries: activeEntries,
    mergedRegexScripts: scripts,
    variables: {
      local: { ...variableContext.local },
      global: { ...variableContext.global }
    },
    stages: {
      tagged: taggedStages,
      internal: internalStages,
      output: outputStages,
      perItem
    }
  };
}
var channels_exports = {};
__export(channels_exports, {
  detectMessageFormat: () => detectMessageFormat,
  fromInternalToGemini: () => fromInternalToGemini,
  fromInternalToOpenAI: () => fromInternalToOpenAI,
  fromInternalToTagged: () => fromInternalToTagged,
  fromInternalToText: () => fromInternalToText,
  isGeminiMessages: () => isGeminiMessages,
  isOpenAIChatMessages: () => isOpenAIChatMessages,
  isTaggedContents: () => isTaggedContents,
  isTextInput: () => isTextInput,
  toInternalFromGemini: () => toInternalFromGemini,
  toInternalFromOpenAI: () => toInternalFromOpenAI,
  toInternalFromTagged: () => toInternalFromTagged,
  toInternalFromText: () => toInternalFromText
});

// src/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
function ensureDataDirs(dataDir) {
  for (const sub of ["presets", "characters", "worldbooks", "regex"]) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}
function loadPreset(dataDir, filename) {
  const filePath = path.join(dataDir, "presets", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`预设文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertPresetFromSillyTavern(raw);
}
function loadCharacter(dataDir, filename) {
  const filePath = path.join(dataDir, "characters", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`角色卡文件不存在: ${filePath}`);
  }
  const raw = readJSON(filePath);
  return convertCharacterFromSillyTavern(raw);
}
function loadWorldbooks(dataDir, filenames) {
  const books = [];
  for (const filename of filenames) {
    if (!filename || !filename.trim())
      continue;
    const filePath = path.join(dataDir, "worldbooks", filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`世界书文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    books.push(convertWorldBookFromSillyTavern(raw));
  }
  return books;
}
function loadRegexScripts(dataDir, filenames) {
  const allScripts = [];
  for (const filename of filenames) {
    if (!filename || !filename.trim())
      continue;
    const filePath = path.join(dataDir, "regex", filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`正则脚本文件不存在: ${filePath}`);
    }
    const raw = readJSON(filePath);
    const arr = Array.isArray(raw) ? raw : raw.regex_scripts ?? [raw];
    allScripts.push(...convertRegexesFromSillyTavern(arr));
  }
  return allScripts;
}

// src/assembler.ts
function irisContentsToHistory(contents) {
  const result = [];
  for (const content of contents) {
    const textParts = [];
    for (const part of content.parts) {
      if ("text" in part && part.text && !("functionCall" in part) && !("functionResponse" in part)) {
        if (part.thought)
          continue;
        textParts.push({ text: part.text });
      }
    }
    if (textParts.length === 0)
      continue;
    result.push({
      role: content.role,
      parts: textParts
    });
  }
  return result;
}
function assembledToLLMRequest(assembled, originalRequest) {
  const contents = [];
  for (const msg of assembled) {
    const parts = msg.parts;
    if (!parts || parts.length === 0)
      continue;
    const irisParts = parts.filter((p) => p.text).map((p) => ({ text: p.text }));
    if (irisParts.length === 0)
      continue;
    const role = msg.role === "model" ? "model" : "user";
    contents.push({ role, parts: irisParts });
  }
  return {
    contents,
    systemInstruction: undefined,
    tools: originalRequest.tools,
    generationConfig: originalRequest.generationConfig
  };
}
function formatTaggedForLog(result) {
  const tagged = result.stages.tagged.afterPostRegex;
  const lines = ["=== SillyTavern Assembled Prompt ==="];
  for (const item of tagged) {
    const roleTag = `[${item.role}]`;
    const label = item.tag;
    const preview = item.text.length > 200 ? item.text.slice(0, 200) + "..." : item.text;
    lines.push(`${roleTag} ${label}: ${preview}`);
  }
  lines.push(`=== Total items: ${tagged.length} ===`);
  return lines.join(`
`);
}

// src/config-template.ts
var defaultConfigTemplate = `# ─────────────────────────────────────────────
# SillyTavern 提示词引擎配置
# ─────────────────────────────────────────────
#
# 数据目录位于 ~/.iris/extension-data/sillytavern/
# 请将酒馆导出的 JSON 文件放入对应子目录：
#   presets/       预设文件
#   characters/    角色卡文件
#   worldbooks/    世界书文件
#   regex/         正则脚本文件

sillytavern:
  # 是否启用（启用后将接管 Iris 默认的提示词组装）
  enabled: false

  # 当前激活的预设文件名（presets/ 目录下）
  preset: ""

  # 当前激活的角色卡文件名（characters/ 目录下，留空则不使用）
  character: ""

  # 全局世界书文件名列表（worldbooks/ 目录下）
  worldbooks: []

  # 全局正则脚本文件名列表（regex/ 目录下）
  regex: []

  # 宏变量（对应酒馆的 {{user}}、{{char}} 等）
  # char 会从角色卡自动提取，一般只需设置 user
  macros:
    user: "User"

  # 调试模式：将组装后的提示词结构输出到日志
  debug: true
`;

// src/index.ts
var src_default = definePlugin({
  name: "sillytavern",
  version: "0.1.0",
  description: "SillyTavern 提示词引擎 — 使用酒馆格式的预设、角色卡、世界书、正则组装提示词",
  activate(ctx) {
    const log = createPluginLogger("sillytavern");
    ctx.ensureConfigFile("sillytavern.yaml", defaultConfigTemplate);
    const dataDir = ctx.getDataDir();
    ensureDataDirs(dataDir);
    const rawConfig = ctx.readConfigSection("sillytavern");
    const config = {
      enabled: false,
      preset: "",
      character: "",
      worldbooks: [],
      regex: [],
      macros: { user: "User" },
      debug: true,
      ...rawConfig?.sillytavern ?? rawConfig ?? {}
    };
    if (!config.enabled) {
      log.info("SillyTavern 插件已禁用（enabled: false）");
      return;
    }
    if (!config.preset) {
      log.warn("未配置预设文件（preset），插件不会生效");
      return;
    }
    log.info(`数据目录: ${dataDir}`);
    let preset;
    let character;
    let worldbooks;
    let regexScripts;
    try {
      preset = loadPreset(dataDir, config.preset);
      log.info(`预设已加载: ${config.preset} (${preset.prompts.length} prompts)`);
    } catch (e) {
      log.error(`加载预设失败: ${e.message}`);
      return;
    }
    try {
      if (config.character) {
        character = loadCharacter(dataDir, config.character);
        log.info(`角色卡已加载: ${character.name}`);
      }
    } catch (e) {
      log.error(`加载角色卡失败: ${e.message}`);
      return;
    }
    try {
      worldbooks = loadWorldbooks(dataDir, config.worldbooks);
      if (worldbooks.length > 0) {
        log.info(`世界书已加载: ${worldbooks.length} 个文件`);
      }
    } catch (e) {
      log.error(`加载世界书失败: ${e.message}`);
      return;
    }
    try {
      regexScripts = loadRegexScripts(dataDir, config.regex);
      if (regexScripts.length > 0) {
        log.info(`正则脚本已加载: ${regexScripts.length} 条`);
      }
    } catch (e) {
      log.error(`加载正则脚本失败: ${e.message}`);
      return;
    }
    ctx.addHook({
      name: "sillytavern:build-prompt",
      onBeforeLLMCall({ request, round }) {
        if (round > 1)
          return;
        try {
          const history = irisContentsToHistory(request.contents);
          let lastUserMessage = "";
          for (let i = history.length - 1;i >= 0; i--) {
            const message = history[i];
            if (message.role === "user") {
              if ("parts" in message && Array.isArray(message.parts)) {
                lastUserMessage = message.parts.map((part) => ("text" in part) ? part.text : "").join("");
              } else if ("content" in message && typeof message.content === "string") {
                lastUserMessage = message.content;
              }
              break;
            }
          }
          const result = buildPrompt({
            preset,
            character,
            globals: {
              worldBooks: worldbooks,
              regexScripts
            },
            history,
            view: "model",
            macros: {
              ...config.macros,
              lastUserMessage
            },
            outputFormat: "gemini",
            systemRolePolicy: "keep"
          });
          if (config.debug) {
            const debugText = formatTaggedForLog(result);
            log.info(debugText);
            try {
              const debugFile = path2.join(dataDir, "last-prompt-debug.txt");
              fs2.writeFileSync(debugFile, debugText, "utf-8");
              log.info(`调试输出已写入: ${debugFile}`);
            } catch {}
          }
          const assembled = result.stages.output.afterPostRegex;
          const newRequest = assembledToLLMRequest(assembled, request);
          return { request: newRequest };
        } catch (e) {
          log.error(`提示词组装失败: ${e.message}`);
          return;
        }
      }
    });
    log.info("SillyTavern 提示词引擎已启用");
  }
});
export {
  src_default as default
};
