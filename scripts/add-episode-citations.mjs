import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const EPISODES_DIR = path.join(process.cwd(), "content", "episodes");
const USER_AGENT = "dominationchronicles.com FAIR citation metadata updater";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || args.has("--check");

function parseFrontMatter(contents, file) {
	if (!contents.startsWith("---\n")) {
		return null;
	}
	const end = contents.indexOf("\n---", 4);
	if (end === -1) {
		throw new Error(`Could not find closing front matter marker in ${file}`);
	}
	return {
		data: yaml.load(contents.slice(4, end)) || {},
		body: contents.slice(end + 4).replace(/^\r?\n/, ""),
	};
}

function serializeFrontMatter(data, body) {
	return `---\n${yaml.dump(data, {
		lineWidth: 100,
		noRefs: true,
		sortKeys: false,
	})}---\n${body}`;
}

function cleanText(value = "") {
	return String(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value = "") {
	return cleanText(
		String(value)
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
	);
}

function decodeHtml(value = "") {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.trim();
}

function cleanObject(value) {
	if (Array.isArray(value)) {
		return value
			.map(cleanObject)
			.filter((item) => item !== undefined && item !== null && item !== "");
	}
	if (!value || typeof value !== "object" || value instanceof Date) {
		return value;
	}
	const cleaned = {};
	for (const [key, item] of Object.entries(value)) {
		const next = cleanObject(item);
		if (next !== undefined && next !== null && next !== "" && !(Array.isArray(next) && next.length === 0)) {
			cleaned[key] = next;
		}
	}
	return cleaned;
}

function normalizeAuthor(author) {
	if (!author) return undefined;
	if (Array.isArray(author)) {
		const authors = author.map(normalizeAuthor).filter(Boolean);
		return authors.length === 1 ? authors[0] : authors;
	}
	if (typeof author === "string") {
		return {
			"@type": "Person",
			name: author,
		};
	}
	return cleanObject({
		"@type": author.type || author["@type"] || "Person",
		"@id": author["@id"] || author.identifier || author.orcid || author.url,
		name: author.name,
		url: author.url,
		identifier: author.identifier || author.orcid,
		affiliation: author.affiliation,
	});
}

function normalizeIsPartOf(isPartOf) {
	if (!isPartOf) return undefined;
	if (typeof isPartOf === "string") {
		return {
			"@type": "CreativeWork",
			name: isPartOf,
		};
	}
	return cleanObject({
		"@type": isPartOf.type || isPartOf["@type"] || "CreativeWork",
		name: isPartOf.name,
		url: isPartOf.url,
	});
}

function normalizeManualReference(ref) {
	return cleanObject({
		"@type": ref.type || ref["@type"] || "CreativeWork",
		"@id": ref["@id"] || ref.id || ref.identifier || ref.url,
		name: ref.title || ref.name,
		url: ref.url,
		datePublished: ref.date || ref.datePublished,
		inLanguage: ref.language || ref.inLanguage,
		license: ref.license,
		author: normalizeAuthor(ref.author),
		isPartOf: normalizeIsPartOf(ref.isPartOf),
	});
}

function doiFromUrl(value) {
	const match = String(value || "").trim().match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
	return match ? decodeURIComponent(match[1]).trim() : "";
}

async function fetchJson(url) {
	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
		},
		signal: AbortSignal.timeout(12000),
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	return response.json();
}

function crossrefDate(message) {
	const parts = message?.published?.["date-parts"]?.[0] || message?.issued?.["date-parts"]?.[0];
	if (!parts?.length) return undefined;
	const [year, month = 1, day = 1] = parts;
	return [
		String(year).padStart(4, "0"),
		String(month).padStart(2, "0"),
		String(day).padStart(2, "0"),
	].join("-");
}

function crossrefAuthors(authors = []) {
	return authors.map((author) => {
		const name = [author.given, author.family].filter(Boolean).join(" ").trim() || author.name;
		return cleanObject({
			"@type": "Person",
			name,
			affiliation: author.affiliation?.[0]?.name
				? {
					"@type": "Organization",
					name: author.affiliation[0].name,
				}
				: undefined,
		});
	});
}

async function citationFromDoi(url) {
	const doi = doiFromUrl(url);
	if (!doi) return null;

	try {
		const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
		const message = data.message || {};
		return cleanObject({
			"@type": message.type === "journal-article" ? "ScholarlyArticle" : "CreativeWork",
			"@id": `https://doi.org/${doi}`,
			name: message.title?.[0],
			url: message.URL || `https://doi.org/${doi}`,
			author: crossrefAuthors(message.author),
			datePublished: crossrefDate(message),
			publisher: message.publisher
				? {
					"@type": "Organization",
					name: message.publisher,
				}
				: undefined,
			isPartOf: message["container-title"]?.[0]
				? {
					"@type": "Periodical",
					name: message["container-title"][0],
				}
				: undefined,
		});
	} catch {
		return cleanObject({
			"@type": "CreativeWork",
			"@id": `https://doi.org/${doi}`,
			name: `DOI ${doi}`,
			url: `https://doi.org/${doi}`,
		});
	}
}

function extractMeta(html, property) {
	const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
	const match = html.match(pattern);
	return match ? decodeHtml(match[1]) : "";
}

