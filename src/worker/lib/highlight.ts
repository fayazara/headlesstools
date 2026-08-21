import { createHighlighterCore, type HighlighterCore, type ThemeInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// theme colors mirror landing.css (--color-ink / --color-dim / --color-accent / --color-line)
// so highlighted code blends into the terminal chrome instead of importing a foreign palette
const theme: ThemeInput = {
	name: "hlt-terminal",
	type: "light",
	bg: "#ffffff",
	fg: "#111111",
	settings: [
		{
			scope: ["comment"],
			settings: { fontStyle: "italic", foreground: "#6b6b6b" },
		},
		{
			scope: ["string", "string.quoted", "constant.other.placeholder"],
			settings: { foreground: "#c2410c" },
		},
		{
			scope: ["variable", "variable.parameter", "support.function.builtin.shell"],
			settings: { foreground: "#6b6b6b" },
		},
		{
			scope: ["keyword", "keyword.control", "keyword.operator", "punctuation.definition.variable"],
			settings: { foreground: "#111111", fontStyle: "bold" },
		},
		{
			scope: ["entity.name.function", "support.function", "meta.function-call"],
			settings: { foreground: "#111111", fontStyle: "bold" },
		},
		{
			scope: [
				"support.type.property-name.json",
				"entity.other.attribute-name",
				"entity.name.tag",
			],
			settings: { foreground: "#111111", fontStyle: "bold" },
		},
		{
			scope: ["constant.numeric", "constant.language", "constant.other"],
			settings: { foreground: "#111111" },
		},
		{
			scope: ["punctuation", "meta.brace"],
			settings: { foreground: "#6b6b6b" },
		},
	],
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			themes: [theme],
			langs: [() => import("shiki/langs/bash.mjs"), () => import("shiki/langs/json.mjs")],
			engine: createJavaScriptRegexEngine(),
		});
	}
	return highlighterPromise;
}

export type DocLang = "bash" | "json";

export async function highlightCode(code: string, lang: DocLang): Promise<string> {
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, { lang, theme: "hlt-terminal" });
}
