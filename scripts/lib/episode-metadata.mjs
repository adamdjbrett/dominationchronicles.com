import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import Parser from "rss-parser";
import EleventyFetch from "@11ty/eleventy-fetch";

const EPISODES_DIR = "content/episodes";
const METADATA_PATH = "_data/metadata.yaml";
const DEFAULT_SITE_URL = "https://dominationchronicles.com";

function cleanText(value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

function stripMarkdown(value) {
	return cleanText(
		String(value || "")
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[#>*_~\-]+/g, " ")
	);
}

function parseFrontMatter(markdown) {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) {
		return { data: {}, body: markdown };
	}
	return {
		data: yaml.load(match[1]) || {},
		body: markdown.slice(match[0].length),
	};
}

function normalizeDate(value) {
	if (!value) {
		return "";
	}
	if (value instanceof Date && !Number.isNaN(value.valueOf())) {
		return value.toISOString();
	}
	const date = new Date(value);
	if (!Number.isNaN(date.valueOf())) {
		return date.toISOString();
	}
	return cleanText(value);
}

function absoluteUrl(value, siteUrl) {
	if (!value) {
		return "";
	}
	const normalized = String(value)
		.trim()
		.replace(/^public\//, "")
		.replace(/^\/public\//, "/")
		.replace(/^pdfs\//, "/pdfs/");
	return new URL(normalized, siteUrl || DEFAULT_SITE_URL).href;
}

function getRedcircleEpisodeId(data) {
	const candidates = [
		data.redcircle_embed,
		data.redcircle?.id,
		data.redcircle?.url,
	].filter(Boolean);
	for (const candidate of candidates) {
		const text = String(candidate);
		const epMatch = text.match(/\/ep\/([A-Za-z0-9-]+)/);
		if (epMatch) {
			return epMatch[1].replace(/\?$/, "");
		}
		if (/^[A-Za-z0-9-]{20,}$/.test(text)) {
			return text.replace(/\?$/, "");
		}
	}
	return "";
}

function getVideoUrl(data) {
	const videoId = cleanText(data.videoId);
	if (!videoId) {
		return "";
	}
	return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function extractTranscriptUrl(body, siteUrl) {
	const transcriptStart = body.search(/^##+\s+Transcript\b/im);
	if (transcriptStart === -1) {
		return "";
	}
	const transcriptBlock = body.slice(transcriptStart);
	const nextSection = transcriptBlock.slice(1).search(/^##\s+/m);
	const section = nextSection === -1 ? transcriptBlock : transcriptBlock.slice(0, nextSection + 1);
	const matches = [...section.matchAll(/\[[^\]]*\]\(([^)]+\.pdf)\)/gi)];
	for (const match of matches) {
		const href = match[1].trim();
		if (!/^https?:\/\//i.test(href)) {
			return absoluteUrl(href, siteUrl);
		}
		if (href.startsWith(siteUrl || DEFAULT_SITE_URL)) {
			return href;
		}
	}
	return "";
}

async function readMetadata(projectRoot) {
	const raw = await fs.readFile(path.join(projectRoot, METADATA_PATH), "utf8");
	return yaml.load(raw) || {};
}

async function fetchRedcircleItems(rssUrl, options = {}) {
	if (!rssUrl) {
		return [];
	}
	const parser = new Parser({
		customFields: {
			item: [
				["content:encoded", "encodedContent"],
				["itunes:duration", "itunesDuration"],
				["itunes:episodeUrl", "episodePageUrl"],
				["itunes:permalink", "permalinkUrl"],
			],
		},
	});
	const feedText = await EleventyFetch(rssUrl, {
		duration: options.cacheDuration || (process.env.ELEVENTY_ENV === "production" ? "12h" : "1h"),
		type: "text",
		encoding: "utf-8",
	});
	return (await parser.parseString(feedText)).items || [];
}

function indexRedcircleItems(items) {
	const index = new Map();
	for (const item of items) {
		const haystack = [
			item.guid,
			item.id,
			item.link,
			item.permalinkUrl,
			item.episodePageUrl,
			item.enclosure?.url,
			item.content,
			item.encodedContent,
		].filter(Boolean).join(" ");
		const ids = [
			...[...haystack.matchAll(/\/ep\/([A-Za-z0-9-]+)/g)].map(match => match[1].replace(/\?$/, "")),
			...[...haystack.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)].map(match => match[0]),
		];
		for (const id of ids) {
			if (!index.has(id)) {
				index.set(id, item);
			}
		}
	}
	return index;
}

async function readEpisodeFiles(projectRoot) {
	const episodeDir = path.join(projectRoot, EPISODES_DIR);
	const files = (await fs.readdir(episodeDir)).filter(file => file.endsWith(".md")).sort();
	return Promise.all(files.map(async (file) => {
		const markdown = await fs.readFile(path.join(episodeDir, file), "utf8");
		const { data, body } = parseFrontMatter(markdown);
		const slug = path.basename(file, ".md");
		return { file, slug, data, body };
	}));
}

function normalizeTags(tags) {
	if (!tags) {
		return [];
	}
	if (Array.isArray(tags)) {
		return tags.map(cleanText).filter(Boolean).filter(tag => tag !== "episodes");
	}
	return [cleanText(tags)].filter(Boolean).filter(tag => tag !== "episodes");
}

function enrichEpisode(episode, metadata, redcircleIndex, options) {
	const siteUrl = metadata.url || DEFAULT_SITE_URL;
	const redcircleEpisodeId = getRedcircleEpisodeId(episode.data);
	const redcircleItem = redcircleEpisodeId ? redcircleIndex.get(redcircleEpisodeId) : null;
	const audioUrl = redcircleItem?.enclosure?.url || "";
	if (options.failOnMissingAudio && redcircleEpisodeId && !audioUrl) {
		throw new Error(`No RedCircle RSS enclosure found for ${episode.file} (${redcircleEpisodeId})`);
	}
	const pathUrl = `/episodes/${episode.slug}/`;
	const transcriptUrl = extractTranscriptUrl(episode.body, siteUrl);
	const videoUrl = getVideoUrl(episode.data);
	const description = cleanText(episode.data.description) || stripMarkdown(episode.body).slice(0, 300);
	return {
		...episode.data,
		file: episode.file,
		slug: episode.slug,
		path: pathUrl,
		url: absoluteUrl(pathUrl, siteUrl),
		title: cleanText(episode.data.title) || episode.slug,
		description,
		publishedAt: normalizeDate(episode.data.publishDate),
		tags: normalizeTags(episode.data.tags),
		textContent: stripMarkdown(episode.body),
		redcircleEpisodeId,
		audioUrl,
		audioType: redcircleItem?.enclosure?.type || "audio/mpeg",
		audioLength: redcircleItem?.enclosure?.length || 0,
		transcriptUrl,
		transcriptType: transcriptUrl ? "application/pdf" : "",
		videoUrl,
	};
}

export async function getEnrichedEpisodes(options = {}) {
	const projectRoot = options.projectRoot || process.cwd();
	const metadata = await readMetadata(projectRoot);
	const episodes = (await readEpisodeFiles(projectRoot)).filter(episode => episode.data.published !== false);
	const redcircleItems = await fetchRedcircleItems(metadata.podcast_rss?.url, options);
	const redcircleIndex = indexRedcircleItems(redcircleItems);
	return episodes
		.map(episode => enrichEpisode(episode, metadata, redcircleIndex, options))
		.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
}

export async function getSiteMetadata(options = {}) {
	return readMetadata(options.projectRoot || process.cwd());
}
