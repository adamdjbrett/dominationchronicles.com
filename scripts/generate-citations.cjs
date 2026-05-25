#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const EPISODES_DIR = path.join(__dirname, '..', 'content', 'episodes');
const OUT_DIR = path.join(__dirname, '..', 'public', 'citations');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function parseFrontMatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return yaml.load(match[1]) || {};
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  return cleanText(value);
}

function toRIS(meta, slug) {
  const title = cleanText(meta.title) || slug;
  const description = cleanText(meta.description);
  const publishDate = formatDate(meta.publishDate);
  const lines = [];
  lines.push('TY  - GEN');
  lines.push(`TI  - ${title}`);
  if (publishDate) lines.push(`DA  - ${publishDate}`);
  lines.push(`UR  - https://dominationchronicles.com/episodes/${slug}/`);
  if (description) lines.push(`N1  - ${description}`);
  if (Array.isArray(meta.tags)) meta.tags.forEach(t => lines.push(`KW  - ${cleanText(t)}`));
  lines.push('PB  - The Domination Chronicles Podcast');
  if (meta.image) lines.push(`L3  - ${cleanText(meta.image)}`);
  lines.push(`T1  - ${title}`);
  lines.push('ER  -');
  return lines.join('\n') + '\n';
}

function toCSLJSON(meta, slug) {
  const title = cleanText(meta.title) || slug;
  const description = cleanText(meta.description);
  const publishDate = formatDate(meta.publishDate);
  const url = `https://dominationchronicles.com/episodes/${slug}/`;
  let issued;
  if (publishDate) {
    const d = publishDate.split('-').map(n => parseInt(n, 10));
    if (d.length === 3) issued = { 'date-parts': [[d[0], d[1], d[2]]] };
    else if (d.length === 2) issued = { 'date-parts': [[d[0], d[1]]] };
    else issued = { 'date-parts': [[d[0]]] };
  }
  const obj = {
    id: slug,
    type: 'broadcast',
    title,
    abstract: description,
    URL: url,
    language: 'en',
    source: 'The Domination Chronicles Podcast'
  };
  if (issued) obj.issued = issued;
  if (Array.isArray(meta.tags)) obj.keyword = meta.tags.map(cleanText).filter(Boolean);
  if (meta.duration) obj.duration = cleanText(meta.duration);
  if (meta.image) obj.container = cleanText(meta.image);
  return JSON.stringify([obj], null, 2) + '\n';
}

function run() {
  ensureDir(OUT_DIR);
  const files = fs.readdirSync(EPISODES_DIR).filter(f => f.endsWith('.md'));
  let generated = 0;
  let skipped = 0;
  files.forEach(file => {
    const slug = path.basename(file, '.md');
    const md = fs.readFileSync(path.join(EPISODES_DIR, file), 'utf8');
    const meta = parseFrontMatter(md);
    if (meta.published === false) {
      skipped++;
      return;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.ris`), toRIS(meta, slug));
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.csl.json`), toCSLJSON(meta, slug));
    generated++;
  });
  console.log(`Citations: ${generated} generated, ${skipped} unpublished skipped. Output directory: ${OUT_DIR}`);
}

run();
