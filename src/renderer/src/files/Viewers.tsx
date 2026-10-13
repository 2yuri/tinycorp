import { FileWarning } from 'lucide-react'
import { useState } from 'react'
import { type OpenedFile, sizeLabel } from '../../../shared/files/files'
import { cx, EmptyState } from '../ui'
import { looksLikeSprite, refusalNotice, truncationNotice } from './files-model'
import { type Align, type Inline, inlineSpans, type MarkdownBlock, markdownBlocks } from './markdown'
import { DEFAULT_ZOOM, type ImageZoom, type TabView } from './tabs-model'

/** The zooms the image viewer offers, in the order the bar draws them. */
export const ZOOMS: readonly ImageZoom[] = ['fit', 1, 2, 4, 8]

/** What the bar writes on a zoom's key. */
export function zoomLabel(zoom: ImageZoom): string {
  return zoom === 'fit' ? 'Fit' : `${zoom}×`
}

/**
 * The viewer a file's kind asks for, where that kind is not text at all: an image, a rendered
 * Markdown document, or the refusal for something the view will not try.
 *
 * Text — code, plain text, and Markdown read as its source — is Monaco's since T222, and
 * `FilesPanel` hands it straight there: whether the boss may type in it is one prop of the editor
 * rather than two different components.
 */
export function FileViewer({
  file,
  view,
  onView,
}: {
  file: OpenedFile
  /** The tab's own zoom and `Pixel-true` (T121); without one the image viewer keeps its own. */
  view?: TabView | undefined
  onView?: ((change: Partial<TabView>) => void) | undefined
}) {
  if (file.kind === 'image') return <ImageView file={file} view={view} onView={onView} />
  if (file.kind === 'markdown') return <MarkdownView file={file} />
  // `code` and `text` never arrive: `FilesPanel` hands both to the editor, whatever they may do
  // with them. What is left is a file the view will not try, which says why.
  return <Refusal file={file} />
}

/** Markdown as Markdown. The source is a click away, and is drawn by the editor. */
export function MarkdownView({ file }: { file: OpenedFile }) {
  return <MarkdownBody source={file.text ?? ''} />
}

/*
 * Markdown, rendered. Every heading, paragraph, list and rule below was a `.files-markdown <element>`
 * rule: the blocks come back as real elements with no class of their own, so the container reaches
 * them. `MARKDOWN` is `MarkdownBody`'s default, and the Memory screen passes its own instead.
 */
const MARKDOWN =
  'max-w-760 px-32 py-24 text-14/[1.65] text-foreground [&>*:first-child]:mt-0 [&_h1]:mt-24 [&_h1]:mr-0 [&_h1]:mb-8 [&_h1]:ml-0 [&_h1]:text-24/[1.3] [&_h2]:mt-24 [&_h2]:mr-0 [&_h2]:mb-8 [&_h2]:ml-0 [&_h2]:text-19/[1.3] [&_h3]:mt-24 [&_h3]:mr-0 [&_h3]:mb-8 [&_h3]:ml-0 [&_h3]:text-16/[1.3] [&_h4]:mt-24 [&_h4]:mr-0 [&_h4]:mb-8 [&_h4]:ml-0 [&_h4]:leading-[1.3] [&_h5]:mt-24 [&_h5]:mr-0 [&_h5]:mb-8 [&_h5]:ml-0 [&_h5]:leading-[1.3] [&_h6]:mt-24 [&_h6]:mr-0 [&_h6]:mb-8 [&_h6]:ml-0 [&_h6]:leading-[1.3] [&_p]:mt-0 [&_p]:mr-0 [&_p]:mb-12 [&_p]:ml-0 [&_ul]:mt-0 [&_ul]:mr-0 [&_ul]:mb-12 [&_ul]:ml-0 [&_ol]:mt-0 [&_ol]:mr-0 [&_ol]:mb-12 [&_ol]:ml-0 [&_code]:rounded-sm [&_code]:bg-[color-mix(in_srgb,var(--secondary)_60%,transparent)] [&_code]:px-5 [&_code]:py-1 [&_code]:font-code [&_code]:text-12-5 [&_blockquote]:mt-0 [&_blockquote]:mr-0 [&_blockquote]:mb-12 [&_blockquote]:ml-0 [&_blockquote]:border-l-3 [&_blockquote]:border-border [&_blockquote]:pl-16 [&_blockquote]:text-muted-foreground [&_hr]:my-16 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-t-border [&_a]:text-brand-primary-light'

const MD_CODE =
  'mt-0 mr-0 mb-12 ml-0 overflow-auto rounded-md border border-border bg-code px-16 py-12 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-syntax-plain'