function firstJsonLd(html) {
	const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[1].trim());
		if (Array.isArray(parsed)) return parsed[0];
		if (parsed["@graph"]) {
			return parsed["@graph"].find((item) => item["@type"] === "ScholarlyArticle" || item["@type"] === "Article" || item["@type"] === "Book" || item["@type"] === "WebPage") || parsed["@graph"][0];
		}
		return parsed;
	} catch {
		return null;
	}
}

async function citationFromWebPage(url) {
	const response = await fetch(url, {
		headers: {
			Accept: "text/html,application/xhtml+xml",
			"User-Agent": USER_AGENT,
		},
		signal: AbortSignal.timeout(12000),
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	const html = await response.text();
	const jsonLd = firstJsonLd(html);
	const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || url;
	const title = jsonLd?.headline || jsonLd?.name || extractMeta(html, "og:title") || extractMeta(html, "dc.title") || extractMeta(html, "dc:title") || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
	const author = jsonLd?.author || extractMeta(html, "article:author") || extractMeta(html, "dc.creator") || extractMeta(html, "dc:creator") || extractMeta(html, "author");
	const datePublished = jsonLd?.datePublished || extractMeta(html, "article:published_time") || extractMeta(html, "dc.date") || extractMeta(html, "dc:date");
	const siteName = jsonLd?.isPartOf?.name || extractMeta(html, "og:site_name");
	let origin = "";
	try {
		origin = new URL(canonical).origin;
	} catch {
		origin = "";
	}

	return cleanObject({
		"@type": jsonLd?.["@type"] || "WebPage",
		"@id": jsonLd?.["@id"] || canonical,
		name: title || url,
		url: canonical,
		datePublished,
		inLanguage: jsonLd?.inLanguage,
		license: jsonLd?.license,
		author: normalizeAuthor(author),
		isPartOf: siteName
			? {
				"@type": "WebSite",
				name: siteName,
				url: origin,
			}
			: undefined,
	});
}

function extractResourcesSection(body) {
	const start = body.search(/^##+\s+\*{0,2}Resources\*{0,2}\s*:?\s*$/im);
	if (start === -1) {
		return "";
	}
	const section = body.slice(start);
	const nextHeading = section.slice(1).search(/^##+\s+/m);
	return nextHeading === -1 ? section : section.slice(0, nextHeading + 1);
}

function extractUrlsFromResources(body) {
	const resources = extractResourcesSection(body);
	if (!resources) return [];
	const urls = [];
	const seen = new Set();
	for (const match of resources.matchAll(/https?:\/\/[^\s<>)\]]+/g)) {
		const url = match[0].replace(/[.,;:!?]+$/g, "");
		if (!seen.has(url)) {
			seen.add(url);
			urls.push(url);
		}
	}
	return urls;
}

async function resolveReference(ref) {
	if (ref && typeof ref === "object" && !Array.isArray(ref)) {
		return normalizeManualReference(ref);
	}
	if (typeof ref !== "string") {
		return null;
	}
	const url = ref.split(/\s+#/)[0].trim();
	if (!url) return null;
	if (doiFromUrl(url)) {
		return citationFromDoi(url);
	}
	try {
		return await citationFromWebPage(url);
	} catch {
		return cleanObject({
			"@type": "WebPage",
			"@id": url,
			name: url,
			url,
		});
	}
}

function isIncomplete(citation) {
	return !citation?.name || !citation?.url;
}

async function main() {
	const files = (await readdir(EPISODES_DIR)).filter((file) => file.endsWith(".md")).sort();
	let checked = 0;
	let changed = 0;
	let incomplete = 0;

	for (const file of files) {
		const fullPath = path.join(EPISODES_DIR, file);
		const original = await readFile(fullPath, "utf8");
		const parsed = parseFrontMatter(original, file);
		if (!parsed || parsed.data.published === false || parsed.data.draft === true) {
			continue;
		}

		const references = Array.isArray(parsed.data.references) && parsed.data.references.length
			? parsed.data.references
			: extractUrlsFromResources(parsed.body);
		if (!references.length) {
			continue;
		}

		checked += 1;
		const citations = [];
		for (const ref of references) {
			const citation = await resolveReference(ref);
			if (citation) {
				citations.push(citation);
				if (isIncomplete(citation)) {
					incomplete += 1;
					console.warn(`[fair-citations] Incomplete citation in ${file}: ${JSON.stringify(ref)}`);
				}
			}
		}

		const nextData = {
			...parsed.data,
			citations,
		};
		const next = serializeFrontMatter(nextData, parsed.body);
		if (next !== original) {
			changed += 1;
			if (!dryRun) {
				await writeFile(fullPath, next, "utf8");
			}
			console.log(`[fair-citations] ${dryRun ? "Would update" : "Updated"} ${file} (${citations.length} citation${citations.length === 1 ? "" : "s"})`);
		}
	}

	console.log(`[fair-citations] Checked ${checked} episode${checked === 1 ? "" : "s"} with references/resources.`);
	console.log(`[fair-citations] ${dryRun ? "Would update" : "Updated"} ${changed} file${changed === 1 ? "" : "s"}.`);
	if (incomplete > 0) {
		console.warn(`[fair-citations] ${incomplete} citation${incomplete === 1 ? "" : "s"} may need manual cleanup.`);
		process.exitCode = dryRun ? 1 : 0;
	}
}

main().catch((error) => {
	console.error(`[fair-citations] ${error.stack || error.message}`);
	process.exit(1);
});
