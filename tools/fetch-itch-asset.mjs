import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

function usage() {
  console.error("usage: node tools/fetch-itch-asset.mjs <itch-page-url> <output-directory>");
  process.exit(2);
}

const [pageUrl, outputDirectory] = process.argv.slice(2);
if (!pageUrl || !outputDirectory) usage();

const cookies = new Map();

function rememberCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  for (const value of values) {
    const [pair] = value.split(";", 1);
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (cookies.size > 0) {
    headers.set(
      "cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  const response = await fetch(url, {...options, headers});
  rememberCookies(response);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response;
}

function findUploads(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((match) => /class="[^"]*download_btn/.test(match[1]))
    .map((match) => ({
      uploadId: match[1].match(/data-upload_id="(\d+)"/)?.[1],
      label: match[2].replace(/<[^>]+>/g, " ").trim(),
    }))
    .filter((upload) => upload.uploadId);
}

const page = new URL(pageUrl);
page.pathname = page.pathname.replace(/\/$/, "");
const landingResponse = await request(page);
const landingHtml = await landingResponse.text();
let csrf = landingHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];
let uploads = findUploads(landingHtml);

if (uploads.length === 0) {
  const purchaseUrl = new URL(`${page.pathname}/purchase`, page.origin);
  const purchaseResponse = await request(purchaseUrl);
  const purchaseHtml = await purchaseResponse.text();
  csrf = purchaseHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error("itch purchase page did not contain a CSRF token");

  const urlResponse = await request(
    new URL(`${page.pathname}/download_url`, page.origin),
    {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({csrf_token: csrf}),
    },
  );
  const generated = await urlResponse.json();
  if (!generated.url) throw new Error("itch did not return a generated download URL");
  const downloadPageResponse = await request(generated.url);
  uploads = findUploads(await downloadPageResponse.text());
}

if (!csrf) throw new Error("itch page did not contain a CSRF token");
if (uploads.length === 0) {
  throw new Error("itch download page did not contain an archive link");
}

await mkdir(outputDirectory, {recursive: true});
for (const upload of uploads) {
  const fileUrl = new URL(`${page.pathname}/file/${upload.uploadId}`, page.origin);
  fileUrl.searchParams.set("source", "view_game");
  fileUrl.searchParams.set("as_props", "1");
  const fileResponse = await request(fileUrl, {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({csrf_token: csrf}),
  });
  const file = await fileResponse.json();
  if (!file.url) {
    throw new Error(`itch did not return a file URL for ${upload.label}`);
  }
  const downloadUrl = new URL(file.url, page.origin);
  const response = await request(downloadUrl);
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = basename(
    decodeURIComponent(encodedName ?? plainName ?? basename(downloadUrl.pathname)),
  );
  const destination = `${outputDirectory}/${filename}`;
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
  console.log(destination);
}
