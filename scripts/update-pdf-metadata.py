#!/usr/bin/env python3
import datetime as dt
import html
import re
import shutil
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

import yaml
from pypdf import PdfReader, PdfWriter

ROOT = Path(__file__).resolve().parents[1]
EPISODES_DIR = ROOT / "content" / "episodes"
PDFS_DIR = ROOT / "public" / "pdfs"
SITE_URL = "https://dominationchronicles.com"
AUTHORS = ["Steven T. Newcomb", "Peter d'Errico"]
AUTHOR_TEXT = "Steven T. Newcomb and Peter d'Errico"
PUBLISHER = "The Domination Chronicles Podcast"
LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
LANGUAGE = "en-US"


def clean_text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def pdf_date(value):
    if not value:
        return ""
    if isinstance(value, dt.datetime):
        date = value.date()
    elif isinstance(value, dt.date):
        date = value
    else:
        date = dt.date.fromisoformat(str(value))
    return f"D:{date:%Y%m%d}000000Z"


def iso_date(value):
    if not value:
        return ""
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    return str(value)


def front_matter(path):
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---", text, re.S)
    if not match:
        return {}, text
    return yaml.safe_load(match.group(1)) or {}, text


def find_pdf_links(markdown):
    return re.findall(r"\(/pdfs/([^)]+?\.pdf)\)", markdown)


def episode_slug(path):
    return path.stem


def episode_number(slug):
    match = re.match(r"e(\d+)", slug)
    return match.group(1) if match else ""


def rdf_bag(values):
    items = "".join(f"<rdf:li>{escape(clean_text(v))}</rdf:li>" for v in values if clean_text(v))
    return f"<rdf:Bag>{items}</rdf:Bag>"


def rdf_alt(value):
    return f'<rdf:Alt><rdf:li xml:lang="x-default">{escape(clean_text(value))}</rdf:li></rdf:Alt>'


