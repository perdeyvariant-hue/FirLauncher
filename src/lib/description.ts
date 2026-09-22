import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { BodyFormat } from '@/types/mod';
import { t } from '@/lib/i18n';

/**
 * Project descriptions are written by third parties, so they are treated as
 * hostile: rendered to HTML, then sanitised down to plain document markup.
 * Scripts, event handlers, forms, styles and embeds never reach the page.
 */

const FORBID_TAGS = [
  'style',
  'script',
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'video',
  'audio',
  'link',
  'meta',
  'base',
];
const FORBID_ATTR = ['style', 'class', 'id', 'srcset', 'target'];

/** `https://www.youtube.com/embed/ID` → `https://www.youtube.com/watch?v=ID`. */
function youtubeWatchUrl(src: string): string | null {
  const match = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/i.exec(src);
  return match?.[1] === undefined ? null : `https://www.youtube.com/watch?v=${match[1]}`;
}

/** Protocol-relative URLs would resolve against the app's own scheme. */
function absolute(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url;
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Embedded videos cannot play here (and would load third-party pages), so a
 * YouTube embed becomes a link to the video; anything else is dropped.
 */
function replaceEmbeds(doc: Document): void {
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    const watch = youtubeWatchUrl(frame.getAttribute('src') ?? '');
    if (watch === null) {
      frame.remove();
      continue;
    }
    const link = doc.createElement('a');
    link.href = watch;
    link.textContent = t`▶ Видео на YouTube`;
    frame.replaceWith(link);
  }
}

/** Only web links and https images survive; images load lazily. */
function tidy(doc: Document): void {
  for (const link of Array.from(doc.querySelectorAll('a'))) {
    const href = absolute(link.getAttribute('href') ?? '');
    if (isWebUrl(href)) link.setAttribute('href', href);
    else link.removeAttribute('href');
  }
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const src = absolute(image.getAttribute('src') ?? '');
    if (!src.startsWith('https://')) {
      image.remove();
      continue;
    }
    image.setAttribute('src', src);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
  }
}

export function renderDescription(body: string, format: BodyFormat): string {
  const raw =
    format === 'markdown' ? marked.parse(body, { async: false, gfm: true }) : body;
  const clean = DOMPurify.sanitize(raw, {
    // Embeds are handled below; let them through the first pass only.
    FORBID_TAGS: FORBID_TAGS.filter((tag) => tag !== 'iframe'),
    FORBID_ATTR,
    ADD_TAGS: ['iframe'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  replaceEmbeds(doc);
  tidy(doc);
  // A second pass: nothing added above may reintroduce anything unsafe.
  return DOMPurify.sanitize(doc.body.innerHTML, { FORBID_TAGS, FORBID_ATTR });
}