/*
 * A table: the viewer's own border around every cell, so a row of `|` characters reads as a row. It
 * takes the prose column and wraps inside it; only a header too long to wrap makes the wrapper
 * scroll, which is better than the column growing under the rest of the document.
 */
const MD_TABLE =
  'mt-0 mr-0 mb-12 ml-0 overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-13/[1.5] [&_th]:border [&_th]:border-border [&_th]:px-12 [&_th]:py-6 [&_th]:text-left [&_th]:align-top [&_td]:border [&_td]:border-border [&_td]:px-12 [&_td]:py-6 [&_td]:text-left [&_td]:align-top [&_th]:bg-[color-mix(in_srgb,var(--secondary)_45%,transparent)] [&_th]:font-semibold [&_th]:whitespace-nowrap'

/* An image, at its own size, and pixel-true when it is a sprite sheet. */
const IMAGE_BAR = 'flex items-center gap-16 border-b border-border px-16 py-12 text-12/[normal] text-muted-foreground'

/* Two whole lists, not a list and an override: see `CHIP` in `memory/MemoryList.tsx` for why. */
const ZOOM =
  'cursor-pointer rounded-sm border border-border bg-transparent px-8 py-2 text-11/[normal] text-muted-foreground'

/* The modifier trails the list: `FilesView.test.tsx` matches `files-image__zoom--on">4×`, so it has
   to be the last class before the attribute closes. */
const ZOOM_ON =
  'cursor-pointer rounded-sm border border-primary bg-primary-subtle px-8 py-2 text-11/[normal] text-foreground files-image__zoom--on'

const TRUNCATED =
  'm-0 bg-[color-mix(in_srgb,var(--brand-warning)_12%,transparent)] px-16 py-6 text-12/[normal] text-brand-warning'

/**
 * The viewer's own chrome, shared by the file viewer and the Changes diff beside the list: both draw
 * the same head, breadcrumbs, chips, body and foot on the same code surface, which is why
 * `files.css` had them as one set of rules.
 *
 * The breadcrumb separator was `.files-crumbs__crumb + .files-crumbs__crumb::before`. It is
 * `not-first:before:` on the crumb itself now — the same rule, said at the element it applies to, so
 * nothing has to reach a sibling.
 */
export const VIEWER = 'flex min-h-0 min-w-0 flex-1 flex-col bg-code'

export const HEAD = 'flex h-40 shrink-0 items-center gap-12 border-b border-border bg-card px-16'

export const CRUMBS =
  'flex min-w-0 flex-1 items-center gap-6 overflow-hidden whitespace-nowrap font-code text-12/[normal] text-muted-foreground [&>*+*]:before:mr-6 [&>*+*]:before:text-inherit [&>*+*]:before:content-["/"]'

/*
 * The joins are the same grey as the crumbs, so the path reads as one line (ZNpqJ). The separator is
 * on the **container**, not on the crumb: `FilesView.test.tsx` asserts every crumb's class attribute
 * is exactly `files-crumbs__crumb` — that is the test for "the frame lifts none of them, the last one
 * included" — so a utility on the crumb itself would break it.
 */
export const CRUMB = 'files-crumbs__crumb'

export const CHIP = 'rounded-full px-8 py-2 font-medium text-11/[normal] whitespace-nowrap'

export const CHIP_PLAIN =
  'files-chip--plain bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] text-muted-foreground'

export const CHIP_CHANGE = 'bg-[color-mix(in_srgb,var(--brand-warning)_16%,transparent)] text-brand-warning'

export const BODY = 'min-h-0 flex-1 overflow-auto'

export const FOOT = 'shrink-0 border-t border-border bg-card px-16 py-9 text-12/[normal] text-muted-foreground'

export const CHANGES_EMPTY = 'm-0 p-16 text-12/[normal] text-muted-foreground'

/**
 * Markdown as React elements, never HTML: nothing a repo holds — or an Employee wrote into the
 * Company memory — can inject markup into the app. Shared by the Files viewer and the Memory
 * screen, which draw the same blocks under their own class.
 */