def xmp_packet(data):
    title = data["title"]
    description = data["description"]
    episode_url = data["episode_url"]
    pdf_url = data["pdf_url"]
    publish_date = data["publish_date"]
    subjects = data["subjects"]
    episode = data["episode"]
    duration = data["duration"]
    rights = f"{LICENSE_NAME}; {LICENSE_URL}"
    return f"""<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Domination Chronicles PDF metadata updater">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:podcast="https://dominationchronicles.com/ns/podcast/1.0/">
   <dc:title>{rdf_alt(title)}</dc:title>
   <dc:creator>{rdf_bag(AUTHORS)}</dc:creator>
   <dc:subject>{rdf_bag(subjects)}</dc:subject>
   <dc:description>{rdf_alt(description)}</dc:description>
   <dc:publisher>{rdf_bag([PUBLISHER])}</dc:publisher>
   <dc:contributor>{rdf_bag(AUTHORS)}</dc:contributor>
   <dc:date>{rdf_bag([publish_date])}</dc:date>
   <dc:type>{rdf_bag(["Sound", "Text", "Podcast episode transcript"])}</dc:type>
   <dc:format>application/pdf</dc:format>
   <dc:identifier>{escape(episode_url)}</dc:identifier>
   <dc:source>{escape(PUBLISHER)}</dc:source>
   <dc:language>{escape(LANGUAGE)}</dc:language>
   <dc:relation>{rdf_bag([episode_url, pdf_url])}</dc:relation>
   <dc:coverage>{escape(SITE_URL)}</dc:coverage>
   <dc:rights>{rdf_alt(rights)}</dc:rights>
   <xmp:CreateDate>{escape(publish_date)}</xmp:CreateDate>
   <xmp:ModifyDate>{escape(dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat())}</xmp:ModifyDate>
   <xmp:MetadataDate>{escape(dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat())}</xmp:MetadataDate>
   <pdf:Keywords>{escape(', '.join(subjects))}</pdf:Keywords>
   <pdf:Producer>{escape(PUBLISHER)}</pdf:Producer>
   <xmpRights:Marked>True</xmpRights:Marked>
   <xmpRights:WebStatement>{escape(LICENSE_URL)}</xmpRights:WebStatement>
   <xmpRights:UsageTerms>{rdf_alt(rights)}</xmpRights:UsageTerms>
   <podcast:publication>{escape(PUBLISHER)}</podcast:publication>
   <podcast:episode>{escape(episode)}</podcast:episode>
   <podcast:duration>{escape(duration)}</podcast:duration>
   <podcast:episodeUrl>{escape(episode_url)}</podcast:episodeUrl>
   <podcast:transcriptUrl>{escape(pdf_url)}</podcast:transcriptUrl>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def build_pdf_map():
    pdf_map = {}
    for episode_path in sorted(EPISODES_DIR.glob("*.md")):
        meta, markdown = front_matter(episode_path)
        if meta.get("published") is False:
            continue
        slug = episode_slug(episode_path)
        links = find_pdf_links(markdown)
        for link in links:
            pdf_path = PDFS_DIR / html.unescape(link)
            if not pdf_path.exists():
                raise FileNotFoundError(f"Episode {slug} links missing PDF: {pdf_path}")
            pdf_map[pdf_path] = {
                "slug": slug,
                "title": clean_text(meta.get("title")) or slug,
                "description": clean_text(meta.get("description")),
                "publish_date": iso_date(meta.get("publishDate")),
                "duration": clean_text(meta.get("duration")),
                "subjects": [clean_text(t) for t in meta.get("tags", []) if clean_text(t)],
                "episode": episode_number(slug),
                "episode_url": f"{SITE_URL}/episodes/{slug}/",
                "pdf_url": f"{SITE_URL}/pdfs/{html.unescape(link)}",
            }
    return pdf_map


def update_pdf(pdf_path, data):
    reader = PdfReader(str(pdf_path))
    writer = PdfWriter(clone_from=reader)
    writer.pdf_header = getattr(reader, "pdf_header", "%PDF-1.7")
    subjects = data["subjects"] or ["Domination Chronicles", "podcast", "transcript"]
    data = {**data, "subjects": subjects}
    info = {
        "/Title": data["title"],
        "/Author": AUTHOR_TEXT,
        "/Subject": data["description"],
        "/Keywords": ", ".join(subjects),
        "/Creator": PUBLISHER,
        "/Producer": PUBLISHER,
        "/Publisher": PUBLISHER,
        "/Publication": PUBLISHER,
        "/Description": data["description"],
        "/Language": LANGUAGE,
        "/Type": "Podcast episode transcript",
        "/Format": "application/pdf",
        "/Identifier": data["episode_url"],
        "/Source": PUBLISHER,
        "/Relation": f"{data['episode_url']} {data['pdf_url']}",
        "/Coverage": SITE_URL,
        "/Rights": f"{LICENSE_NAME}; {LICENSE_URL}",
        "/Copyright": f"{LICENSE_NAME}; {LICENSE_URL}",
        "/License": LICENSE_URL,
        "/Authors": AUTHOR_TEXT,
        "/Duration": data["duration"],
        "/Episode": data["episode"],
    }
    if data["publish_date"]:
        info["/CreationDate"] = pdf_date(data["publish_date"])
    info["/ModDate"] = pdf_date(dt.datetime.now(dt.timezone.utc))
    writer.add_metadata(info)
    writer.xmp_metadata = xmp_packet(data).encode("utf-8")

    with tempfile.NamedTemporaryFile(dir=pdf_path.parent, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        writer.write(tmp)
    shutil.copystat(pdf_path, tmp_path)
    tmp_path.replace(pdf_path)


def main():
    pdf_map = build_pdf_map()
    all_pdfs = set(PDFS_DIR.glob("*.pdf"))
    missing_metadata = sorted(all_pdfs - set(pdf_map))
    if missing_metadata:
        for path in missing_metadata:
            print(f"No episode metadata found for {path}", file=sys.stderr)
        return 1
    for pdf_path, data in sorted(pdf_map.items()):
        update_pdf(pdf_path, data)
        print(f"Updated {pdf_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
