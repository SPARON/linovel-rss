import { serve } from "https://deno.land/std/http/server.ts";

const base = "https://www.linovelib.com";
const Expires = 60 * 60 * 1000;
const headers = new Headers({
  "content-type": "application/rss+xml",
});

async function _html(url: string): Promise<string> {
  return await (await fetch(url)).text();
}

/** 获取目录 */
async function getCatalog(id: string): Promise<Map<string, string> | null> {
  let url = `${base}/novel/${id}/catalog`;
  let html = await _html(url);

  let str = /<ul class=\"chapter-list clearfix\">.*?<\/ul>/s.exec(html);
  if (!str) return null;
  return parseCatalog(str[0]);
}

/** 获取小说内容或图片列表 */
async function getContent(url: string): Promise<Content | null> {
  let html = await _html(base + url);
  let arr = html.match(/<p>.*?<\/p>/sg);
  if (!arr) return null;
  let lines = arr.map((i) => {
    return i.slice(3, -4);
  }).filter((i) => i);

  if (lines?.length) return { lines };

  let imgs = html.match(/https:\/\/img\.linovelib\.com.*?\.jpg/mg);
  if (imgs) {
    return { imgs };
  } else {
    return null;
  }
}

/** 解析目录结构 */
function parseCatalog(str: string): Map<string, string> {
  let current = "", result: Map<string, string> = new Map();
  for (let line of str.split(/\n|\r/)) {
    if (/em>.*?<\/div/.test(line)) {
      let matched = line.match(/em>(.*?)<\/div/);
      current = matched ? matched[1] : "";
    } else if (/<li.*?li>/.test(line)) {
      let url = line.match(/\/novel.*?\.html/);
      if (!url) continue;
      let title = line.match(/<a.*>(.*?)<\/a>/);
      if (!title) continue;
      result.set(`${current} ${title[1]}`, url[0]);
    }
  }
  return result;
}

/** 获取小说介绍 */
async function getDetails(
  id: string,
): Promise<{ words: string; description: string; title: string } | null> {
  let url = `${base}/novel/${id}.html`;
  let html = await _html(url);
  let words_matched = html.match(/nums.*?i>(.*?)</);
  let words = words_matched ? words_matched[1] : "0";
  let desc = html.match(/<p>(.*?)<\/p>/sm);
  let description = desc ? desc[1].replace(/<br \/>/g, "\n") : "";
  let title_match = html.match(/<h1.*?>(.*?)<\/h1>/);
  let title = title_match ? title_match[1] : id;
  if (!title) return null;
  return { words, description, title };
}

/** 根据ID爬取小说信息 */
async function fetchNovelById(id: string): Promise<Feed> {
  let details = await getDetails(id);
  if (!details) throw new Error("Get novel info fail");
  let list = await getCatalog(id);
  if (!list) throw new Error("List not found");
  let urls = Array.from(list.values());
  let contents = (await Promise.all(urls.map(getContent))).map(formatContent);
  let items = [], current = 0;
  for (let [title, url] of list.entries()) {
    items.push({
      title,
      id: url,
      body: contents[current++],
    });
  }
  return {
    title: details.title,
    subtitle: details.description + "\n字数：" + details.words,
    items,
  };
}

function formatContent(
  data: { lines?: Array<string>; imgs?: Array<string> } | null,
): string {
  if (!data) return "";
  if (data.lines) {
    return "<p>" + data.lines.join("</p><p>") + "</p>";
  } else if (data.imgs) {
    return data.imgs.map((i) => `<img src="${i}" />`).join("");
  } else {
    return "";
  }
}

function toRss({ title, subtitle, items }: Feed): string {
  return '<?xml version="1.0"?><rss version="2.0"><channel>' +
    `<title>${title}</title>` +
    "<link>https://www.linovelib.com/</link>" +
    "<generator>Linovelib Feeder by Deno</generator>" +
    `<description><![CDATA[${subtitle}]]></description>` +
    items.map((item) => {
      return `<item><title>${item.title}</title>` +
        `<description><![CDATA[${item.body}]]></description>` +
        `<guid>${item.id}</guid>` +
        `<link>${base}${item.id}</link></item>`;
    }).join("") + "</channel></rss>";
}

async function start() {
  let port = Deno.env.get("FC_SERVER_PORT") || "9000";
  let caches: Map<string, Cache> = new Map();
  for await (let req of serve({ port: parseInt(port) })) {
    if (req.method !== "GET") {
      await req.respond({ status: 404 });
      continue;
    }
    let { pathname } = new URL("http://localhost" + req.url);
    if (!/^\/\d+$/.test(pathname)) {
      await req.respond({ status: 403 });
      continue;
    }

    let id = pathname.slice(1);
    let cached = caches.get(id);
    if (cached) {
      if (cached.time > Date.now() - Expires) {
        console.log(new Date(), "Hit cache", id);
        await req.respond({
          body: cached.value,
          headers,
        });
        continue;
      }
    }

    try {
      console.log(new Date(), "fetch", id);
      let data = await fetchNovelById(id);
      let body = toRss(data);
      caches.set(id, {
        value: body,
        time: Date.now(),
      });
      await req.respond({
        headers,
        body,
      });
    } catch {
      console.log(new Date(), "error", id);
      await req.respond({ status: 404 });
    }
  }
}

if (import.meta.main) start();

interface Content {
  lines?: Array<string>;
  imgs?: Array<string>;
}

interface Feed {
  title: string;
  subtitle: string;
  items: Array<FeedItem>;
}

interface FeedItem {
  title: string;
  id: string;
  body: string;
}

interface Cache {
  time: number;
  value: string;
}

Deno.test("catalog", async () => {
  console.log(await getCatalog("2349"));
});

Deno.test("content", async () => {
  console.log(await getContent("/novel/2349/130180.html"));
  console.log(await getContent("/novel/2349/130182.html"));
});

Deno.test("details", async () => {
  console.log(await getDetails("1355"));
});

Deno.test("alldata", async () => {
  console.log(await fetchNovelById("1355"));
});

Deno.test("rss", async () => {
  console.log(toRss(await fetchNovelById("1355")));
});
