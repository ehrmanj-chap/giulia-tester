#!/usr/bin/env python3
"""Build deterministic Mei corpus snapshots from Google Drive connector JSON batches.

Usage: python scripts/import-mei-corpus.py /path/to/batches
Each input record needs id, title, domain, category, topic, url and full extracted text.
Original PDFs remain in Drive. The text and its provenance are retained without summarization.
"""
import argparse, gzip, hashlib, json, pathlib

def build(source, root):
    rows = [r for f in sorted(source.glob('batch-*.json')) for r in json.loads(f.read_text())]
    assert len({r['id'] for r in rows}) == len(rows), 'Duplicate Drive ID'
    assert rows, 'No records'
    manifest = {'version': 'mei-drive-2026-09-29', 'extraction': 'Google Drive connector readable PDF text; no summarization', 'sources': []}
    for domain, expected in [('cultural', 74), ('business', 80)]:
        docs = []
        for r in sorted((r for r in rows if r['domain'] == domain), key=lambda r: (r['topic'], r['title'])):
            text = r['text'].replace('\r\n', '\n').replace('\r', '\n').strip()
            assert len(text) > 200, f"Empty or suspicious extraction: {r['title']}"
            assert not text.rstrip().endswith('[truncated]'), f"Truncated extraction: {r['title']}"
            doc = {'id': r['id'], 'title': r['title'].removesuffix('.pdf'), 'domain': domain,
                   'category': r['category'], 'topic': r['topic'], 'sourceUrl': r['url'],
                   'sourceFileName': r['title'], 'sourceModifiedAt': r['modified_time'],
                   'supplementary': 'Additional Research' in r['title'],
                   'sha256': hashlib.sha256(text.encode()).hexdigest(), 'characters': len(text), 'text': text}
            docs.append(doc)
            manifest['sources'].append({k:v for k,v in doc.items() if k != 'text'})
        assert len(docs) == expected, f'{domain}: {len(docs)} vs {expected}'
        target = root / 'mei-backend' / 'knowledge' / domain / 'drive-corpus.json.gz'
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({'version':manifest['version'], 'documents':docs}, ensure_ascii=False, separators=(',',':')).encode()
        target.write_bytes(gzip.compress(payload, mtime=0))
    manifest['counts'] = {d:len([r for r in rows if r['domain']==d]) for d in ['cultural','business']}
    (root/'mei-backend'/'knowledge'/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    topics = {}
    for r in rows: topics[(r['domain'],r['topic'])] = {'domain':r['domain'],'topic':r['topic'], 'sourceIds':[]}
    for r in rows: topics[(r['domain'],r['topic'])]['sourceIds'].append(r['id'])
    (root/'public'/'dual-lab'/'mei-topics.js').write_text('export const MEI_TOPICS = '+json.dumps(list(topics.values()),ensure_ascii=False,indent=2)+';\n')
    print(json.dumps({'documents':manifest['counts'],'topics':len(topics),'characters':sum(s['characters'] for s in manifest['sources'])}))

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('source',type=pathlib.Path)
    args=parser.parse_args(); build(args.source, pathlib.Path(__file__).resolve().parents[1])
