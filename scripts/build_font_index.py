import os
import json
import re
import threading
from datetime import datetime
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from tqdm import tqdm

# ===================== 配置项 ======================
PROJECT_ROOT = os.getcwd()
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "web", "public", "latexFontFileIndex.json")
# 字体名称日志文件
FONT_NAME_LOG = os.path.join(PROJECT_ROOT, "font_names.log")

ROOT_URL = "https://mirrors.ctan.org/fonts/"
ROOT_PATHS = ["/fonts", "/ctan/tex-archive/fonts", "/tex-archive/fonts"]

MAX_WORKERS = 20


# ===================== 工具函数 ======================
def html_decode(s: str) -> str:
    return (
        s.replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )


def extract_hrefs(html: str) -> list:
    pattern = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>', re.IGNORECASE)
    return [html_decode(m.group(1)) for m in pattern.finditer(html) if m.group(1)]


def normalize_archive_path(url_path: str) -> str | None:
    pathname = url_path.rstrip("/")
    for root in ROOT_PATHS:
        if pathname == root or pathname.startswith(f"{root}/"):
            return pathname
    return None


def extname_lower(name: str) -> str:
    idx = name.rfind(".")
    return name[idx:].lower() if idx >= 0 else ""


def clean_relative_path(path: str) -> str:
    for prefix in ["/ctan/tex-archive/fonts/", "/tex-archive/fonts/", "/fonts/"]:
        if path.startswith(prefix):
            return path.replace(prefix, "", 1)
    return path


# ===================== 线程安全全局变量 ======================
lock = threading.Lock()
seen_pages = set()
files_map = {}
# 记录已写入日志的文件名（避免重复）
logged_names = set()
session = requests.Session()

# 日志文件句柄（全局打开，避免频繁IO）
log_file = open(FONT_NAME_LOG, "w", encoding="utf-8")


# ===================== 爬取单个页面 ======================
def crawl_page(url: str):
    global seen_pages, files_map, logged_names

    with lock:
        if url in seen_pages:
            return []
        seen_pages.add(url)

    try:
        resp = session.get(url, timeout=15, allow_redirects=True)
        resp.raise_for_status()
        html = resp.text
    except requests.exceptions.RequestException:
        return []

    hrefs = extract_hrefs(html)
    sub_dirs = []

    for href in hrefs:
        next_url = urljoin(url, href).strip()
        parsed = urlparse(next_url)

        if parsed.scheme not in ("http", "https"):
            continue

        path = parsed.path
        archive_path = normalize_archive_path(path)
        if not archive_path or archive_path in ROOT_PATHS:
            continue

        basename = os.path.basename(archive_path)
        ext = extname_lower(basename)

        if ext:
            rel_path = clean_relative_path(archive_path)
            key = basename.lower()

            with lock:
                files_map.setdefault(key, set()).add(rel_path)

                # 写入字体名到日志（不重复）
                if key not in logged_names:
                    log_file.write(f"{basename}\n")
                    log_file.flush()  # 实时写入
                    logged_names.add(key)
            continue

        if next_url.endswith("/") or "." not in basename:
            normalized = next_url
            with lock:
                if normalized not in seen_pages:
                    sub_dirs.append(normalized)

    return sub_dirs


# ===================== 多线程爬虫 + 进度条 ======================
def crawl_fonts_tree():
    queue = [ROOT_URL]
    print(f"[+] 开始爬取：{ROOT_URL}")
    print(f"[+] 线程数：{MAX_WORKERS}")
    print(f"[+] 字体名日志：{FONT_NAME_LOG}\n")

    pbar = tqdm(desc="爬取目录中", unit="页", dynamic_ncols=True)

    while queue:
        batch = queue[:]
        queue = []

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_url = {executor.submit(crawl_page, url): url for url in batch}

            for future in as_completed(future_to_url):
                sub_dirs = future.result()
                if sub_dirs:
                    queue.extend(sub_dirs)
                pbar.update(1)

    pbar.close()
    log_file.close()

    sorted_files = {}
    for fname in sorted(files_map.keys()):
        sorted_files[fname] = sorted(list(files_map[fname]))

    return {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "root": ROOT_URL,
        "files": sorted_files,
    }


# ===================== 入口 ======================
def main():
    try:
        index = crawl_fonts_tree()
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

        print(f"\n✅ 完成！")
        print(f"├─ 索引文件：{OUTPUT_FILE}")
        print(f"└─ 字体名称日志：{FONT_NAME_LOG}")
        print(f"📊 共收录字体：{len(index['files'])} 个")

    except Exception as e:
        print(f"\n❌ 错误：{e}")
        exit(1)


if __name__ == "__main__":
    print()
    main()
