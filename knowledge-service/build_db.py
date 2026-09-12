#!/usr/bin/env python3
"""Build the Knowledge Service SQLite database.

Sources:
  - knowledge graphs: coursepass-v2-api/knowledge_graph.{國語,數學,社會,自然}.json
  - bound questions : question-bank-crawler/out/bound/*.ndjson
Output:
  knowledge-service/data/knowledge.sqlite  (read-only at runtime)

Deterministic and re-runnable; records a data version hash in `meta`.
"""

import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CRAWLER = ROOT.parent
DEFAULT_GRAPHS = Path("/Volumes/External Disk/CodingProjects/coursepass-v2-app/coursepass-v2-api")
SUBJECT_GRAPH = {"國語": "國語", "數學": "數學", "社會": "社會", "自然科學": "自然"}

SCHEMA = """
CREATE TABLE nodes (
  id TEXT PRIMARY KEY, subject TEXT, grade TEXT, name TEXT, topic TEXT,
  main_topic TEXT, content_description TEXT, performance_indicator TEXT, stage_name TEXT
);
CREATE TABLE edges (src TEXT, dst TEXT, type TEXT);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, publisher TEXT, subject TEXT, grade TEXT,
  unit_title TEXT, lesson_code TEXT, question_count INTEGER
);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sourceQuestionId TEXT, publisher TEXT,
  subject TEXT, grade INTEGER, questionType TEXT, difficulty TEXT, prompt TEXT,
  answer TEXT, primaryKnowledgeNodeId TEXT, reviewStatus TEXT, sourceId TEXT,
  version TEXT, options_json TEXT, tags_json TEXT
);
CREATE TABLE coverage (
  publisher TEXT, subject TEXT, grade INTEGER, nodeId TEXT, total INTEGER, bound INTEGER, approved INTEGER,
  PRIMARY KEY (publisher, subject, grade, nodeId)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX ix_nodes_subject_grade ON nodes(subject, grade);
CREATE INDEX ix_questions_node ON questions(primaryKnowledgeNodeId);
CREATE INDEX ix_questions_pub ON questions(publisher, subject, grade);
CREATE INDEX ix_edges_src ON edges(src);
"""

PUBLISHER = {"hle": "翰林", "knsh": "康軒", "nan-i": "南一"}


def publisher_of(name):
    for slug, label in PUBLISHER.items():
        if name.startswith(slug + "-"):
            return label
    return "未知"


def code_of(node):
    name = str(node.get("name") or "").strip()
    return name.split()[0] if name else (node.get("id") or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graphs", type=Path, default=DEFAULT_GRAPHS)
    ap.add_argument("--bound", type=Path, default=CRAWLER / "out" / "bound")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "knowledge.sqlite")
    args = ap.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if args.out.exists():
        args.out.unlink()
    db = sqlite3.connect(args.out)
    db.executescript(SCHEMA)

    digest = hashlib.sha256()
    node_count = edge_count = 0
    for subject, gname in SUBJECT_GRAPH.items():
        path = args.graphs / f"knowledge_graph.{gname}.json"
        if not path.exists():
            continue
        graph = json.loads(path.read_text(encoding="utf-8"))
        digest.update(path.read_bytes())
        for node in graph.get("nodes", []):
            db.execute(
                "INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?)",
                (node.get("id"), subject, str(node.get("grade")), node.get("name"),
                 node.get("topic"), node.get("main_topic"), node.get("content_description"),
                 node.get("performance_indicator"), node.get("stage_name")),
            )
            node_count += 1
        for edge in graph.get("edges", []):
            db.execute("INSERT INTO edges VALUES (?,?,?)",
                       (edge.get("source") or edge.get("from"), edge.get("target") or edge.get("to"),
                        edge.get("type") or edge.get("relation")))
            edge_count += 1

    q_count = 0
    chapter_seen = {}
    coverage = {}
    for f in sorted(args.bound.glob("*.ndjson")):
        pub = publisher_of(f.name)
        digest.update(f.read_bytes())
        for line in f.read_text(encoding="utf-8").split("\n"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            subject = r.get("subject")
            grade = int(r.get("grade") or 0)
            node = r.get("primaryKnowledgeNodeId")
            db.execute(
                "INSERT INTO questions (sourceQuestionId,publisher,subject,grade,questionType,difficulty,prompt,answer,primaryKnowledgeNodeId,reviewStatus,sourceId,version,options_json,tags_json)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (r.get("sourceQuestionId"), pub, subject, grade, r.get("questionType"),
                 r.get("difficulty") or r.get("difficultyRaw"), r.get("prompt"), json.dumps(r.get("answer"), ensure_ascii=False),
                 node, r.get("reviewStatus") or "review_required", r.get("sourceId"), r.get("version"),
                 json.dumps(r.get("options") or [], ensure_ascii=False),
                 json.dumps(r.get("tags") or [], ensure_ascii=False)),
            )
            q_count += 1
            unit = r.get("unitTitle") or r.get("lessonTitle") or ""
            if unit:
                chapter_seen[(pub, subject, grade, unit, r.get("lessonCode") or "")] = \
                    chapter_seen.get((pub, subject, grade, unit, r.get("lessonCode") or ""), 0) + 1
            if node:
                key = (pub, subject, grade, node)
                c = coverage.setdefault(key, {"total": 0, "bound": 0, "approved": 0})
                c["total"] += 1
                c["bound"] += 1
                if r.get("reviewStatus") == "approved":
                    c["approved"] += 1

    for (pub, subject, grade, unit, lesson_code), count in chapter_seen.items():
        db.execute("INSERT INTO chapters (publisher,subject,grade,unit_title,lesson_code,question_count) VALUES (?,?,?,?,?,?)",
                   (pub, subject, str(grade), unit, lesson_code, count))
    for (pub, subject, grade, node), c in coverage.items():
        db.execute("INSERT OR REPLACE INTO coverage VALUES (?,?,?,?,?,?,?)",
                   (pub, subject, grade, node, c["total"], c["bound"], c["approved"]))

    version = digest.hexdigest()[:16]
    for k, v in {"version": version, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                 "nodes": str(node_count), "edges": str(edge_count), "questions": str(q_count),
                 "subjects": ",".join(SUBJECT_GRAPH)}.items():
        db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, v))
    db.commit()
    db.close()
    print(json.dumps({"out": str(args.out), "version": version, "nodes": node_count,
                      "edges": edge_count, "questions": q_count,
                      "sizeMB": round(args.out.stat().st_size / 1048576, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
