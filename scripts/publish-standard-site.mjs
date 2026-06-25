#!/usr/bin/env node
import { AtpAgent } from "@atproto/api";
import { getEnrichedEpisodes, getSiteMetadata } from "./lib/episode-metadata.mjs";

const PUBLICATION_RKEY = "dominationchronicles";
const PUBLICATION_COLLECTION = "site.standard.publication";
const DOCUMENT_COLLECTION = "site.standard.document";
const DEFAULT_HANDLE = "dominationchron.bsky.social";
const DEFAULT_SERVICE = "https://bsky.social";
const DEFAULT_DID = "did:plc:nflc5vo7sxtvd5g3v4wnvpfb";

function usageError(message) {
	console.error(message);
	process.exitCode = 1;
}

function publicationAtUri(did) {
	return `at://${did}/${PUBLICATION_COLLECTION}/${PUBLICATION_RKEY}`;
}

function documentAtUri(did, slug) {
	return `at://${did}/${DOCUMENT_COLLECTION}/${slug}`;
}

function episodeRecord(episode, siteAtUri, contributorDid) {
	const record = {
		$type: DOCUMENT_COLLECTION,
		site: siteAtUri,
		path: episode.path,
		title: episode.title,
		description: episode.description,
		publishedAt: episode.publishedAt,
		tags: episode.tags,
		textContent: episode.textContent,
		contributors: [
			{ did: contributorDid, role: "host", displayName: "Steven T. Newcomb" },
			{ did: contributorDid, role: "host", displayName: "Peter d’Errico" },
		],
		links: [
			{ $type: "site.standard.document#externalLink", uri: episode.url, title: "Episode page" },
		],
	};
	if (episode.videoUrl) {
		record.links.push({ $type: "site.standard.document#externalLink", uri: episode.videoUrl, title: "YouTube video" });
	}
	if (episode.audioUrl) {
		record.links.push({ $type: "site.standard.document#externalLink", uri: episode.audioUrl, title: "Audio" });
	}
	if (episode.transcriptUrl) {
		record.links.push({ $type: "site.standard.document#externalLink", uri: episode.transcriptUrl, title: "Transcript PDF" });
	}
	return record;
}

async function putRecord(agent, repo, collection, rkey, record, dryRun) {
	if (dryRun) {
		console.log(`[dry-run] put ${collection}/${rkey}`);
		return { uri: `at://${repo}/${collection}/${rkey}` };
	}
	const response = await agent.com.atproto.repo.putRecord({
		repo,
		collection,
		rkey,
		record,
		validate: false,
	});
	console.log(`Published ${response.data.uri}`);
	return response.data;
}

async function main() {
	const dryRun = process.env.ATPROTO_DRY_RUN === "1" || process.env.ATPROTO_DRY_RUN === "true";
	const handle = process.env.ATPROTO_HANDLE || DEFAULT_HANDLE;
	const service = process.env.ATPROTO_SERVICE || DEFAULT_SERVICE;
	const password = process.env.ATPROTO_APP_PASSWORD;
	const metadata = await getSiteMetadata();
	const did = metadata.atproto?.did || DEFAULT_DID;
	const siteUrl = metadata.url || "https://dominationchronicles.com";
	const siteAtUri = metadata.atproto?.standard_site_publication_uri || publicationAtUri(did);
	const episodes = await getEnrichedEpisodes({ failOnMissingAudio: true });

	if (!dryRun && !password) {
		usageError("ATPROTO_APP_PASSWORD is required unless ATPROTO_DRY_RUN=1.");
		return;
	}

	const publicationRecord = {
		$type: PUBLICATION_COLLECTION,
		url: siteUrl.replace(/\/$/, ""),
		name: metadata.title || "Domination Chronicles Podcast",
		description: metadata.description || "",
		preferences: {
			showInDiscover: true,
		},
	};

	if (dryRun) {
		console.log(`[dry-run] publication ${siteAtUri}`);
		console.log(`[dry-run] ${episodes.length} published episode document record(s)`);
	} else {
		const agent = new AtpAgent({ service });
		await agent.login({ identifier: handle, password });
		const repo = agent.session?.did || did;
		await putRecord(agent, repo, PUBLICATION_COLLECTION, PUBLICATION_RKEY, publicationRecord, false);
		for (const episode of episodes) {
			await putRecord(agent, repo, DOCUMENT_COLLECTION, episode.slug, episodeRecord(episode, siteAtUri, did), false);
		}
		return;
	}

	for (const episode of episodes) {
		console.log(`[dry-run] document ${documentAtUri(did, episode.slug)} ${episode.title}`);
		if (!episode.audioUrl) {
			throw new Error(`Missing audio URL for ${episode.file}`);
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
