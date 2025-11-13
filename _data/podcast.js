import fetch from 'node-fetch';
import Parser from 'rss-parser';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

const METADATA_PATH = path.join(process.cwd(), '_data', 'metadata.yaml');

export default async function() {
    let metadata = {};
    try {
        const metadataContent = await fs.readFile(METADATA_PATH, 'utf8');
        metadata = yaml.load(metadataContent);
    } catch (error) {
        console.error("❌ ERROR: can't read metadata.yaml.");
        return [];
    }

    const REDCIRCLE_RSS_URL = metadata.podcast_rss?.url; 
    
    if (!REDCIRCLE_RSS_URL) {
        console.error("❌ ERROR: URL RSS not found on metadata.yaml.");
        return [];
    }

    try {
        const parser = new Parser({
            customFields: {
                item: [
                    ['itunes:image', 'episodeImage', {keepArray: true}],
                ]
            }
        });

        const feedResponse = await fetch(REDCIRCLE_RSS_URL); 

        if (!feedResponse.ok) {
            throw new Error(`Gagal mengambil feed. HTTP Status: ${feedResponse.status}`);
        }

        const feedText = await feedResponse.text();
        const feed = await parser.parseString(feedText);

        const episodes = feed.items.map(item => {
            
            let episodeImageUrl = 'placeholder.png'; 
            if (item.episodeImage && item.episodeImage.length > 0) {
                episodeImageUrl = item.episodeImage[0].href || item.episodeImage[0].url || 'placeholder.png';
            }
            
            if (episodeImageUrl === 'placeholder.png' && feed.image && feed.image.url) {
                 episodeImageUrl = feed.image.url;
            }
            
            // Menggunakan title untuk slug, tetapi fallback ke link jika title kosong
            const slugSource = item.title || item.link || ''; 
            const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '');

            return {
                title: item.title,
                // PERBAIKAN: Menyimpan URL Asli di properti 'originalUrl'
                originalUrl: item.link, 
                // Biarkan 'url' menjadi slug lokal Eleventy
                url: `/episodes/${slug}/`, 
                image: episodeImageUrl, 
                pubDate: item.pubDate,
            };
        });

        console.log(`✅ SUCCESS: Load ${episodes.length} episode from RedCircle. as 'podcast'.`);
        return episodes;

    } catch (error) {
        console.error("❌ FATAL ERROR: Parsing/Fetch RSS RedCircle failed:", error.message);
        return [];
    }
}