import { getEnrichedEpisodes } from "../scripts/lib/episode-metadata.mjs";

export default async function () {
	return getEnrichedEpisodes({
		failOnMissingAudio: process.env.ELEVENTY_ENV === "production",
	});
}