export function MarkdownBody({ source, className = MARKDOWN }: { source: string; className?: string }) {
  return (
    <article className={className} data-ui="Markdown viewer">
      {markdownBlocks(source).map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </article>
  )
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level, 6)}` as 'h1'
      return <Tag>{spans(block.text)}</Tag>
    }
    case 'paragraph':
      return <p>{spans(block.text)}</p>
    case 'list':
      return block.ordered ? (
        <ol>
          {block.items.map((item, index) => (
            <li key={index}>{spans(item)}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{spans(item)}</li>
          ))}
        </ul>
      )
    case 'code':
      return (
        <pre className={MD_CODE}>
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return <blockquote>{spans(block.text)}</blockquote>
    case 'table':
      return (
        <div className={MD_TABLE}>
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} style={alignOf(block.align[index])}>
                    {spans(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} style={alignOf(block.align[column])}>
                      {spans(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr />
  }
}

/** A column the delimiter row asked for; the stylesheet keeps the rest. */
function alignOf(align: Align | undefined) {
  return align ? { textAlign: align } : undefined
}

function spans(text: string) {
  return inlineSpans(text).map(inline)
}

function inline(span: Inline, index: number) {
  switch (span.kind) {
    case 'code':
      return <code key={index}>{span.text}</code>
    case 'strong':
      return <strong key={index}>{span.text}</strong>
    case 'emphasis':
      return <em key={index}>{span.text}</em>
    case 'link':
      return (
        <a key={index} href={span.href} target="_blank" rel="noreferrer">
          {span.text}
        </a>
      )
    case 'text':
      return <span key={index}>{span.text}</span>
  }
}

/**
 * An image, with its own size beside it and a zoom that says how it is drawn (frame `aPsKD`).
 *
 * It opens fitted to the panel, which is what the boss wants to see first; `Fit` only ever
 * shrinks, so a small file — a sprite sheet, an icon — is already at its own pixels there, and
 * `1×` is the same picture. A sprite sheet also opens pixel-true, and every zoom keeps it that
 * way: the browser is never allowed to smooth the pixels.
 *
 * The zoom and the toggle belong to whoever opened the image: a tab keeps its own (T121), so
 * switching away and back finds it where the boss left it. With nobody holding them, they are the
 * viewer's own and last as long as it is drawn.
 */
export function ImageView({
  file,
  view,
  onView,
}: {
  file: OpenedFile
  view?: TabView | undefined
  onView?: ((change: Partial<TabView>) => void) | undefined
}) {
  const [own, setOwn] = useState<TabView>(() => ({
    source: false,
    zoom: DEFAULT_ZOOM,
    pixels: looksLikeSprite(file.path),
  }))
  const { zoom, pixels } = view ?? own
  const change = (next: Partial<TabView>) => (onView ? onView(next) : setOwn((was) => ({ ...was, ...next })))
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const fit = zoom === 'fit'
  return (
    <div className="flex min-h-full min-w-0 flex-col" data-ui="Image viewer">
      <div className={IMAGE_BAR}>
        <span className="font-code">
          {size ? `${size.width} × ${size.height}` : 'Drawing…'} · {sizeLabel(file.size)}
        </span>
        <fieldset className="flex gap-2" aria-label="Zoom">
          {ZOOMS.map((level) => (
            <button
              key={String(level)}
              type="button"
              aria-pressed={zoom === level}
              className={zoom === level ? ZOOM_ON : ZOOM}
              onClick={() => change({ zoom: level })}
            >
              {zoomLabel(level)}
            </button>
          ))}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-6">
          <input type="checkbox" checked={pixels} onChange={(event) => change({ pixels: event.target.checked })} />
          Pixel-true
        </label>
      </div>
      {/* Fitted, the box is the panel and the image is bounded by it; zoomed, the box scrolls. */}
      <div
        className={cx(
          'flex min-w-0 flex-1 justify-center overflow-auto p-32',
          fit ? 'min-h-0 items-center' : 'items-start',
        )}
      >
        <img
          className={fit ? 'max-h-full max-w-full object-contain' : undefined}
          src={file.dataUrl ?? ''}
          alt={file.path}
          style={{
            // At `Fit` the box decides; `max-*` never enlarges, so a small file keeps its own size.
            width: fit || !size ? undefined : size.width * zoom,
            height: fit || !size ? undefined : size.height * zoom,
            imageRendering: pixels ? 'pixelated' : 'auto',
          }}
          onLoad={(event) =>
            setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
        />
      </div>
    </div>
  )
}

/** A file the view will not try: it says why, and leaves it to the boss's own tools. */
export function Refusal({ file }: { file: OpenedFile }) {
  return (
    <div className="flex items-center justify-center px-24 py-48">
      <EmptyState
        icon={FileWarning}
        title={file.kind === 'binary' ? 'Not text' : 'Too big to read here'}
        body={refusalNotice(file) ?? ''}
      />
    </div>
  )
}

/** The line under a file that was read only in part. */
export function Truncated({ file }: { file: OpenedFile }) {
  const notice = truncationNotice(file)
  return notice === null ? null : (
    <p className={TRUNCATED} role="status">
      {notice}
    </p>
  )
}
